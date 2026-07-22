/**
 * The verifier: aggregates every tail of a chain and reports, honestly, what
 * is proven and what is not.
 *
 * Three layers, kept distinct so the verdict never overstates:
 *   - T1 (hash chain): recompute each entry hash and check it chains to its
 *     predecessor with a contiguous seq. Detects accidental corruption and
 *     reordering, and points at the exact entry.
 *   - T2/T4 (checkpoints): recompute each checkpoint's content root FROM THE
 *     EVENTS (never from stored hashes) and verify its Ed25519 signature
 *     against the committed public key it names. Editing an event flips the
 *     root even if every entry hash was repaired, so a forger without the
 *     private key cannot pass. An anonymous clone runs exactly this, offline,
 *     with no secret. And once a checkpoint verifies, every event it covers must
 *     name the signer that attested it — its `signerFp` equals the checkpoint's
 *     and its `who` is the anchor derived from that signer — so a party with
 *     their own key cannot re-sign a range whose events claim a different
 *     identity.
 *   - T3 (external witness): out of scope for local crypto. With no witness
 *     configured, the verifier says so plainly — never a green that reads as
 *     tamper-proof.
 *
 * The window of events above the last checkpoint is a declared residual:
 * covered by T1 but not yet by a signature.
 */

import { existsSync, readFileSync } from 'node:fs';
import type { UpcasterRegistry } from '../events/upcaster.js';
import { checkpointHash, verifyCheckpoint } from './checkpoint.js';
import type { Entry } from './entry.js';
import { entryHash } from './hash.js';
import { deriveAnchor, fingerprintOf, type KeyObject, publicKeyFromPem } from './keys.js';
import { type ChainLayout, publicKeyPath } from './layout.js';
import {
  listPublicKeyFingerprints,
  listTails,
  readTailCheckpoints,
  readTailEntries,
} from './store.js';

/** How the external-witness (T3) layer stands for this verification. */
export type WitnessStatus = 'not-covered';

/** A problem found while verifying one tail. */
export interface TailIssue {
  readonly tail: string;
  readonly layer: 'T1' | 'T2/T4';
  readonly seq?: number;
  readonly detail: string;
}

/**
 * A census note: an observation about the SHAPE of the chain on disk, distinct
 * from a {@link TailIssue}, which is a break in what the crypto can prove. A
 * committed public key is written before its machine's first event and its
 * fingerprint is that machine's tail id, so `keys/` is a committed roster of
 * the tails that should exist. Crossing it against the tails actually present
 * surfaces a key whose tail is gone.
 *
 * This is a SIGNAL, never a verdict of tampering. A key with no tail has
 * innocent causes: a key committed by a machine that minted it but never wrote
 * an event (an empty tail directory is not versioned by git, so a clone sees
 * the key alone), or a merge that copied the key but not the tail. It also has
 * a guilty one: a tail removed to hide its events. The note cannot tell them
 * apart, so it never sets {@link VerifyResult.ok} to false — it points at
 * something worth a look, not at proof of removal. And it is blind to a tail
 * deleted together WITH its key: with nothing left on disk to cross, only an
 * external witness (a git history) can testify to what was removed.
 */
export interface CensusNote {
  /** The committed public key's fingerprint (equal to the missing tail's id). */
  readonly fingerprint: string;
  readonly detail: string;
}

/** The per-tail result. */
export interface TailResult {
  readonly tail: string;
  readonly entryCount: number;
  /** Highest seq covered by a verified checkpoint, or -1 if none. */
  readonly checkpointedThrough: number;
  readonly issues: readonly TailIssue[];
}

/** The aggregate result across all tails. */
export interface VerifyResult {
  /**
   * No integrity violation was detected in what is verifiable: the hash chain
   * holds and every checkpoint's signature checks out. This is NOT a claim that
   * every event is signed — see {@link fullySigned}. A keyless party can still
   * add or edit events ABOVE the last checkpoint (they carry only the hash
   * chain), and that leaves `ok` true because there is no signed statement to
   * contradict. Read `ok` as "nothing verifiable is broken", never as
   * "everything here is authenticated".
   */
  readonly ok: boolean;
  /**
   * Every event is covered by a verified signature — no residual, keyless
   * window. Only when this is true is the whole chain authenticated; when it is
   * false, {@link uncheckpointedEvents} events rest on the hash chain alone.
   */
  readonly fullySigned: boolean;
  readonly tails: readonly TailResult[];
  readonly issues: readonly TailIssue[];
  /**
   * Census notes: committed public keys with no matching tail on disk. These
   * are informational — they do NOT affect {@link ok} — because a key without a
   * tail can be a machine that has not written yet. See {@link CensusNote}.
   */
  readonly census: readonly CensusNote[];
  /** Events proven only by the hash chain, not yet by a signature. */
  readonly uncheckpointedEvents: number;
  readonly witness: WitnessStatus;
  /** A scoped, honest one-line summary. */
  readonly summary: string;
}

/** Verifies an entire chain, aggregating all tails. */
export function verifyChain(layout: ChainLayout, upcasters: UpcasterRegistry): VerifyResult {
  const tails = listTails(layout);
  const tailResults: TailResult[] = [];
  const allIssues: TailIssue[] = [];
  let uncheckpointed = 0;
  // A tail directory is named `<fingerprint>-<installationId>`: the owning key's
  // fingerprint, then a local per-installation suffix. Bind the directory to a
  // committed key by its fingerprint prefix: a tail whose fingerprint is not a
  // committed public key is not a real tail. Without this, the per-entry
  // `link.tail == <dir>` check only proves a tail is internally consistent with
  // its own — attacker-chosen — directory name; a party can copy a tail into
  // `tails/<fabricated>/`, relabel every `link.tail`, recompute the keyless hash
  // chain (no key needed), and have verify count the same events twice, green.
  // Requiring the fingerprint prefix to be committed ties the directory to the
  // roster and closes that duplication — a fabricated name has no committed
  // fingerprint to match, so it is still rejected. (A pre-suffix tail named by a
  // bare fingerprint matches the whole name, so it is accepted unchanged.)
  const committedFingerprints = new Set(listPublicKeyFingerprints(layout));

  for (const tail of tails) {
    const entries = readTailEntries(layout, tail, upcasters);
    const issues: TailIssue[] = [];

    if (!tailFingerprintIsCommitted(tail, committedFingerprints)) {
      issues.push({
        tail,
        layer: 'T2/T4',
        seq: 0,
        detail: `tail ${tail} has no committed key fingerprint (fabricated or relocated tail)`,
      });
    }
    verifyHashChain(tail, entries, issues);
    const checkpointedThrough = verifyCheckpoints(layout, tail, entries, issues);

    uncheckpointed += entries.length - (checkpointedThrough + 1);
    allIssues.push(...issues);
    tailResults.push({
      tail,
      entryCount: entries.length,
      checkpointedThrough,
      issues,
    });
  }

  const census = takeCensus(layout, tails);

  const ok = allIssues.length === 0;
  const fullySigned = ok && uncheckpointed === 0;
  const witness: WitnessStatus = 'not-covered';
  return {
    ok,
    fullySigned,
    tails: tailResults,
    issues: allIssues,
    census,
    uncheckpointedEvents: uncheckpointed,
    witness,
    summary: buildSummary(ok, tailResults.length, uncheckpointed, census.length),
  };
}

/**
 * Whether a tail directory's fingerprint is a committed public key. The
 * fingerprint is the part before the last `-` (see {@link tailFingerprint}), or
 * the whole name for a bare-fingerprint tail. A fabricated name has no committed
 * fingerprint to match and is rejected — that is what keeps a
 * relocated/duplicated tail from verifying green.
 */
function tailFingerprintIsCommitted(tail: string, committed: ReadonlySet<string>): boolean {
  return committed.has(tailFingerprint(tail));
}

/**
 * Crosses the committed public keys against the tails present on disk. Each key
 * with NO tail becomes a census note.
 *
 * The match is by fingerprint: a key is covered if some tail carries its
 * fingerprint — the whole name (a bare-fingerprint tail) or the part before the
 * last `-` (a `<fingerprint>-<installationId>` tail). One key can own several
 * tails (the same copied key installed on several machines), which is not a
 * concern — the census flags only a key with none.
 *
 * The reverse — a tail with no committed key — is not a census concern. If that
 * tail has a checkpoint, verifying it already fails with "no committed public
 * key for signer"; if it has none, its events rest on the hash chain alone and
 * are already reported as the unsigned residual (`fullySigned`). Either way the
 * existing result covers it, so the census only looks one way: keys → tails.
 */
function takeCensus(layout: ChainLayout, tails: readonly string[]): CensusNote[] {
  const fingerprintsWithTail = new Set(tails.map(tailFingerprint));
  const notes: CensusNote[] = [];
  for (const fingerprint of listPublicKeyFingerprints(layout)) {
    if (fingerprintsWithTail.has(fingerprint)) continue;
    notes.push({
      fingerprint,
      detail:
        'committed public key has no tail on disk — the tail may have been dropped ' +
        '(a botched merge), never written (an empty tail is not versioned), or removed',
    });
  }
  return notes;
}

/** The fingerprint a tail directory carries: the part before its last `-`, or the whole name. */
function tailFingerprint(tail: string): string {
  const lastDash = tail.lastIndexOf('-');
  return lastDash === -1 ? tail : tail.slice(0, lastDash);
}

/**
 * T1: recompute each entry hash and check the per-tail chain. Seq must run
 * contiguously from 0; each entry's `prev` must equal the previous entry's
 * recomputed hash; each stored `hash` must match the recomputation.
 */
function verifyHashChain(tail: string, entries: readonly Entry[], issues: TailIssue[]): void {
  let expectedPrev: string | null = null;
  let expectedSeq = 0;
  for (const entry of entries) {
    // Bind the entry to the tail directory it was read from. `entry.link.tail`
    // is the value stored IN the line and is folded into the entry hash, but the
    // hash alone only proves the line is self-consistent — not that it lives
    // where it claims. Without this check, copying a tail's segments into a
    // fabricated `tails/<other>/` directory (its stored link.tail still naming
    // the original) reads as a second, independent tail: the hash chain within
    // it still checks out, so verify stays green and a projection counts every
    // event twice. Requiring the stored tail to equal the directory closes that
    // relocation/duplication path — including in the residual window, where no
    // checkpoint's own `tail` field would otherwise catch it.
    if (entry.link.tail !== tail) {
      issues.push({
        tail,
        layer: 'T1',
        seq: entry.link.seq,
        detail: `entry names tail ${entry.link.tail}, stored under ${tail}`,
      });
      return;
    }
    if (entry.link.seq !== expectedSeq) {
      issues.push({
        tail,
        layer: 'T1',
        seq: entry.link.seq,
        detail: `seq gap: expected ${expectedSeq}, found ${entry.link.seq}`,
      });
      return; // a gap makes everything after it unanchored; stop here
    }
    if (entry.link.prev !== expectedPrev) {
      issues.push({
        tail,
        layer: 'T1',
        seq: entry.link.seq,
        detail: 'prev-hash break: does not chain to the previous entry',
      });
      return;
    }
    const recomputed = entryHash({
      event: entry.event,
      tail: entry.link.tail,
      seq: entry.link.seq,
      prev: entry.link.prev,
    });
    if (recomputed !== entry.link.hash) {
      issues.push({
        tail,
        layer: 'T1',
        seq: entry.link.seq,
        detail: 'entry hash mismatch: content or link was altered',
      });
      return;
    }
    expectedPrev = entry.link.hash;
    expectedSeq += 1;
  }
}

/**
 * T2/T4: verify each checkpoint against the events it covers and the public key
 * it names. Coverage must be contiguous from seq 0. Returns the highest seq
 * covered by a verified checkpoint (-1 if none).
 */
function verifyCheckpoints(
  layout: ChainLayout,
  tail: string,
  entries: readonly Entry[],
  issues: TailIssue[],
): number {
  const checkpoints = readTailCheckpoints(layout, tail).sort((a, b) => a.fromSeq - b.fromSeq);
  let covered = -1;
  let expectedPrev: string | null = null;

  for (const checkpoint of checkpoints) {
    if (checkpoint.tail !== tail) {
      issues.push({
        tail,
        layer: 'T2/T4',
        detail: `checkpoint names tail ${checkpoint.tail}, stored under ${tail}`,
      });
      continue;
    }
    // Checkpoint chain: each checkpoint links to the previous one's hash. A
    // dropped trailing checkpoint therefore cannot hide the signed history it
    // covered — the surviving run no longer matches what the next one linked.
    if (checkpoint.prev !== expectedPrev) {
      issues.push({
        tail,
        layer: 'T2/T4',
        seq: checkpoint.fromSeq,
        detail: 'checkpoint chain break: prev does not link to the previous checkpoint',
      });
      continue;
    }
    if (checkpoint.fromSeq !== covered + 1) {
      issues.push({
        tail,
        layer: 'T2/T4',
        seq: checkpoint.fromSeq,
        detail: `checkpoint coverage gap: expected to start at ${covered + 1}, starts at ${checkpoint.fromSeq}`,
      });
      // keep going: report each gap, but do not advance coverage over the hole
      continue;
    }
    const range = entries.filter(
      (e) => e.link.seq >= checkpoint.fromSeq && e.link.seq <= checkpoint.toSeq,
    );
    const publicKey = loadPublicKey(layout, checkpoint.signerFp);
    if (publicKey === null) {
      issues.push({
        tail,
        layer: 'T2/T4',
        seq: checkpoint.fromSeq,
        detail: `no committed public key for signer ${checkpoint.signerFp}`,
      });
      continue;
    }
    // Fingerprint binding: the file is NAMED by a fingerprint, but a forger can
    // overwrite that file with their own key. Re-derive the loaded key's real
    // fingerprint and require it to equal the one the checkpoint names. Without
    // this, swapping the committed .pub for the forger's key would let a forged
    // signature verify — the exact gap the signed-message binding alone leaves
    // open, since verification uses whatever key the file now holds.
    if (fingerprintOf(publicKey) !== checkpoint.signerFp) {
      issues.push({
        tail,
        layer: 'T2/T4',
        seq: checkpoint.fromSeq,
        detail: `public key for ${checkpoint.signerFp} does not match its fingerprint (key was swapped)`,
      });
      continue;
    }
    const verdict = verifyCheckpoint({
      checkpoint,
      events: range.map((e) => e.event),
      publicKey,
    });
    if (!verdict.ok) {
      issues.push({
        tail,
        layer: 'T2/T4',
        seq: checkpoint.fromSeq,
        detail: `checkpoint failed: ${verdict.reason}`,
      });
      continue;
    }
    // Identity binding: the checkpoint proves this key signed this range, but
    // that alone does not bind the identity each EVENT claims. Require every
    // event in the range to name the signer that actually attested it
    // (`signerFp` = the checkpoint's) and to carry the anchor derived from that
    // signer (`who` = deriveAnchor(signerFp)). Without this a party holding their
    // own committed key could rewrite the events' `who`/`signerFp` to a
    // fabricated or victim identity, re-sign the range with their real key, and
    // still verify green — the envelope's identity would be decorative. The
    // signature integrity-protects the bytes; this makes those bytes MEAN the
    // signer.
    // The same reasoning covers `which` (the agent): the gate refuses a move
    // where the authorizing human equals the executing agent (self-authorization),
    // and that invariant must survive to the signed record — otherwise an editor
    // could smuggle `who === which` below the crypto and it would verify green.
    // So when `which` is present it must differ from `who`, compared in the SAME
    // canonical form the gate uses to refuse it (NFC, trimmed): a raw byte
    // compare would let `which = who + " "` — the gate's WHO_IS_WHICH, one stray
    // space apart — slip through as byte-distinct and verify green.
    const bindingBreak = range.find(
      (e) =>
        e.event.signerFp !== checkpoint.signerFp ||
        e.event.who !== deriveAnchor(e.event.signerFp) ||
        (e.event.which !== undefined &&
          canonicalIdentityForm(e.event.which) === canonicalIdentityForm(e.event.who)),
    );
    if (bindingBreak !== undefined) {
      issues.push({
        tail,
        layer: 'T2/T4',
        seq: bindingBreak.link.seq,
        detail:
          'event identity does not bind to its signer: who/signerFp disagree with the checkpoint',
      });
      continue;
    }
    covered = checkpoint.toSeq;
    expectedPrev = checkpointHash(checkpoint);
  }
  return covered;
}

/**
 * The canonical form of an identity for the who-vs-which comparison — NFC then
 * trim, the SAME normalization the core's gate applies before it refuses a
 * self-authorizing move (`canonicalIdentity`). The verifier lives in the
 * zero-dependency chain and cannot import the core, so the rule is mirrored
 * here; a property test pins the two forms in agreement. It is only ever used to
 * decide whether `which` and `who` are the same identity, never to rewrite the
 * signed bytes — the event records the identity exactly as it was written.
 */
export function canonicalIdentityForm(value: string): string {
  return value.normalize('NFC').trim();
}

function loadPublicKey(layout: ChainLayout, fingerprint: string): KeyObject | null {
  const path = publicKeyPath(layout, fingerprint);
  if (!existsSync(path)) return null;
  try {
    return publicKeyFromPem(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

function buildSummary(
  ok: boolean,
  tailCount: number,
  uncheckpointed: number,
  censusCount: number,
): string {
  const local = ok ? 'local integrity verified (T1/T2/T4)' : 'local integrity FAILED — see issues';
  // The events above the last checkpoint are covered only by the keyless hash
  // chain, not yet by a signature — so a party without the private key could
  // still append there. Say so plainly; do not let the count read as "signed".
  const residual =
    uncheckpointed > 0
      ? `${uncheckpointed} event(s) above the last checkpoint are hash-chained but NOT yet signature-covered`
      : 'all events are signature-covered';
  const scope = `${tailCount} tail(s); ${residual}`;
  // A census note is not an integrity failure — it flags a committed key whose
  // tail is missing. Report it separately and only when there is one.
  const census =
    censusCount > 0
      ? `; ${censusCount} committed key(s) without a tail (see census — informational, not a break)`
      : '';
  const witness =
    'external witness (T3): not covered — enable an anchor or push to a shared remote';
  return `${local}; ${scope}${census}; ${witness}`;
}
