import { readFileSync } from 'node:fs';
import { orderedAuditFiles } from '../../storage/audit/audit-files.js';
import { EVENT_FORMAT_VERSION } from '../../storage/audit/audit-hash.js';
import type { AuditEvent } from '../../storage/audit/audit-writer.js';

/**
 * One chained (keyed) event as seen on disk, carrying the index the
 * attestation layer addresses it by. That index is the position in the
 * CHAINED sequence — the same thing `audit_state.event_count` counts — NOT the
 * raw line number, so a stray non-keyed line never shifts it. An
 * attestation over `[from, to)` therefore covers `chainedEvents[from … to-1]`.
 */
export interface ChainedEvent {
  /** 0-based position in the chained (keyed) sequence. */
  readonly index: number;
  /** The parsed event, used to recompute its attestation leaf. */
  readonly event: AuditEvent;
}

/**
 * The chained events on disk, in chain order, ready for the attestation
 * emitter and verifier to address by index. Pure and read-only.
 *
 * This is DELIBERATELY narrower than the integrity walk in
 * `inspectAuditIntegrity`: that one verifies the hash chain and tallies
 * malformed shapes for the doctor report; this one only needs
 * the chained events by index so a batch `[from, to)` can be reconstructed.
 * Kept separate so the attestation layer does not depend on — nor risk
 * changing — the integrity verdicts. A malformed line is skipped (it is not a
 * chained event), mirroring the integrity walk, which counts it separately
 * without advancing the chained index.
 */
export interface AuditChainWalk {
  /** Every chained (keyed) event, in order, indexed from 0. */
  readonly chained: readonly ChainedEvent[];
  /** Count of unparseable lines encountered (skipped, not indexed). */
  readonly malformedLines: number;
  /**
   * Count of chained (keyed) events that carry NO string `hash`. They are still
   * indexed (so the chained index stays aligned with `event_count`, which
   * counts every keyed line), but a batch containing one cannot be attested:
   * its leaf/head derivation needs the `hash`. A caller (the reattest planner)
   * refuses when this is non-zero rather than letting the emitter throw.
   */
  readonly unhashedLines: number;
}

/**
 * Walks every audit JSONL file under `auditDir` in chain order (archived
 * `YYYY-MM.jsonl` segments oldest-first, then `current.jsonl`) and collects
 * the chained events with their chained-sequence index.
 *
 * A line is "chained" exactly when its `v` field equals `EVENT_FORMAT_VERSION`
 * — the same rule the integrity walk uses to populate `event_count`. A
 * version-less or otherwise non-keyed line, and any unparseable line, does not
 * advance the chained index; unparseable lines are tallied so a caller can
 * refuse to act on a log that may be hiding a deletion behind a garbage line.
 *
 * @param auditDir - Absolute path to `.mnema/audit/`
 * @returns The chained events by index, plus the malformed-line count
 */
export function walkChainedEvents(auditDir: string): AuditChainWalk {
  const chained: ChainedEvent[] = [];
  let malformedLines = 0;
  let unhashedLines = 0;
  let index = 0;

  for (const file of orderedAuditFiles(auditDir)) {
    const lines = readFileSync(file, 'utf-8').split('\n');
    for (const line of lines) {
      if (line.length === 0) continue;
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(line) as Record<string, unknown>;
      } catch {
        malformedLines += 1;
        continue;
      }
      const v = typeof event.v === 'number' ? event.v : 0;
      if (v === EVENT_FORMAT_VERSION) {
        // Index every keyed line so the chained index stays aligned with
        // event_count (which counts them all). A keyed line with no string
        // `hash` is still indexed but tallied: the attestation planner refuses
        // a batch that contains one, instead of the emitter throwing on it.
        if (typeof event.hash !== 'string') unhashedLines += 1;
        chained.push({ index, event: event as unknown as AuditEvent });
        index += 1;
      }
      // A non-keyed line (a stray pre-beta or forged shape) is not a chained
      // event and does not advance the chained index (same as the integrity walk).
    }
  }

  return { chained, malformedLines, unhashedLines };
}

/**
 * A partial walk of ONLY the tail `[fromIndex, headCount)` of the chained
 * sequence, for the auto-attestation hot path. It reads files NEWEST-first and
 * stops as soon as it has collected the `headCount - fromIndex` most recent
 * chained events — so its parse cost is bounded by the batch being attested,
 * not by the whole log. The full {@link walkChainedEvents} still backs every
 * verify surface and the manual reattest; this exists purely so a checkpoint
 * does not re-parse the entire chain to sign the batch it just closed.
 *
 * Absolute indices are preserved: `headCount` is the on-disk chained count
 * (`audit_state.event_count`), so the last collected event is index
 * `headCount - 1` and the batch's `from` lines up with the committed `.att`
 * chain exactly as the full walk would produce. Correctness of `headCount`
 * itself is the caller's precondition — it comes from a chain the eager
 * integrity check already vouched for (the `audit event count` verdict, which
 * asserts on-disk chained count === `event_count`).
 *
 * The malformed/unhashed tallies cover ONLY the files this partial walk opened
 * (the tail). That is sufficient for the emit decision: the batch being signed
 * lives in the tail, so a malformed/unhashed line that would corrupt THIS emit
 * is seen here; the already-covered region is guarded by the whole-chain
 * integrity check the caller resolves separately.
 *
 * @param auditDir - Absolute path to `.mnema/audit/`
 * @param headCount - On-disk chained count (the head high-water mark)
 * @param fromIndex - First index the caller still needs (inclusive)
 * @returns The chained events for `[fromIndex, headCount)`, indexed
 *   absolutely, plus the tail malformed/unhashed tallies and the number of
 *   chained events actually observed while collecting the tail
 */
export function walkChainedTail(
  auditDir: string,
  headCount: number,
  fromIndex: number,
): AuditChainWalk & { readonly observedChained: number } {
  const need = headCount - fromIndex;
  if (need <= 0) {
    return { chained: [], malformedLines: 0, unhashedLines: 0, observedChained: 0 };
  }

  const files = orderedAuditFiles(auditDir);
  // Accumulate tail events in reverse-file order, prepending each file's
  // chained events, until we hold at least `need` of them.
  const collected: AuditEvent[] = [];
  let malformedLines = 0;
  let unhashedLines = 0;
  let observedChained = 0;

  for (let f = files.length - 1; f >= 0 && collected.length < need; f -= 1) {
    const file = files[f];
    if (file === undefined) continue;
    const lines = readFileSync(file, 'utf-8').split('\n');
    const fileChained: AuditEvent[] = [];
    for (const line of lines) {
      if (line.length === 0) continue;
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(line) as Record<string, unknown>;
      } catch {
        malformedLines += 1;
        continue;
      }
      const v = typeof event.v === 'number' ? event.v : 0;
      if (v === EVENT_FORMAT_VERSION) {
        if (typeof event.hash !== 'string') unhashedLines += 1;
        fileChained.push(event as unknown as AuditEvent);
      }
    }
    observedChained += fileChained.length;
    // Prepend this (older) file's chained events ahead of the newer ones
    // already collected, so `collected` stays in ascending chain order.
    collected.unshift(...fileChained);
  }

  // The last chained event on disk is index headCount - 1. Assign absolute
  // indices to the collected window from the tail backwards, then keep only
  // the ones at or after `fromIndex`. When more than `need` were collected
  // (the boundary file held extra older events), the surplus is at the FRONT.
  const lastIndex = headCount - 1;
  const firstCollectedIndex = lastIndex - (collected.length - 1);
  const chained: ChainedEvent[] = [];
  for (let i = 0; i < collected.length; i += 1) {
    const index = firstCollectedIndex + i;
    if (index < fromIndex) continue;
    const event = collected[i];
    if (event === undefined) continue;
    chained.push({ index, event });
  }

  return { chained, malformedLines, unhashedLines, observedChained };
}
