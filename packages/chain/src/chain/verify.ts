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
 *     — so a party with their own key cannot re-sign a range whose events claim a
 *     different signer.
 *   - IDENTITY (enrollment): who a signer speaks for is not its own key by
 *     default; it is resolved by folding the chain's enrollment facts
 *     (`identity.founded`/`key.enrolled`/`key.revoked`) in deterministic order.
 *     An event is authentic only if its `signerFp` is a key valid for its `who`
 *     at that point. This spans tails (a key enrolled on one authorizes events on
 *     another) and applies to every event, checkpointed or not. See enrollment.ts.
 *   - T3 (external witness): out of scope for local crypto. With no witness
 *     configured, the verifier says so plainly — never a green that reads as
 *     tamper-proof.
 *
 * WHAT EVERY RECOMPUTATION ABOVE IS OVER. Reading a stored line lifts its event
 * through the registered upcasters, so the event this file holds may be the
 * CURRENT expression of a fact written years ago — a reading, not the record.
 * Both recomputations therefore take `entry.written`, the form that reached the
 * disk (see hash.ts). Doing it the other way is not a smaller mistake at T1 than
 * at T2/T4: at T1 the first kind to gain a v2 reports "content or link was
 * altered" on an untouched chain; at T2/T4 it reports a broken SIGNATURE, which
 * is this product's word for "someone edited this without the key". Pinned by
 * upcast-vs-proof.test.ts, which registers a synthetic v1→v2 lift — the only way
 * to exercise a mechanism that is otherwise dormant while the catalog has one
 * version of everything.
 *
 * The lift is not skipped to get there, and that is deliberate: this verifier
 * also refuses a chain it cannot READ. A line whose ladder is broken — no
 * upcaster for its rung, or a version ahead of this catalog — is refused rather
 * than verified green over bytes nobody can interpret. Both halves are the same
 * promise as the writer's (writer.ts refuses to seal what no reader would accept);
 * one guards the way in, the other the way back.
 *
 * HOW it refuses used to be "it throws out of the read", and that was measured and
 * found to be a message rather than a finding: the caller got the parser's own
 * sentence — `not valid JSON: Unexpected end of JSON input` — with no tail, no
 * position, no word for "unreadable", and no `tails`/`issues` to read at all. It is
 * a VERDICT now: an unreadable line becomes an issue with the tail and the position
 * in it, and the level says `unreadable` (see level.ts and `readOrIssue`). Nothing
 * about what is refused changed; the exception was replaced by an address.
 *
 * The window of events above the last checkpoint is a declared residual:
 * covered by T1 but not yet by a signature.
 *
 * A fabricated tail is shut out of that window on two fronts. A keyless party
 * cannot fabricate a tail under a NON-enrolled fingerprint: its events fail the
 * enrollment fold (the fingerprint is not valid for their `who`). Nor can they
 * fabricate one under a REAL enrolled fingerprint by copying a residual tail
 * into `tails/<real-fp>-<forged>/` and relabelling it: every tail must carry a
 * proof that its key signed its own id (see tailproof.ts), and a keyless party
 * can neither mint that proof nor relocate a genuine one (the signed message is
 * the tail id). So the only tails that resolve are those whose key actually
 * owns them. What remains indistinguishable — by design — is a legitimate
 * SECOND INSTALLATION of one's own key (copy-key): it holds the key and signs
 * its own distinct id, exactly as the first did. That is benign duplication of
 * the owner's own work, not a foreign tail, and a checkpoint later binds each
 * tail's name so no residual survives into a signed range. A reader that
 * requires `fullySigned` — not merely `ok` — sees any residual plainly.
 */

import { existsSync, readFileSync } from 'node:fs';
import type { UpcasterRegistry } from '../events/upcaster.js';
import { type Checkpoint, checkpointHash, verifyCheckpoint } from './checkpoint.js';
import { resolveIdentity } from './enrollment.js';
import type { Entry } from './entry.js';
import { entryHash } from './hash.js';
import { fingerprintOf, type KeyObject, publicKeyFromPem } from './keys.js';
import { type ChainLayout, publicKeyPath, tailProofPath } from './layout.js';
import {
  levelHeadline,
  type ProvenFacts,
  type ProvenLevel,
  provenLevel,
  type WitnessStatus,
} from './level.js';
import { UnreadableLineError } from './lines.js';
import { listPublicKeyFingerprints, listTails, readTail, readTailCheckpoints } from './store.js';
import { parseTailProof, verifyTailProof } from './tailproof.js';

export type { WitnessStatus } from './level.js';

/** A problem found while verifying one tail. */
export interface TailIssue {
  readonly tail: string;
  readonly layer: 'T1' | 'T2/T4';
  readonly seq?: number;
  readonly detail: string;
}

/**
 * A census note: an observation about the SHAPE of the chain on disk, distinct
 * from a {@link TailIssue}, which is a break in what the crypto can prove.
 *
 * A note is a SIGNAL, never a verdict of tampering, and never sets
 * {@link VerifyResult.ok} to false: each of the two has an innocent reading and a
 * guilty one, and the disk cannot tell them apart. Reporting the ambiguity is the
 * product's posture; choosing a side on the reader's behalf is not.
 *
 * It is a union rather than one shape because the two observations are about
 * different things, and a reader that has to branch on `kind` is a reader who
 * cannot mistake one for the other.
 */
export type CensusNote = KeyWithoutTailNote | PartialFinalLineNote;

/**
 * A committed public key with no tail on disk.
 *
 * A committed public key is written before its machine's first event and its
 * fingerprint is that machine's tail id, so `keys/` is a committed roster of the
 * tails that should exist. Crossing it against the tails actually present surfaces
 * a key whose tail is gone.
 *
 * Innocent causes: a key committed by a machine that minted it but never wrote an
 * event (an empty tail directory is not versioned by git, so a clone sees the key
 * alone), or a merge that copied the key but not the tail. The guilty one: a tail
 * removed to hide its events. And it is blind to a tail deleted together WITH its
 * key: with nothing left on disk to cross, only an external witness (a git history)
 * can testify to what was removed.
 */
export interface KeyWithoutTailNote {
  readonly kind: 'key-without-tail';
  /** The committed public key's fingerprint (equal to the missing tail's id). */
  readonly fingerprint: string;
  readonly detail: string;
}

/**
 * A tail whose last line was a fragment the read dropped.
 *
 * A complete append ends in a newline, so an unterminated final line that will not
 * parse is exactly what a crash mid-append leaves — the one tolerance an
 * append-only file earns (see lines.ts). Treating it as a break would fail every
 * legitimate crash recovery; saying NOTHING about it, which is what happened until
 * now, leaves it indistinguishable from an attempt to append to the tail, and
 * contradicts the doctrine of reporting what could not be checked. So it is
 * reported as an ambiguity, and it does not touch {@link VerifyResult.ok}.
 */
export interface PartialFinalLineNote {
  readonly kind: 'partial-final-line';
  /** The tail whose physical end held the fragment. */
  readonly tail: string;
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
  /**
   * How far the proof got, as ONE value — the same one the summary is worded from
   * and the same one an exit code is decided by (see level.ts). It says what `ok`
   * and `fullySigned` say together, without asking a reader to add them up: it was
   * a reader adding them up WRONG, inside this very file, that let the summary
   * announce `verified (T1/T2/T4)` over a record where no signature had been
   * checked at all.
   */
  readonly level: ProvenLevel;
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
  const entriesByTail = new Map<string, readonly Entry[]>();
  const issuesByTail = new Map<string, TailIssue[]>();
  const checkpointedByTail = new Map<string, number>();
  const notes: PartialFinalLineNote[] = [];
  let unreadable = false;

  for (const tail of tails) {
    const issues: TailIssue[] = [];
    issuesByTail.set(tail, issues);
    // Both stored files a tail is verified over are read HERE, through one guard.
    // A line that will not parse is a finding ABOUT THE RECORD — which tail, which
    // position, and that it cannot be read — not an exception thrown out of the
    // verifier. Measured before this: the exception reached the CLI's catch-all and
    // printed `not valid JSON: Unexpected end of JSON input`, correct in its exit
    // code and useless as a verdict.
    const read = readOrIssue(layout, tail, issues, () => readTail(layout, tail, upcasters));
    const checkpoints = readOrIssue(layout, tail, issues, () => readTailCheckpoints(layout, tail));
    if (read === UNREADABLE || checkpoints === UNREADABLE) {
      // Nothing further is claimed about a tail that could not be read: the checks
      // below would either need its entries or add findings about a file the
      // verifier just said it cannot open. The verdict is already the strongest
      // thing there is to say (see `provenLevel`).
      unreadable = true;
      entriesByTail.set(tail, []);
      checkpointedByTail.set(tail, -1);
      continue;
    }
    const entries = read.entries;
    entriesByTail.set(tail, entries);
    if (read.partialFinalLine) {
      notes.push({
        kind: 'partial-final-line',
        tail,
        detail:
          `tail ${tail} ends in a partial line that was dropped — the mark of a write ` +
          'interrupted mid-append, and indistinguishable from an appended fragment',
      });
    }

    if (!tailFingerprintIsCommitted(tail, committedFingerprints)) {
      issues.push({
        tail,
        layer: 'T2/T4',
        seq: 0,
        detail: `tail ${tail} has no committed key fingerprint (fabricated or relocated tail)`,
      });
    } else {
      // The fingerprint prefix is committed, but the installation-id suffix is
      // locally chosen: require the key to have signed THIS tail id at birth, so
      // a keyless party cannot fabricate a sibling tail under a real fingerprint
      // and have its residual events counted. See tailproof.ts.
      verifyTailOwnership(layout, tail, issues);
    }
    verifyHashChain(tail, entries, issues);
    const checkpointedThrough = verifyCheckpoints(layout, tail, entries, checkpoints, issues);
    checkpointedByTail.set(tail, checkpointedThrough);
    uncheckpointed += entries.length - (checkpointedThrough + 1);
  }

  // Identity by enrollment, folded across every tail in one deterministic order:
  // an event is authentic only if its signer is a key valid for its anchor at
  // its point in the chain. This is the single identity rule — it replaces the
  // old per-event `who == deriveAnchor(signerFp)` shortcut with membership
  // proven on the chain. Because enrollment spans tails (a key enrolled on one
  // machine authorizes events on another), it is resolved once over the merged
  // order, and each issue is attributed back to the tail and seq of the event
  // that failed.
  for (const identityIssue of resolveIdentity(layout, entriesByTail, checkpointedByTail).issues) {
    (issuesByTail.get(identityIssue.tail) ?? []).push({
      tail: identityIssue.tail,
      layer: 'T2/T4',
      seq: identityIssue.seq,
      detail: identityIssue.detail,
    });
  }

  const tailResults: TailResult[] = tails.map((tail) => ({
    tail,
    entryCount: (entriesByTail.get(tail) ?? []).length,
    checkpointedThrough: checkpointedByTail.get(tail) ?? -1,
    issues: issuesByTail.get(tail) ?? [],
  }));
  const allIssues: TailIssue[] = tailResults.flatMap((t) => t.issues as TailIssue[]);

  const census: CensusNote[] = [...keysWithoutTail(layout, tails), ...notes];

  const ok = allIssues.length === 0;
  const fullySigned = ok && uncheckpointed === 0;
  const witness: WitnessStatus = 'not-covered';
  // Events an actually-verified checkpoint covers. Zero is the state the old
  // summary called `verified (T1/T2/T4)`: no signature was checked, on any tail.
  const signedEvents = tailResults.reduce((sum, t) => sum + t.checkpointedThrough + 1, 0);
  const facts: ProvenFacts = {
    unreadable,
    hasIssue: !ok,
    signedEvents,
    uncheckpointedEvents: uncheckpointed,
    witness,
  };
  const level = provenLevel(facts);
  return {
    ok,
    fullySigned,
    level,
    tails: tailResults,
    issues: allIssues,
    census,
    uncheckpointedEvents: uncheckpointed,
    witness,
    summary: buildSummary({
      level,
      tailCount: tailResults.length,
      totalEvents: signedEvents + uncheckpointed,
      signedEvents,
      uncheckpointed,
      census,
    }),
  };
}

/** Returned by {@link readOrIssue} when a stored line refused to parse. */
const UNREADABLE = Symbol('unreadable');

/**
 * Runs one read of a tail's stored files, turning an unreadable line into an
 * {@link TailIssue} instead of an exception.
 *
 * This is the ONE place the verifier converts "cannot read" into a finding, so the
 * two files a tail is verified over cannot answer differently — and a third one
 * added tomorrow reaches the same function or it is not read here at all. The layer
 * is T1: what failed is the record's own bytes, below any signature.
 *
 * The locus loses the chain root, so what a reader is shown is a path inside the
 * chain (`tails/<id>/000001.jsonl line 3`) rather than wherever this clone happens
 * to sit on this machine.
 */
function readOrIssue<T>(
  layout: ChainLayout,
  tail: string,
  issues: TailIssue[],
  read: () => T,
): T | typeof UNREADABLE {
  try {
    return read();
  } catch (error) {
    if (!(error instanceof UnreadableLineError)) throw error;
    issues.push({
      tail,
      layer: 'T1',
      detail: `UNREADABLE: ${withinChain(layout, error.locus)}: ${error.reason}`,
    });
    return UNREADABLE;
  }
}

/** A locus with the chain root stripped, so a verdict names a path inside the chain. */
function withinChain(layout: ChainLayout, locus: string): string {
  const prefix = `${layout.root}/`;
  return locus.startsWith(prefix) ? locus.slice(prefix.length) : locus;
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
function keysWithoutTail(layout: ChainLayout, tails: readonly string[]): KeyWithoutTailNote[] {
  const fingerprintsWithTail = new Set(tails.map(tailFingerprint));
  const notes: KeyWithoutTailNote[] = [];
  for (const fingerprint of listPublicKeyFingerprints(layout)) {
    if (fingerprintsWithTail.has(fingerprint)) continue;
    notes.push({
      kind: 'key-without-tail',
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
    // Over the WRITTEN event, never the lifted one the reader holds — see
    // hash.ts and the note at the top of this file.
    const recomputed = entryHash({
      event: entry.written,
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
  stored: readonly Checkpoint[],
  issues: TailIssue[],
): number {
  const checkpoints = [...stored].sort((a, b) => a.fromSeq - b.fromSeq);
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
      // The signed root is folded over the events AS WRITTEN. Folding it over
      // the lifted reading would turn the first version bump into a signature
      // failure on every chain written before it.
      events: range.map((e) => e.written),
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
    // Signer binding: the checkpoint proves this key signed this range, but that
    // alone does not bind each EVENT to that signer. Require every event in the
    // range to name the signer that actually attested it (`signerFp` = the
    // checkpoint's). Without this a party holding their own committed key could
    // rewrite the events' `signerFp` to a fabricated identity, re-sign the range
    // with their real key, and still verify green here — the signature
    // integrity-protects the bytes; this makes those bytes name the signer.
    // Whether that signer is authorized to speak for the event's `who` is the
    // enrollment fold's concern (resolveIdentity), applied to every event
    // checkpointed or not; here we only pin that `signerFp` is the real signer.
    // The `which` clause stays: the gate refuses a move where the authorizing
    // human equals the executing agent (self-authorization), and that invariant
    // must survive to the signed record — otherwise an editor could smuggle
    // `who === which` below the crypto. So when `which` is present it must differ
    // from `who`, compared in the SAME canonical form the gate uses (NFC,
    // trimmed): a raw byte compare would let `which = who + " "` slip through.
    const bindingBreak = range.find(
      (e) =>
        e.event.signerFp !== checkpoint.signerFp ||
        (e.event.which !== undefined &&
          canonicalIdentityForm(e.event.which) === canonicalIdentityForm(e.event.who)),
    );
    if (bindingBreak !== undefined) {
      issues.push({
        tail,
        layer: 'T2/T4',
        seq: bindingBreak.link.seq,
        detail:
          'event identity does not bind to its signer: signerFp disagrees with the checkpoint',
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

/**
 * Requires a tail (whose fingerprint prefix is committed) to carry a valid proof
 * that its key signed this exact tail id. A missing, malformed, or wrong-signed
 * proof is an issue: it is the mark of a fabricated sibling tail under a real
 * fingerprint — the residual-window duplication a keyless party could otherwise
 * mount. A legitimate installation wrote this at birth over its own id.
 */
function verifyTailOwnership(layout: ChainLayout, tail: string, issues: TailIssue[]): void {
  const push = (detail: string) => issues.push({ tail, layer: 'T2/T4', seq: 0, detail });
  const path = tailProofPath(layout, tail);
  if (!existsSync(path)) {
    push(`tail ${tail} has no ownership proof (fabricated or relocated tail)`);
    return;
  }
  let proof: ReturnType<typeof parseTailProof>;
  try {
    proof = parseTailProof(readFileSync(path, 'utf-8'));
  } catch (error) {
    push(`tail ${tail} has a malformed ownership proof: ${(error as Error).message}`);
    return;
  }
  const publicKey = loadPublicKey(layout, tailFingerprint(tail));
  if (publicKey === null) {
    push(`tail ${tail} ownership proof cannot be checked: no committed public key`);
    return;
  }
  const verdict = verifyTailProof({ proof, tail, publicKey });
  if (!verdict.ok) {
    push(`tail ${tail} ownership proof is invalid (${verdict.reason})`);
  }
}

/** What the one-line verdict is worded from — every clause, one set of facts. */
interface SummaryFacts {
  readonly level: ProvenLevel;
  readonly tailCount: number;
  readonly totalEvents: number;
  /** Events a verified checkpoint covers. */
  readonly signedEvents: number;
  /** Events resting on the hash chain alone. */
  readonly uncheckpointed: number;
  readonly census: readonly CensusNote[];
}

/**
 * The one-line verdict.
 *
 * Its first clause is the LEVEL and nothing else (see level.ts). It used to be a
 * function of `ok` alone while the clause beside it was a function of the residual
 * count, and with no checkpoint at all the two contradicted each other in one
 * sentence: `verified (T1/T2/T4)` next to `6 event(s) … NOT yet signature-covered`.
 * Both clauses are now worded from one set of facts — the same facts the level is
 * derived from — so no reading of this sentence can disagree with another.
 */
function buildSummary(facts: SummaryFacts): string {
  const scope = `${facts.tailCount} tail(s); ${coverageClause(facts)}`;
  const census = censusClauses(facts.census)
    .map((clause) => `; ${clause}`)
    .join('');
  const witness =
    'external witness (T3): not covered — enable an anchor or push to a shared remote';
  return `${levelHeadline(facts.level)}; ${scope}${census}; ${witness}`;
}

/**
 * What the events rest on.
 *
 * The events above the last checkpoint are covered only by the keyless hash chain,
 * so a party without the private key could still append there: say so plainly, and
 * never let the count read as "signed". Two of the branches are corrections of a
 * sentence that presupposed what it was reporting:
 *
 *   - with no verified checkpoint there is no "last checkpoint" for the events to
 *     be ABOVE. The sentence is then about every event there is.
 *   - with a tail unread, the counts are a floor and not a total, and the honest
 *     thing is to say the count is incomplete rather than to publish it.
 */
function coverageClause(facts: SummaryFacts): string {
  if (facts.level === 'unreadable') {
    return 'the event count is INCOMPLETE — a tail could not be read';
  }
  if (facts.totalEvents === 0) return 'no events yet';
  if (facts.uncheckpointed === 0) return 'all events are signature-covered';
  return facts.signedEvents === 0
    ? `${facts.uncheckpointed} event(s) are hash-chained but NOT yet signature-covered`
    : `${facts.uncheckpointed} event(s) above the last checkpoint are hash-chained but NOT yet signature-covered`;
}

/**
 * How each kind of census note reads, and how many there are — TOTAL over the
 * kinds, so a third observation cannot be counted into a sentence written for
 * another one. A note is not an integrity failure, and each clause says so where a
 * reader meets it.
 */
const CENSUS_CLAUSE: Readonly<Record<CensusNote['kind'], (count: number) => string>> = {
  'key-without-tail': (count) =>
    `${count} committed key(s) without a tail (see census — informational, not a break)`,
  'partial-final-line': (count) =>
    `${count} tail(s) ending in a dropped partial line (see census — informational, not a break)`,
};

/** One clause per kind of note present, in the order the kinds are declared in. */
function censusClauses(census: readonly CensusNote[]): string[] {
  const clauses: string[] = [];
  for (const [kind, clause] of Object.entries(CENSUS_CLAUSE)) {
    const count = census.filter((note) => note.kind === kind).length;
    if (count > 0) clauses.push(clause(count));
  }
  return clauses;
}
