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
 *     with no secret.
 *   - T3 (external witness): out of scope for local crypto. With no witness
 *     configured, the verifier says so plainly — never a green that reads as
 *     tamper-proof.
 *
 * The window of events above the last checkpoint is a declared residual:
 * covered by T1 but not yet by a signature.
 */

import { existsSync, readFileSync } from 'node:fs';
import type { UpcasterRegistry } from '../events/upcaster.js';
import { verifyCheckpoint } from './checkpoint.js';
import type { Entry } from './entry.js';
import { entryHash } from './hash.js';
import { fingerprintOf, type KeyObject, publicKeyFromPem } from './keys.js';
import { type ChainLayout, publicKeyPath } from './layout.js';
import { listTails, readTailCheckpoints, readTailEntries } from './store.js';

/** How the external-witness (T3) layer stands for this verification. */
export type WitnessStatus = 'not-covered';

/** A problem found while verifying one tail. */
export interface TailIssue {
  readonly tail: string;
  readonly layer: 'T1' | 'T2/T4';
  readonly seq?: number;
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

  for (const tail of tails) {
    const entries = readTailEntries(layout, tail, upcasters);
    const issues: TailIssue[] = [];

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

  const ok = allIssues.length === 0;
  const fullySigned = ok && uncheckpointed === 0;
  const witness: WitnessStatus = 'not-covered';
  return {
    ok,
    fullySigned,
    tails: tailResults,
    issues: allIssues,
    uncheckpointedEvents: uncheckpointed,
    witness,
    summary: buildSummary(ok, tailResults.length, uncheckpointed),
  };
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

  for (const checkpoint of checkpoints) {
    if (checkpoint.tail !== tail) {
      issues.push({
        tail,
        layer: 'T2/T4',
        detail: `checkpoint names tail ${checkpoint.tail}, stored under ${tail}`,
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
    covered = checkpoint.toSeq;
  }
  return covered;
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

function buildSummary(ok: boolean, tailCount: number, uncheckpointed: number): string {
  const local = ok ? 'local integrity verified (T1/T2/T4)' : 'local integrity FAILED — see issues';
  // The events above the last checkpoint are covered only by the keyless hash
  // chain, not yet by a signature — so a party without the private key could
  // still append there. Say so plainly; do not let the count read as "signed".
  const residual =
    uncheckpointed > 0
      ? `${uncheckpointed} event(s) above the last checkpoint are hash-chained but NOT yet signature-covered`
      : 'all events are signature-covered';
  const scope = `${tailCount} tail(s); ${residual}`;
  const witness =
    'external witness (T3): not covered — enable an anchor or push to a shared remote';
  return `${local}; ${scope}; ${witness}`;
}
