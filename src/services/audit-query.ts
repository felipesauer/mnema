import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { AuditEvent } from '../storage/audit/audit-writer.js';

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
   * @param filter - Filter parameters; an empty object returns everything
   * @returns Matching events ordered by `at`
   */
  run(filter: AuditQueryFilter = {}): AuditEvent[] {
    if (!existsSync(this.auditDir)) return [];

    const sinceMs = parseTimeBound(filter.since);
    const untilMs = parseTimeBound(filter.until);
    const files = listAuditFiles(this.auditDir);
    const matches: AuditEvent[] = [];

    for (const file of files) {
      const lines = readFileSync(file, 'utf-8').split('\n');
      for (const line of lines) {
        if (line.length === 0) continue;
        let event: AuditEvent;
        try {
          event = JSON.parse(line) as AuditEvent;
        } catch {
          continue;
        }

        if (filter.kind !== undefined && event.kind !== filter.kind) continue;
        if (filter.actor !== undefined && event.actor !== filter.actor) continue;
        if (filter.via !== undefined && event.via !== filter.via) continue;
        if (filter.run !== undefined && event.run !== filter.run) continue;

        if (sinceMs !== null || untilMs !== null) {
          const eventMs = Date.parse(event.at);
          if (Number.isNaN(eventMs)) continue;
          if (sinceMs !== null && eventMs < sinceMs) continue;
          if (untilMs !== null && eventMs > untilMs) continue;
        }

        matches.push(event);
      }
    }

    matches.sort((a, b) => a.at.localeCompare(b.at));

    const limit = filter.limit;
    if (limit !== undefined && matches.length > limit) {
      return matches.slice(matches.length - limit);
    }
    return matches;
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

function listAuditFiles(auditDir: string): string[] {
  return readdirSync(auditDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
    .map((entry) => path.join(auditDir, entry.name))
    .sort();
}
