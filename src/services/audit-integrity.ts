import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { SqliteAdapter } from '../storage/sqlite/sqlite-adapter.js';

/**
 * Severity bucket for a check. `error` fails the doctor exit code;
 * `warning` keeps exit 0 but renders a yellow `⚠` so the line stands
 * out in the checklist. Defaults to `error` when omitted.
 */
export type IntegrityCheckSeverity = 'error' | 'warning';

/**
 * One verdict line produced by an integrity inspection. Shared between
 * `mnema doctor` (which renders it as a checklist row) and the
 * `audit_verify` MCP tool (which returns it as structured JSON).
 */
export interface IntegrityCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
  readonly severity?: IntegrityCheckSeverity;
}

/**
 * Walks every JSONL file under `auditDir` in chain order, parses each
 * line, and verifies the SHA-256 chain END TO END — across the rotated
 * `YYYY-MM.jsonl` segments and `current.jsonl` as one continuous sequence
 * — against the head hash stored in SQLite. Returns one or more
 * {@link IntegrityCheck} rows.
 *
 * The check covers four invariants:
 * - **count**: parseable lines on disk match `audit_state.event_count`.
 * - **chain head**: hash of the last line equals `chain_head_hash`.
 * - **chain continuity**: each line's `prev_hash` matches the previous
 *   line's `hash` (per-file).
 * - **strict parsing**: any line that failed `JSON.parse` is surfaced
 *   as a warning (a smokescreen for forged lines), not silently dropped.
 *
 * Projects whose audit log predates the integrity feature
 * (`chain_head_hash IS NULL` and `event_count = 0`) are reported as
 * `legacy` and skipped — the integrity check activates on the first
 * write through the new writer.
 *
 * @param adapter - Open SQLite adapter
 * @param auditDir - Absolute path to `.mnema/audit/`
 * @returns Audit-integrity checks
 */
export function inspectAuditIntegrity(adapter: SqliteAdapter, auditDir: string): IntegrityCheck[] {
  const checks: IntegrityCheck[] = [];
  if (!existsSync(auditDir)) {
    checks.push({
      name: 'audit integrity',
      ok: true,
      detail: 'no audit directory',
      severity: 'warning',
    });
    return checks;
  }

  const stateRow = adapter
    .getDatabase()
    .prepare('SELECT event_count, last_event_at, chain_head_hash FROM audit_state WHERE id = 1')
    .get() as
    | { event_count: number; last_event_at: string | null; chain_head_hash: string | null }
    | undefined;

  if (stateRow === undefined) {
    checks.push({
      name: 'audit integrity',
      ok: false,
      detail: 'audit_state row missing — run `mnema migrate`',
      severity: 'error',
    });
    return checks;
  }

  const files = orderedAuditFiles(auditDir);

  // Events that belong to the hash chain (v >= 2). `audit_state.event_count`
  // tracks exactly these, so the count check compares against this — not
  // the total line count, which also includes pre-chain legacy lines (v1)
  // written before the integrity feature that never entered the counter.
  // Counting all lines reports a false mismatch on any project with
  // legacy history. Legacy lines are tallied separately for the report.
  let chainedLines = 0;
  let legacyLines = 0;
  let malformedLines = 0;
  let chainBroken = false;
  let chainBreakDetail = '';
  let lastHash: string | null = null;
  let chainEverStarted = false;
  // The running chain head, carried ACROSS files. The chain is a single
  // sequence even though rotation splits it into `YYYY-MM.jsonl` segments
  // plus `current.jsonl`, so the first line of one file links to the tail
  // of the previous one. Resetting per file (the old behaviour) reported a
  // false `prev_hash break` at every rotation boundary. Genesis is `null`;
  // a legacy (v1) line resets it since pre-chain lines have no hash.
  let prevHash: string | null = null;

  for (const file of files) {
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
        chainEverStarted = true;
        chainedLines += 1;
        const hash = typeof event.hash === 'string' ? event.hash : null;
        const prev = (event.prev_hash ?? null) as string | null;
        const { hash: _h, ...rest } = event;
        const recomputed = createHash('sha256').update(JSON.stringify(rest)).digest('hex');
        if (hash !== recomputed) {
          chainBroken = true;
          chainBreakDetail = `hash mismatch on a line in ${path.basename(file)}`;
        }
        if (prev !== prevHash) {
          chainBroken = true;
          // A break on the first line of a rotated segment means the
          // previous segment's tail is missing or altered (e.g. a whole
          // archived month was deleted) — name that explicitly.
          chainBreakDetail =
            prevHash === null
              ? `prev_hash break at the start of ${path.basename(file)} (a prior segment may be missing)`
              : `prev_hash break on a line in ${path.basename(file)}`;
        }
        prevHash = hash;
        lastHash = hash;
      } else {
        // Legacy line: no per-line chain; counted separately so it does
        // not inflate the chain-count comparison below.
        legacyLines += 1;
        prevHash = null;
      }
    }
  }

  // No new-format lines anywhere: the project predates the integrity
  // feature. Report as warning so the user knows the check is dormant.
  if (!chainEverStarted && stateRow.chain_head_hash === null) {
    checks.push({
      name: 'audit integrity',
      ok: true,
      detail: 'legacy audit log (no hash chain yet — activates on next event)',
      severity: 'warning',
    });
    return checks;
  }

  // Surface legacy lines so a human can still reconcile the disk total
  // (chained + legacy = lines on disk).
  const legacyNote = legacyLines > 0 ? ` (+${legacyLines} legacy pre-chain)` : '';
  if (chainedLines !== stateRow.event_count) {
    checks.push({
      name: 'audit event count',
      ok: false,
      detail: `disk has ${chainedLines} chained events${legacyNote}, audit_state has ${stateRow.event_count}`,
      severity: 'error',
    });
  } else {
    checks.push({
      name: 'audit event count',
      ok: true,
      detail: `${chainedLines} chained events match audit_state.event_count${legacyNote}`,
    });
  }

  if (chainBroken) {
    checks.push({
      name: 'audit hash chain',
      ok: false,
      detail: chainBreakDetail,
      severity: 'error',
    });
  } else if (lastHash !== stateRow.chain_head_hash) {
    checks.push({
      name: 'audit hash chain',
      ok: false,
      detail: 'tail hash on disk does not match audit_state.chain_head_hash',
      severity: 'error',
    });
  } else {
    checks.push({
      name: 'audit hash chain',
      ok: true,
      detail: `verified up to ${lastHash?.slice(0, 12) ?? '(empty)'}…`,
    });
  }

  if (malformedLines > 0) {
    checks.push({
      name: 'audit lines parse',
      ok: false,
      detail: `${malformedLines} unparseable line(s) — possible smokescreen for tampering`,
      severity: 'warning',
    });
  }

  return checks;
}

/**
 * Lists the audit JSONL files in chain order: the archived monthly
 * segments (`YYYY-MM.jsonl`) oldest-first, then the active `current.jsonl`
 * last. Rotation only ever renames `current.jsonl` to a past month, so the
 * running chain is exactly [oldest month … newest month, current]. Relying
 * on a plain lexicographic sort happens to work only because `current`
 * sorts after digits; ordering explicitly makes the chain walk correct and
 * robust to any future segment naming.
 *
 * @param auditDir - Directory holding the audit log files
 * @returns Absolute paths in chain order (may be empty)
 */
export function orderedAuditFiles(auditDir: string): string[] {
  if (!existsSync(auditDir)) return [];
  const names = readdirSync(auditDir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('.jsonl'))
    .map((d) => d.name);
  const current = names.filter((n) => n === 'current.jsonl');
  const archived = names.filter((n) => n !== 'current.jsonl').sort();
  return [...archived, ...current].map((n) => path.join(auditDir, n));
}
