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
 * Minimal structural view of the project-secret service the cache reads,
 * kept local so audit-integrity does not depend on the concrete class.
 */
export interface SecretSource {
  read(): Buffer | null;
  readFingerprint(): string | null;
}

/** The persisted head signature the attestation check verifies. */
export interface HeadSignatureView {
  readonly coveredHeadHash: string;
  readonly signerActor: string;
  readonly signerFingerprint: string;
  readonly signature: string;
  /** `event_count` the signature was made at — the attested high-water mark. */
  readonly eventCountAt: number;
}

/**
 * Minimal structural view of the machine-attestation sources, kept local so
 * audit-integrity does not depend on the repository or key-service classes.
 * `readHeadSignature` returns the latest recorded head signature (or `null`
 * when none). `verifyHeadSignature` verifies it against the committed public
 * key of its signer, resolved by fingerprint — returns `null` when that
 * public key is not present in the repo (a signer whose `.pub` is missing).
 */
export interface AttestationSource {
  readHeadSignature(): HeadSignatureView | null;
  verifyHeadSignature(sig: HeadSignatureView): boolean | null;
}

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
 * @param hasFingerprint - Whether the project has a committed HMAC
 *   fingerprint. When true the project has adopted v3, so an all-v2 chain
 *   is a total downgrade and is reported as tampering. Independent of
 *   `secret`: a clone without the secret still has the (committed)
 *   fingerprint, so it still detects a wholesale downgrade.
 * @param attestation - Optional machine-attestation source. When wired,
 *   the latest recorded head signature is verified against the committed
 *   public key of its signer and reported as a SEPARATE verdict (`audit
 *   machine attestation`), distinct from chain consistency and HMAC
 *   authenticity. `null` omits the check.
 * @returns Audit-integrity checks
 */
export function inspectAuditIntegrity(
  adapter: SqliteAdapter,
  auditDir: string,
  secret: Buffer | null = null,
  hasFingerprint = false,
  attestation: AttestationSource | null = null,
  contentAttestation: IntegrityCheck | null = null,
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
  let anyV3 = false;
  // Highest chain version seen so far, to enforce monotonicity (the chain
  // may migrate v2→v3 but must never regress v3→v2).
  let maxVersionSeen = 0;
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
        if (v >= 3) anyV3 = true;
        // Version monotonicity: the chain version must never DECREASE. A
        // v2 line after a v3 line is a downgrade — an attacker rewriting a
        // v3 (HMAC) line as v2 (keyless SHA-256), which they can recompute
        // without the secret, to strip authenticity. Legitimate migration
        // only ever goes v2→v3, so a decrease is always tampering.
        if (v < maxVersionSeen) {
          chainBroken = true;
          chainBreakDetail = `version downgrade to v${v} on a line in ${path.basename(file)} (a v${maxVersionSeen} line preceded it) — the chain cannot regress`;
        }
        maxVersionSeen = Math.max(maxVersionSeen, v);
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

  // Fingerprint implies v3: a committed HMAC fingerprint means the project
  // adopted keyed events, so a chain with chained lines but NO v3 line is a
  // total downgrade — every v3 line rewritten to keyless v2. (Version
  // monotonicity above catches a partial downgrade; this catches a
  // wholesale one, where nothing remains as v3 to violate monotonicity.)
  // The fingerprint is committed under versioned .mnema/keys, so removing
  // it to evade this shows up in `git status`.
  if (hasFingerprint && chainedLines > 0 && !anyV3) {
    chainBroken = true;
    chainBreakDetail =
      'chain is entirely v2 but the project has a committed HMAC fingerprint — a wholesale v3→v2 downgrade (keyed events were stripped)';
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
  // The writer commits the SQLite mirror BEFORE appending the JSONL line, so
  // a crash in that window leaves the mirror EXACTLY one event ahead of disk.
  // That is a recoverable state — BUT it is byte-for-byte indistinguishable
  // from a malicious truncation of the last line (both leave the mirror one
  // ahead with a self-consistent disk tail). So it is neither a clean pass
  // nor a hard tamper error: report it as a WARNING that names both causes,
  // so a crash isn't a screaming false-positive yet a truncation is never
  // silently green. Any other discrepancy (mirror behind disk, or ahead by
  // more than one) is unambiguous tampering/corruption and stays an error.
  // The one-ahead state is benign ONLY when it is a clean crash/truncation
  // shape. If the log ALSO contains a malformed line or an interior legacy
  // (v1) line, the count shortfall is exactly what an attacker uses to
  // launder an interior deletion — a garbage line or a v1 chain-reset masks a
  // removed chained line while keeping the count off-by-one. That is not the
  // recoverable crash window; escalate to a hard error.
  const mirrorOneAhead = stateRow.event_count === chainedLines + 1;
  const oneAheadIsClean = mirrorOneAhead && malformedLines === 0 && legacyLines === 0;
  if (chainedLines === stateRow.event_count) {
    checks.push({
      name: 'audit event count',
      ok: true,
      detail: `${chainedLines} chained events match audit_state.event_count${legacyNote}`,
    });
  } else if (oneAheadIsClean) {
    checks.push({
      name: 'audit event count',
      ok: false,
      detail: `audit_state is one event ahead of disk (${stateRow.event_count} vs ${chainedLines}${legacyNote}) — either a crash between the mirror commit and the log append OR a truncation of the last line. A crash is reconciled at the next writer boot (the mirror is rewound to the on-disk tail); if this persists after a restart with no crash, investigate a truncation.`,
      severity: 'warning',
    });
  } else {
    const maskNote = mirrorOneAhead
      ? ' with malformed/legacy lines present — a possible masked interior deletion'
      : '';
    checks.push({
      name: 'audit event count',
      ok: false,
      detail: `disk has ${chainedLines} chained events${legacyNote}, audit_state has ${stateRow.event_count}${maskNote}`,
      severity: 'error',
    });
  }

  if (chainBroken) {
    checks.push({
      name: 'audit hash chain',
      ok: false,
      detail: chainBreakDetail,
      severity: 'error',
    });
  } else if (lastHash !== stateRow.chain_head_hash && mirrorOneAhead) {
    // The mirror head points one past the disk tail — the same ambiguous
    // one-ahead state as the count check: a recoverable crash window OR a
    // last-line truncation. Warning (not a hard error, not a clean pass) —
    // the per-line chain on disk is itself consistent (chainBroken is false).
    checks.push({
      name: 'audit hash chain',
      ok: false,
      detail: `disk tail lags audit_state.chain_head_hash by one event (recoverable crash window, or a truncated last line); on-disk chain is self-consistent up to ${lastHash?.slice(0, 12) ?? '(empty)'}…`,
      severity: 'warning',
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

  // Downgrade anchor present: the fingerprint-implies-v3 rule (above) can
  // only catch a wholesale v3→v2 downgrade while the committed fingerprint
  // survives. A chain that clearly adopted v3 but has NO committed
  // fingerprint has lost that anchor — either it was never committed, or it
  // was deleted to disable the downgrade defense. Warn so the user commits
  // (or restores) it; without it a wholesale downgrade would pass silently.
  if (anyV3 && !hasFingerprint) {
    checks.push({
      name: 'audit downgrade anchor',
      ok: false,
      detail:
        'this project uses HMAC-keyed (v3) events but has no committed fingerprint (.mnema/keys/project.hmac-id) — the wholesale-downgrade defense is disarmed. Commit the fingerprint (and keep it tracked) so a v3→v2 downgrade cannot pass unnoticed.',
      severity: 'warning',
    });
  }

  // Machine attestation (ADR-37 layer 2): the latest recorded head
  // signature, verified against the committed public key of its signer.
  // This is SEPARATE from chain consistency (layer 1) and HMAC authenticity
  // — it attests WHICH machine advanced the head. Only meaningful once the
  // chain has started, so it is skipped for a legacy/empty log above.
  if (attestation !== null) {
    checks.push(attestationCheck(attestation, stateRow.chain_head_hash, stateRow.event_count));
  }

  // Content attestation (ADR-41): committed `.att` coverage over the chained
  // events, verifiable by an anonymous clone with NO secret. Computed by the
  // caller (it needs the attestation modules) and passed in ready, so this
  // function gains no new dependency. The caller's builder does its own walk,
  // so a command pays one extra walk here; acceptable for a cold diagnostic
  // path (not the write hot-path). Fail-closed: an unattested tail is ok:false.
  if (contentAttestation !== null) {
    checks.push(contentAttestation);
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
 * Verdict for the machine-attestation layer. Distinguishes:
 * - no signature yet (warning — a fresh project, or below the first
 *   checkpoint interval);
 * - signer's public key missing from the repo (warning — cannot attest,
 *   not a tamper);
 * - signature does not verify (ERROR — the head or the signature was
 *   forged);
 * - verifies and covers the current head (ok);
 * - verifies but the head has advanced past the last signed checkpoint (ok
 *   — the signature is valid for the head it covered; the next checkpoint
 *   will re-attest).
 */
function attestationCheck(
  attestation: AttestationSource,
  currentHead: string | null,
  currentEventCount: number,
): IntegrityCheck {
  const sig = attestation.readHeadSignature();
  if (sig === null) {
    return {
      name: 'audit machine attestation',
      ok: true,
      detail: 'no head signature yet (signs at the next checkpoint interval)',
      severity: 'warning',
    };
  }

  const verified = attestation.verifyHeadSignature(sig);
  if (verified === null) {
    return {
      name: 'audit machine attestation',
      ok: false,
      detail: `signer ${sig.signerActor}'s public key (…${sig.signerFingerprint.slice(0, 12)}) is not present in .mnema/keys — cannot attest`,
      severity: 'warning',
    };
  }
  if (!verified) {
    return {
      name: 'audit machine attestation',
      ok: false,
      detail: `head signature by ${sig.signerActor} does not verify — the head or the signature was tampered`,
      severity: 'error',
    };
  }

  // Rollback / truncation detection. A valid signature is durable, signed
  // evidence that the chain once reached `eventCountAt`. If the current chain
  // is SHORTER than a signed checkpoint, the log retreated below an attested
  // high-water mark — a truncation (or a rollback), which the count/hash
  // checks alone cannot tell from a benign crash (and which boot
  // reconciliation would otherwise launder to green). The attacker cannot
  // forge or lower the signature without the machine key, so this is a hard
  // tamper signal.
  if (currentEventCount < sig.eventCountAt) {
    return {
      name: 'audit machine attestation',
      ok: false,
      detail: `chain retreated below a signed checkpoint: a valid signature by ${sig.signerActor} covers event ${sig.eventCountAt}, but the chain now holds only ${currentEventCount} — the log was truncated/rolled back below attested history`,
      severity: 'error',
    };
  }

  const coversCurrent = sig.coveredHeadHash === currentHead;
  return {
    name: 'audit machine attestation',
    ok: true,
    detail: coversCurrent
      ? `head signed by ${sig.signerActor} (…${sig.signerFingerprint.slice(0, 12)})`
      : `head signed by ${sig.signerActor} up to an earlier checkpoint (…${sig.coveredHeadHash.slice(0, 12)}); re-attests next checkpoint`,
  };
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

  /**
   * @param adapter - Open SQLite adapter
   * @param auditDir - Absolute path to `.mnema/audit/`
   * @param secrets - Per-project secret source, resolved at each `get()`
   *   (not construction) so importing the secret during the dashboard's
   *   lifetime takes effect. `null` for a secret-less setup.
   */
  constructor(
    private readonly adapter: SqliteAdapter,
    private readonly auditDir: string,
    private readonly secrets: SecretSource | null = null,
    private readonly attestation: AttestationSource | null = null,
  ) {}

  /**
   * Returns the integrity checks, recomputing only when the audit files,
   * the secret-presence, OR the recorded head signature changed since the
   * last call. The head signature lives in SQLite (not the audit files), so
   * it must be folded into the cache key explicitly — otherwise the
   * dashboard would serve a stale attestation verdict when a signature is
   * recorded/tampered without an audit-file change.
   *
   * @returns The (possibly cached) integrity checks
   */
  get(): IntegrityCheck[] {
    const secret = this.secrets?.read() ?? null;
    const hasFingerprint = this.secrets?.readFingerprint() != null;
    // The attestation verdict depends on the recorded head signature, which
    // is SQLite state outside the audit files — fold its identity (covered
    // head + signer fingerprint) into the key so a signature change (or a
    // direct tamper of the signature row) invalidates the cache.
    const sig = this.attestation?.readHeadSignature() ?? null;
    const sigKey =
      sig === null ? 'none' : `${sig.coveredHeadHash}:${sig.signerFingerprint}:${sig.signature}`;
    const signature = `${auditFilesSignature(this.auditDir)}|s=${secret !== null}|f=${hasFingerprint}|a=${sigKey}`;
    if (this.cached !== null && signature === this.signature) {
      return this.cached;
    }
    const checks = inspectAuditIntegrity(
      this.adapter,
      this.auditDir,
      secret,
      hasFingerprint,
      this.attestation,
    );
    this.signature = signature;
    this.cached = checks;
    return checks;
  }
}
