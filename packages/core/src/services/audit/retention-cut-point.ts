import { readFileSync } from 'node:fs';
import path from 'node:path';
import { orderedAuditFiles } from '../../storage/audit/audit-files.js';
import { EVENT_FORMAT_VERSION } from '../../storage/audit/audit-hash.js';

/**
 * The audit retention strategy, mirroring `config.audit.retention.strategy`:
 *
 * - `full` — keep every segment forever. No cut point is ever produced.
 * - `recent` — keep the last N months hot but do NOT delete the older
 *   segments; they stay committed and verifiable behind the checkpoint. The
 *   cut point is computed (so callers can report what WOULD be archived) but
 *   the apply step never deletes for `recent`.
 * - `local` — actually delete the segments below the cut for a lean local
 *   cache. This is the only destructive strategy.
 *
 * Both `recent` and `local` compute the SAME cut point for a given N; the
 * strategy only decides whether the apply step deletes. This keeps the
 * boundary math in one place and the destructive/non-destructive choice out
 * of it.
 */
export type RetentionStrategy = 'full' | 'recent' | 'local';

/** One audit segment as the cut-point math sees it. */
export interface AuditSegment {
  /**
   * The segment's month key (`YYYY-MM`) for an archived segment, or `null`
   * for the active `current.jsonl` (its month is implicitly "now").
   */
  readonly month: string | null;
  /** Absolute path to the segment file. */
  readonly file: string;
  /** Count of chained (keyed) events in this segment. */
  readonly chainedEvents: number;
}

/**
 * The prune cut point: which segments fall below the retention window and the
 * chained-event index the surviving chain would be re-baselined onto.
 */
export interface CutPoint {
  /** The strategy that produced this cut. */
  readonly strategy: RetentionStrategy;
  /**
   * Whether anything falls below the cut. `false` for `full`, for an empty
   * log, and whenever the whole history already fits inside the window.
   */
  readonly hasCut: boolean;
  /**
   * The segments below the cut (oldest-first) — the prefix that `local` would
   * delete and `recent` would leave archived. Empty when `hasCut` is false.
   */
  readonly dropped: readonly AuditSegment[];
  /** The segments at or above the cut (oldest-first), always kept. */
  readonly kept: readonly AuditSegment[];
  /**
   * The 0-based chained-event index the surviving chain starts at — i.e. the
   * number of chained events in the dropped prefix. This is the re-baseline
   * boundary: after a prune the surviving oldest event becomes the new
   * genesis, and events `[0, keepFromIndex)` are the ones the prune-anchor
   * digest attests. `0` when `hasCut` is false.
   */
  readonly keepFromIndex: number;
  /**
   * The number of chained events that survive (`kept` total). The apply step
   * re-baselines `audit_state.event_count` to this.
   */
  readonly keptEventCount: number;
}

/**
 * Counts the chained (keyed) events in one segment file. A segment's events are
 * a contiguous run of the whole-chain index, so counting per file lets the cut
 * point land exactly on a segment boundary without walking the entire chain
 * twice.
 *
 * Malformed and non-keyed lines are not chained events and are not counted —
 * consistent with {@link walkChainedEvents}, which never advances the chained
 * index for them. A cut is only ever taken on a healthy chain (the apply step
 * gates on `assessAuditChain` first), so this count matching `event_count` is
 * the caller's precondition, not this function's job to enforce.
 */
function countChainedEvents(file: string): number {
  let count = 0;
  const lines = readFileSync(file, 'utf-8').split('\n');
  for (const line of lines) {
    if (line.length === 0) continue;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const v = typeof event.v === 'number' ? event.v : 0;
    if (v === EVENT_FORMAT_VERSION) count += 1;
  }
  return count;
}

/** Derives a segment's month key from its filename, or `null` for `current`. */
function segmentMonth(file: string): string | null {
  const base = path.basename(file);
  if (base === 'current.jsonl') return null;
  // Archived segments are named `YYYY-MM.jsonl` (audit-writer monthKey).
  const match = base.match(/^(\d{4}-\d{2})\.jsonl$/);
  return match?.[1] ?? null;
}

/**
 * Lists the audit segments in chain order with their chained-event counts.
 * Pure and read-only. The active `current.jsonl` sorts last (its month is
 * "now"), matching {@link orderedAuditFiles}.
 *
 * @param auditDir - Absolute path to `.mnema/audit/`
 * @returns Segments oldest-first (archived months, then current)
 */
export function listAuditSegments(auditDir: string): AuditSegment[] {
  return orderedAuditFiles(auditDir).map((file) => ({
    month: segmentMonth(file),
    file,
    chainedEvents: countChainedEvents(file),
  }));
}

/**
 * The month key `retentionMonths` before `now`, inclusive of the current
 * month. With `retentionMonths = 1` the window is just the current month;
 * with `12` it is the current month plus the eleven before it. An archived
 * segment whose month is strictly earlier than this key falls below the cut.
 *
 * Computed on year*12 + month arithmetic so it never depends on day-of-month
 * or wall-clock time within the month.
 */
function windowStartMonth(now: Date, retentionMonths: number): string {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0-based
  // Clamp at 0 (year 0000-01) so a retention window larger than the whole
  // calendar never underflows into a negative month key that would break the
  // string comparison — it just means "keep everything" (no real segment is
  // older than 0000-01).
  const total = Math.max(0, y * 12 + m - (retentionMonths - 1));
  const wy = Math.floor(total / 12);
  const wm = total % 12; // 0-based, always in [0, 11]
  return `${String(wy).padStart(4, '0')}-${String(wm + 1).padStart(2, '0')}`;
}

/**
 * Computes the retention cut point for an audit log. Pure and read-only — it
 * only reads segment files to count their chained events; it never deletes,
 * re-baselines, or signs anything (the apply step and the waiver format do
 * that).
 *
 * Semantics:
 * - `full` → no cut, ever (`hasCut: false`).
 * - `recent`/`local` → keep every segment whose month is at or after the
 *   `retentionMonths`-wide window ending "now", plus `current` (always kept);
 *   drop the strictly-older archived prefix. Both strategies compute the SAME
 *   cut; only the apply step's destructiveness differs.
 *
 * The cut always lands on a segment boundary — an archived segment is dropped
 * whole or kept whole, never split — so `keepFromIndex` is exactly the chained
 * count of the dropped prefix, which is a re-baseline boundary the integrity
 * walk can accept via a signed prune waiver.
 *
 * @param auditDir - Absolute path to `.mnema/audit/`
 * @param strategy - Configured `audit.retention.strategy`
 * @param retentionMonths - Configured `audit.retention.months` (>= 1)
 * @param now - Reference time (the current month anchors the window)
 * @returns The cut point
 */
export function computeCutPoint(
  auditDir: string,
  strategy: RetentionStrategy,
  retentionMonths: number,
  now: Date,
): CutPoint {
  const segments = listAuditSegments(auditDir);

  const empty: CutPoint = {
    strategy,
    hasCut: false,
    dropped: [],
    kept: segments,
    keepFromIndex: 0,
    keptEventCount: segments.reduce((n, s) => n + s.chainedEvents, 0),
  };

  if (strategy === 'full' || segments.length === 0) return empty;

  const cutoff = windowStartMonth(now, Math.max(1, retentionMonths));

  // An archived segment (month !== null) is dropped when its month is strictly
  // before the window start. `current` (month === null) is never dropped, and
  // a segment whose name did not parse to a month is treated as in-window
  // (kept) — never silently dropped.
  const dropped: AuditSegment[] = [];
  const kept: AuditSegment[] = [];
  for (const seg of segments) {
    if (seg.month !== null && seg.month < cutoff) dropped.push(seg);
    else kept.push(seg);
  }

  if (dropped.length === 0) return empty;

  const keepFromIndex = dropped.reduce((n, s) => n + s.chainedEvents, 0);
  const keptEventCount = kept.reduce((n, s) => n + s.chainedEvents, 0);

  return { strategy, hasCut: true, dropped, kept, keepFromIndex, keptEventCount };
}
