import type { AuditEvent } from '../../storage/audit/audit-writer.js';

/** A single (label, value) point in a time or category series. */
export interface SeriesPoint {
  /** X label — a `YYYY-MM-DD` day for time series, a kind/name for categories. */
  readonly label: string;
  /** Y value — a count. */
  readonly value: number;
}

/**
 * The audit trail carries no time-bucketed series of its own; these pure
 * helpers derive them from the raw event stream (`AuditQuery.run()`
 * output). This is DERIVATION over already-recorded data — no new
 * collection — and each function is a pure transform of its input array,
 * so it unit-tests against fixtures with no IO.
 */

/** The workflow's terminal states, used to detect a task "completing". */
export type TerminalStates = ReadonlySet<string>;

/** Extracts the `YYYY-MM-DD` day from an ISO8601 timestamp, or null. */
function dayOf(at: string): string | null {
  // Take the date portion directly from the ISO string rather than
  // constructing a Date — deterministic, timezone-stable (UTC day as
  // written), and avoids the banned Date-now/parse ambiguity.
  const m = at.match(/^(\d{4}-\d{2}-\d{2})/);
  return m === null ? null : (m[1] ?? null);
}

/**
 * Fills a contiguous run of `YYYY-MM-DD` days from the first to the last
 * observed day so a line chart has no gaps. Returns the input untouched
 * when it has fewer than two points.
 */
function fillDays(points: SeriesPoint[]): SeriesPoint[] {
  if (points.length < 2) return points;
  const byDay = new Map(points.map((p) => [p.label, p.value]));
  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];
  if (firstPoint === undefined || lastPoint === undefined) return points;
  const first = firstPoint.label;
  const last = lastPoint.label;
  const firstMs = Date.parse(`${first}T00:00:00Z`);
  const endMs = Date.parse(`${last}T00:00:00Z`);
  if (Number.isNaN(firstMs) || Number.isNaN(endMs)) return points;

  // Cap the number of emitted days so a pathological range can't blow up
  // the array. Crucially, when the range exceeds the cap we keep the MOST
  // RECENT window (count back from the last day), not the oldest — a chart
  // must never silently drop its newest data. The dropped older days are a
  // deliberate, bounded trade-off for a fixed-width series.
  const MAX_DAYS = 366;
  const startMs = Math.max(firstMs, endMs - (MAX_DAYS - 1) * 86_400_000);
  const out: SeriesPoint[] = [];
  for (let cursor = startMs; cursor <= endMs; cursor += 86_400_000) {
    const day = new Date(cursor).toISOString().slice(0, 10);
    out.push({ label: day, value: byDay.get(day) ?? 0 });
  }
  return out;
}

/**
 * Counts audit events per calendar day (UTC), oldest day first, with gaps
 * filled so a line renders continuously.
 *
 * @param events - Audit events (any order)
 * @returns One point per day in [firstDay, lastDay]
 */
export function activityByDay(events: readonly AuditEvent[]): SeriesPoint[] {
  const counts = new Map<string, number>();
  for (const e of events) {
    const day = dayOf(e.at);
    if (day === null) continue;
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  const points = [...counts.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return fillDays(points);
}

/**
 * Counts tasks reaching a terminal state per calendar day (UTC) —
 * throughput over time. A `task_transitioned` event whose `data.to` is a
 * terminal state is one completion.
 *
 * @param events - Audit events (any order)
 * @param terminal - The workflow's terminal state names
 * @returns One point per day in [firstDay, lastDay]
 */
export function throughputByDay(
  events: readonly AuditEvent[],
  terminal: TerminalStates,
): SeriesPoint[] {
  const counts = new Map<string, number>();
  for (const e of events) {
    if (e.kind !== 'task_transitioned') continue;
    const to = (e.data as Record<string, unknown>).to;
    if (typeof to !== 'string' || !terminal.has(to)) continue;
    const day = dayOf(e.at);
    if (day === null) continue;
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  const points = [...counts.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return fillDays(points);
}

/**
 * Counts events by `kind`, most frequent first — the breakdown behind an
 * events-by-kind bar chart and the activity legend.
 *
 * @param events - Audit events (any order)
 * @returns One point per distinct kind, descending by count
 */
export function eventsByKind(events: readonly AuditEvent[]): SeriesPoint[] {
  const counts = new Map<string, number>();
  for (const e of events) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
  return [...counts.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}
