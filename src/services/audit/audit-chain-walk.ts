import { readFileSync } from 'node:fs';
import { orderedAuditFiles } from '../../storage/audit/audit-files.js';
import type { AuditEvent } from '../../storage/audit/audit-writer.js';

/**
 * One chained (schema v>=2) event as seen on disk, carrying the index the
 * attestation layer addresses it by. That index is the position in the
 * CHAINED sequence — the same thing `audit_state.event_count` counts — NOT the
 * raw line number, so pre-chain legacy (v1) lines never shift it. An
 * attestation over `[from, to)` therefore covers `chainedEvents[from … to-1]`.
 */
export interface ChainedEvent {
  /** 0-based position in the chained (v>=2) sequence. */
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
 * legacy/malformed/downgrade shapes for the doctor report; this one only needs
 * the chained events by index so a batch `[from, to)` can be reconstructed.
 * Kept separate so the attestation layer does not depend on — nor risk
 * changing — the integrity verdicts. A malformed line is skipped (it is not a
 * chained event), mirroring the integrity walk, which counts it separately
 * without advancing the chained index.
 */
export interface AuditChainWalk {
  /** Every chained (v>=2) event, in order, indexed from 0. */
  readonly chained: readonly ChainedEvent[];
  /** Count of unparseable lines encountered (skipped, not indexed). */
  readonly malformedLines: number;
  /**
   * Count of chained (v>=2) events that carry NO string `hash`. They are still
   * indexed (so the chained index stays aligned with `event_count`, which
   * counts every v>=2 line), but a batch containing one cannot be attested:
   * its leaf/head derivation needs the `hash`. A caller (the reattest planner)
   * refuses when this is non-zero rather than letting the emitter throw.
   */
  readonly unhashedLines: number;
}

/**
 * Walks every audit JSONL file under `auditDir` in chain order (archived
 * `YYYY-MM.jsonl` segments oldest-first, then `current.jsonl`) and collects
 * the chained (v>=2) events with their chained-sequence index.
 *
 * A line is "chained" exactly when its `v` field is a number `>= 2` — the same
 * rule the integrity walk uses to populate `event_count`. Legacy (v1 or
 * version-less) lines and unparseable lines do not advance the chained index;
 * unparseable lines are tallied so a caller can refuse to act on a log that
 * may be hiding a deletion behind a garbage line.
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
      const v = typeof event.v === 'number' ? event.v : 1;
      if (v >= 2) {
        // Index every v>=2 line so the chained index stays aligned with
        // event_count (which counts them all). A v>=2 line with no string
        // `hash` is still indexed but tallied: the attestation planner refuses
        // a batch that contains one, instead of the emitter throwing on it.
        if (typeof event.hash !== 'string') unhashedLines += 1;
        chained.push({ index, event: event as unknown as AuditEvent });
        index += 1;
      }
      // Legacy (v1) lines carry no per-line chain and are not attested; they
      // simply do not advance the chained index (same as the integrity walk).
    }
  }

  return { chained, malformedLines, unhashedLines };
}
