import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { auditFilesSignature, orderedAuditFiles } from '../storage/audit/audit-files.js';
import { hashEvent, hmacEvent } from '../storage/audit/audit-hash.js';
import type { AuditEvent } from '../storage/audit/audit-writer.js';
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
 * @param secret - Per-project HMAC secret for verifying v3 lines. When
 *   omitted, v3 lines are not hash-verified (their authenticity is
 *   unverifiable without the secret) but their `prev_hash` continuity is
 *   still checked; a v2-only log is unaffected.
 * @returns Audit-integrity checks
 */
export function inspectAuditIntegrity(
  adapter: SqliteAdapter,
  auditDir: string,
  secret: Buffer | null = null,
): IntegrityCheck[] {
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
  let v3Unverifiable = 0;
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
        // Dispatch by version: v3 is HMAC-keyed (needs the secret), v2 is
        // keyless SHA-256. A v3 line with no secret available cannot be
        // hash-verified here — flag it as unverifiable rather than a false
        // tamper; its prev_hash continuity is still checked below.
        if (v >= 3 && secret === null) {
          v3Unverifiable += 1;
        } else {
          const recomputed =
            v >= 3
              ? hmacEvent(event as unknown as AuditEvent, secret as Buffer)
              : hashEvent(event as unknown as AuditEvent);
          if (hash !== recomputed) {
            chainBroken = true;
            chainBreakDetail = `hash mismatch on a line in ${path.basename(file)}`;
          }
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

  // v3 lines are HMAC-keyed with the project secret. Without the secret
  // (a clone that has not imported it) their authenticity cannot be
  // checked — report it as a warning, never a tamper error: the chain
  // consistency above still holds, only project-authenticity is unproven.
  if (v3Unverifiable > 0) {
    checks.push({
      name: 'audit authenticity',
      ok: false,
      detail: `${v3Unverifiable} HMAC-keyed (v3) line(s) could not be verified — project secret not present. Import it with the project secret to verify authenticity.`,
      severity: 'warning',
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
 * Caches {@link inspectAuditIntegrity} keyed by a cheap audit-file
 * signature ({@link auditFilesSignature}), recomputing only when the log
 * actually changes. Intended for hot repeated callers — notably the live
 * dashboard, which composes a snapshot per HTTP request and per tab
 * switch and would otherwise re-hash the whole chain every time.
 *
 * The signature is `stat`-based (mtime + size per file), so it flips on an
 * append, a rotation, AND an in-place edit of a past line that keeps the
 * size identical (the tampering shape) — the cache therefore never serves
 * a stale "integrity OK" over a mutated log. Non-dashboard callers
 * (`doctor`, `audit_verify`) keep calling {@link inspectAuditIntegrity}
 * directly and are unaffected.
 */
export class CachedAuditIntegrity {
  private signature: string | null = null;
  private cached: IntegrityCheck[] | null = null;

  constructor(
    private readonly adapter: SqliteAdapter,
    private readonly auditDir: string,
    private readonly secret: Buffer | null = null,
  ) {}

  /**
   * Returns the integrity checks, recomputing only when the audit files
   * changed since the last call.
   *
   * @returns The (possibly cached) integrity checks
   */
  get(): IntegrityCheck[] {
    const signature = auditFilesSignature(this.auditDir);
    if (this.cached !== null && signature === this.signature) {
      return this.cached;
    }
    const checks = inspectAuditIntegrity(this.adapter, this.auditDir, this.secret);
    this.signature = signature;
    this.cached = checks;
    return checks;
  }
}
