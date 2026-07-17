import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { auditTailDirs, orderedAuditFiles } from '../../storage/audit/audit-files.js';
import type { AuditEvent } from '../../storage/audit/audit-writer.js';

/**
 * Filter for {@link AuditQuery.run}.
 *
 * Empty filters return every event in the audit directory.
 */
export interface AuditQueryFilter {
  /** Match `event.kind` exactly. */
  readonly kind?: string;
  /** Match `event.actor` exactly. */
  readonly actor?: string;
  /** Match `event.via` exactly. */
  readonly via?: string;
  /** Match `event.run` exactly. */
  readonly run?: string;
  /**
   * Match a task key against either `event.data.key` (task_created,
   * task_transitioned) or `event.data.task_key` (note_added,
   * attachment_added). Decisions use `data.key` with a `MNEMA-ADR-`
   * prefix and therefore do not collide with task keys.
   */
  readonly taskKey?: string;
  /** Lower bound for `event.at`. Either an ISO8601 string or a Date. */
  readonly since?: string | Date;
  /** Upper bound for `event.at`. Either an ISO8601 string or a Date. */
  readonly until?: string | Date;
  /** Maximum number of matches to return. */
  readonly limit?: number;
}

/**
 * Query helper over the JSONL audit log files.
 *
 * Combines the active `current.jsonl` with archived `YYYY-MM.jsonl`
 * files, applies the requested filters in memory, and returns events
 * in chronological order.
 *
 * The audit volume is intentionally small (one line per mutation), so
 * a streaming SQL-style query layer would be overkill. A future phase
 * may push filters down if the file grows beyond expectations.
 */
export class AuditQuery {
  constructor(private readonly auditDir: string) {}

  /**
   * Reads matching events from the audit directory.
   *
   * Malformed lines that fail `JSON.parse` are silently skipped. Use
   * {@link AuditQuery.runStrict} if you need to know whether the read
   * had to drop anything — `doctor` does, to flag potential tampering
   * (an attacker may write garbage as a smokescreen around a forged
   * line, hoping the reader silently drops both).
   *
   * @param filter - Filter parameters; an empty object returns everything
   * @returns Matching events ordered by `at`
   */
  run(filter: AuditQueryFilter = {}): AuditEvent[] {
    return this.runStrict(filter).events;
  }

  /**
   * Same as {@link AuditQuery.run} but additionally reports how many
   * lines failed to parse and the per-file breakdown. Callers who
   * surface integrity warnings (notably `mnema doctor`) use this
   * variant.
   *
   * @param filter - Filter parameters; an empty object returns everything
   * @returns Events plus a small diagnostic block
   */
  runStrict(filter: AuditQueryFilter = {}): {
    readonly events: AuditEvent[];
    readonly malformedLines: number;
    readonly malformedByFile: ReadonlyMap<string, number>;
  } {
    if (!existsSync(this.auditDir)) {
      return { events: [], malformedLines: 0, malformedByFile: new Map() };
    }

    const sinceMs = parseTimeBound(filter.since);
    const untilMs = parseTimeBound(filter.until);
    const matches: AuditEvent[] = [];
    const malformedByFile = new Map<string, number>();
    let malformedLines = 0;

    // Read every machine tail and merge by `at` — each tail is an independent
    // chain, but for QUERY (display) the events are one chronological stream.
    // The cryptographic per-tail truth lives in the integrity walk, not here.
    for (const tail of auditTailDirs(this.auditDir)) {
      for (const file of orderedAuditFiles(tail)) {
        // Skip an archived monthly segment whose entire month falls outside
        // the [since, until] window — a `since=30d` query on a project with
        // years of archives should not read every segment. Only files named
        // `YYYY-MM.jsonl` are candidates; `current.jsonl` (and any other
        // name) is always read. A month that straddles a bound is kept.
        if (monthlyFileOutOfWindow(path.basename(file), sinceMs, untilMs)) continue;

        const lines = readFileSync(file, 'utf-8').split('\n');
        for (const line of lines) {
          if (line.length === 0) continue;
          let event: AuditEvent;
          try {
            event = JSON.parse(line) as AuditEvent;
          } catch {
            malformedLines += 1;
            malformedByFile.set(file, (malformedByFile.get(file) ?? 0) + 1);
            continue;
          }

          if (filter.kind !== undefined && event.kind !== filter.kind) continue;
          if (filter.actor !== undefined && event.actor !== filter.actor) continue;
          if (filter.via !== undefined && event.via !== filter.via) continue;
          if (filter.run !== undefined && event.run !== filter.run) continue;
          if (filter.taskKey !== undefined && !matchesTaskKey(event, filter.taskKey)) continue;

          if (sinceMs !== null || untilMs !== null) {
            const eventMs = Date.parse(event.at);
            if (Number.isNaN(eventMs)) continue;
            if (sinceMs !== null && eventMs < sinceMs) continue;
            if (untilMs !== null && eventMs > untilMs) continue;
          }

          matches.push(event);
        }
      }
    }

    matches.sort((a, b) => a.at.localeCompare(b.at));

    // Apply the limit only when it is a positive integer. A non-positive or
    // non-finite limit (NaN from a bad caller, a negative value) must not slice
    // — `length > -2` is always true and would slice past the array end,
    // returning the wrong window. Treat such values as "no limit".
    const limit = filter.limit;
    const events =
      limit !== undefined && Number.isInteger(limit) && limit > 0 && matches.length > limit
        ? matches.slice(matches.length - limit)
        : matches;
    return { events, malformedLines, malformedByFile };
  }
}

/**
 * Parses a `--since` value into a millisecond epoch.
 *
 * Accepts:
 * - `Date` instances and ISO8601 strings (used as-is)
 * - Relative durations like `30s`, `15m`, `2h`, `7d`
 *
 * @param value - Raw bound from caller
 * @returns Epoch milliseconds, or `null` when no bound was supplied
 */
export function parseTimeBound(value: string | Date | undefined): number | null {
  if (value === undefined) return null;
  if (value instanceof Date) return value.getTime();

  const match = value.match(/^(\d+)([smhd])$/);
  if (match !== null) {
    const amount = Number.parseInt(match[1] ?? '0', 10);
    const unit = match[2] ?? 's';
    const seconds = amount * unitToSeconds(unit);
    return Date.now() - seconds * 1000;
  }

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return null;
  return parsed;
}

/**
 * Whether an archived monthly segment can be skipped entirely for a query
 * bounded by `[sinceMs, untilMs]`. Only files named `YYYY-MM.jsonl`
 * qualify; anything else (notably `current.jsonl`) returns `false` and is
 * always read. A segment is out of window when its whole month ends before
 * `since` or begins after `until`; a month that straddles either bound is
 * kept so no in-window event is missed.
 *
 * @param basename - File name, e.g. `2019-01.jsonl` or `current.jsonl`
 * @param sinceMs - Lower bound epoch ms, or `null` for no lower bound
 * @param untilMs - Upper bound epoch ms, or `null` for no upper bound
 * @returns `true` if the file's month lies wholly outside the window
 */
function monthlyFileOutOfWindow(
  basename: string,
  sinceMs: number | null,
  untilMs: number | null,
): boolean {
  if (sinceMs === null && untilMs === null) return false;
  const match = basename.match(/^(\d{4})-(\d{2})\.jsonl$/);
  if (match === null) return false; // current.jsonl / unknown names: always read

  const year = Number.parseInt(match[1] as string, 10);
  const month = Number.parseInt(match[2] as string, 10); // 1-12
  // Half-open month span [monthStart, nextMonthStart) in UTC.
  const monthStart = Date.UTC(year, month - 1, 1);
  const nextMonthStart = Date.UTC(year, month, 1);

  // Whole month precedes `since` (its last instant is < since).
  if (sinceMs !== null && nextMonthStart <= sinceMs) return true;
  // Whole month follows `until` (its first instant is > until).
  if (untilMs !== null && monthStart > untilMs) return true;
  return false;
}

function matchesTaskKey(event: AuditEvent, taskKey: string): boolean {
  const data = event.data as Record<string, unknown>;
  return data.key === taskKey || data.task_key === taskKey;
}

function unitToSeconds(unit: string): number {
  switch (unit) {
    case 's':
      return 1;
    case 'm':
      return 60;
    case 'h':
      return 60 * 60;
    case 'd':
      return 60 * 60 * 24;
    default:
      return 1;
  }
}
