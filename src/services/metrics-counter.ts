import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { appendCappedJsonl } from '../utils/capped-jsonl.js';

/**
 * Cap on the local usage counter: like the crash log it is best-effort,
 * git-ignored, never-transmitted diagnostics, so it must not grow without
 * bound. Same drop-oldest rotation and value as the error log.
 */
const MAX_COUNTER_ENTRIES = 500;

/**
 * A single recorded use of a read-only command. These live in a LOCAL
 * counter log, deliberately OUTSIDE the SHA-256 audit chain: read-only
 * operations must not write to the chain (MNEMA-ADR-20), and a usage tally
 * is not an audit record. It is local-only and never transmitted
 * (zero-telemetry), and lossy by design — recording a use must never fail
 * the command it counts. See MNEMA-ADR-36.
 */
export interface CounterEntry {
  /** e.g. `doctor_ran`. */
  readonly kind: string;
  /** ISO8601 timestamp of the use. */
  readonly at: string;
}

/** Path to the local counter log, given the project's state dir. */
function counterFile(stateDir: string): string {
  return path.join(stateDir, 'metrics.jsonl');
}

/**
 * Appends one counter entry to the local metrics log, best-effort. Any
 * error (unwritable dir, disk full) is swallowed: instrumenting a
 * read-only command must never make that command fail. Not chained, not
 * transmitted — a local tally only.
 *
 * @param stateDir - Absolute path to the project's `.mnema/state` dir
 * @param kind - The counter kind (e.g. `doctor_ran`)
 * @param at - ISO8601 timestamp for the entry
 */
export function recordCounter(stateDir: string, kind: string, at: string): void {
  try {
    // Capped drop-oldest append (crash-safe rewrite at the cap): the counter
    // is a bounded local tally, not a durable log.
    appendCappedJsonl(counterFile(stateDir), JSON.stringify({ kind, at }), MAX_COUNTER_ENTRIES);
  } catch {
    // Best-effort: never let a usage tally break the command.
  }
}

/**
 * Reads all counter entries from the local metrics log. Missing file → no
 * entries. Malformed lines are skipped (the log is not tamper-evident and
 * a partial line must not crash the reader).
 *
 * @param stateDir - Absolute path to the project's `.mnema/state` dir
 * @returns The recorded counter entries, in file order
 */
export function readCounters(stateDir: string): CounterEntry[] {
  const file = counterFile(stateDir);
  if (!existsSync(file)) return [];
  let raw: string;
  try {
    raw = readFileSync(file, 'utf-8');
  } catch {
    return [];
  }
  // Strip a leading UTF-8 BOM so the first line still parses (Node's
  // utf-8 read does not remove it).
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  const entries: CounterEntry[] = [];
  for (const line of raw.split('\n')) {
    if (line.length === 0) continue;
    try {
      const parsed = JSON.parse(line) as Partial<CounterEntry>;
      if (typeof parsed.kind === 'string' && typeof parsed.at === 'string') {
        entries.push({ kind: parsed.kind, at: parsed.at });
      }
    } catch {
      // Skip a malformed/partial line.
    }
  }
  return entries;
}
