import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { orderedAuditFiles } from '../../storage/audit/audit-files.js';
import { hashEvent, hmacEvent } from '../../storage/audit/audit-hash.js';
import type { AuditEvent } from '../../storage/audit/audit-writer.js';
import { defaultGitRunner, type GitCommandRunner } from '../git-commit-service.js';

/**
 * Filename (relative to `auditDir`) recording a human's decision to accept
 * legacy `prev_hash` breaks up to a cutoff date. Committed like the audit log
 * itself — the file's presence AND every field in it is re-verified on every
 * read (never blindly trusted), so it can never silently launder a NEW break
 * or a content edit introduced after the waiver was written.
 */
const LEGACY_BREAKS_WAIVER_FILE = 'legacy-breaks-accepted.json';

/** The recorded acceptance of legacy `prev_hash` breaks up to a cutoff. */
export interface LegacyBreaksWaiver {
  /** ISO date/time: breaks at or before this are covered. */
  readonly acceptedCutoff: string;
  /** When the waiver was written (informational only). */
  readonly acceptedAt: string;
}

/** Absolute path to the legacy-breaks waiver file for an audit dir. */
export function legacyBreaksWaiverPath(auditDir: string): string {
  return path.join(auditDir, LEGACY_BREAKS_WAIVER_FILE);
}

/**
 * Reads the committed legacy-breaks waiver, or `null` when absent or
 * malformed (a malformed file is treated as no waiver — never as a crash and
 * never as an accidental accept-everything).
 *
 * @param auditDir - Absolute path to `.mnema/audit/`
 * @returns The waiver, or `null`
 */
export function readLegacyBreaksWaiver(auditDir: string): LegacyBreaksWaiver | null {
  const file = legacyBreaksWaiverPath(auditDir);
  if (!existsSync(file)) return null;
  try {
    const raw = JSON.parse(readFileSync(file, 'utf-8')) as Partial<LegacyBreaksWaiver>;
    if (typeof raw.acceptedCutoff !== 'string' || Number.isNaN(Date.parse(raw.acceptedCutoff))) {
      return null;
    }
    return {
      acceptedCutoff: raw.acceptedCutoff,
      acceptedAt: typeof raw.acceptedAt === 'string' ? raw.acceptedAt : '',
    };
  } catch {
    return null;
  }
}

/**
 * Writes the legacy-breaks waiver. Called ONLY by `reconcile
 * --accept-legacy-breaks` after it has independently verified every break is
 * content-valid, at/before the cutoff, and the disk matches git HEAD — this
 * function itself performs no verification, so it must never be called on
 * unverified input.
 *
 * @param auditDir - Absolute path to `.mnema/audit/`
 * @param cutoffIso - The accepted cutoff date, already validated by the caller
 */
export function writeLegacyBreaksWaiver(auditDir: string, cutoffIso: string): void {
  const waiver: LegacyBreaksWaiver = {
    acceptedCutoff: cutoffIso,
    acceptedAt: new Date().toISOString(),
  };
  writeFileSync(legacyBreaksWaiverPath(auditDir), `${JSON.stringify(waiver, null, 2)}\n`, 'utf-8');
}

/**
 * Filename (relative to `auditDir`) recording a human's decision to accept a
 * GENUINE truncation of the audit chain — history the operator deliberately
 * rewrote below a signed checkpoint. Distinct from the legacy-breaks waiver:
 * that covers a sequence-only discontinuity in a chain still at its full
 * length; this covers a chain that was made SHORTER than an attested
 * high-water mark. Committed like the audit log; every field is re-verified
 * against the CURRENT disk on every read (never blindly trusted), so it can
 * never launder a LATER truncation than the one the human reviewed.
 */
const TRUNCATION_WAIVER_FILE = 'truncation-accepted.json';

/** The recorded acceptance of a deliberate truncation to a verified tail. */
export interface TruncationWaiver {
  /** `hash` of the disk tail at the moment the truncation was accepted. */
  readonly acceptedHeadHash: string;
  /** Chained (v>=2) line count on disk at acceptance. */
  readonly acceptedEventCount: number;
  /** When the waiver was written (informational only). */
  readonly acceptedAt: string;
}

/** Absolute path to the truncation waiver file for an audit dir. */
export function truncationWaiverPath(auditDir: string): string {
  return path.join(auditDir, TRUNCATION_WAIVER_FILE);
}

/**
 * Reads the committed truncation waiver, or `null` when absent or malformed (a
 * malformed file is treated as no waiver — never a crash and never an
 * accidental accept-everything). Reading it does NOT itself confirm it still
 * applies: the caller must re-verify `acceptedHeadHash`/`acceptedEventCount`
 * against the CURRENT disk tail, so a truncation deeper than the accepted one
 * is never covered.
 *
 * @param auditDir - Absolute path to `.mnema/audit/`
 * @returns The waiver, or `null`
 */
export function readTruncationWaiver(auditDir: string): TruncationWaiver | null {
  const file = truncationWaiverPath(auditDir);
  if (!existsSync(file)) return null;
  try {
    const raw = JSON.parse(readFileSync(file, 'utf-8')) as Partial<TruncationWaiver>;
    if (typeof raw.acceptedHeadHash !== 'string' || typeof raw.acceptedEventCount !== 'number') {
      return null;
    }
    return {
      acceptedHeadHash: raw.acceptedHeadHash,
      acceptedEventCount: raw.acceptedEventCount,
      acceptedAt: typeof raw.acceptedAt === 'string' ? raw.acceptedAt : '',
    };
  } catch {
    return null;
  }
}

/**
 * Writes the truncation waiver. Called ONLY by `audit accept-truncation
 * --force` after it has independently verified the disk chain is
 * content-consistent, the signed head is genuinely absent from disk, no
 * committed `.att` reaches beyond the new tail, and (when required) the disk
 * matches git HEAD — this function itself performs no verification, so it must
 * never be called on unverified input.
 *
 * @param auditDir - Absolute path to `.mnema/audit/`
 * @param acceptedHeadHash - The disk tail hash being baselined to
 * @param acceptedEventCount - The disk chained-line count being baselined to
 */
export function writeTruncationWaiver(
  auditDir: string,
  acceptedHeadHash: string,
  acceptedEventCount: number,
): void {
  const waiver: TruncationWaiver = {
    acceptedHeadHash,
    acceptedEventCount,
    acceptedAt: new Date().toISOString(),
  };
  writeFileSync(truncationWaiverPath(auditDir), `${JSON.stringify(waiver, null, 2)}\n`, 'utf-8');
}

/**
 * One `prev_hash` discontinuity found while walking the chain, with a verdict
 * on whether the CONTENT around it is authentic. This is the distinction
 * `mnema doctor`/`audit verify` collapse into a single "tampering" line: a
 * `prev_hash` break only proves the *sequence* was disturbed — the per-line
 * content hash proves (or disproves) that the *events themselves* were
 * altered. A break with fully-valid content hashes is the signature of
 * concurrent writers racing to append without a cross-process lock —
 * corruption of order, not of data. A break where a content hash ALSO fails
 * to verify is the signature of a real edit, and must never be laundered by
 * a "legacy" story.
 */
export interface ChainBreak {
  /** File the break's line is in (basename, e.g. `2026-06.jsonl`). */
  readonly file: string;
  /** 1-based line number within that file. */
  readonly line: number;
  /** 0-based position in the chained (v>=2) sequence. */
  readonly chainedIndex: number;
  /** ISO timestamp of the event at the break. */
  readonly at: string | null;
  /**
   * `true` when every event's own content hash matches its content, in a
   * window around the break (see {@link CONTENT_WINDOW}). `null` when a
   * v3 line in the window could not be checked (no project secret).
   */
  readonly contentValidAroundBreak: boolean | null;
}

/** Events checked on each side of a break when validating surrounding content. */
const CONTENT_WINDOW = 5;

/** Full diagnostic report produced by {@link diagnoseAuditChain}. */
export interface AuditDiagnosis {
  /** Total chained (v>=2) events walked. */
  readonly totalChained: number;
  /** Every discontinuity found, in chain order. */
  readonly breaks: readonly ChainBreak[];
  /** Unparseable lines encountered (never included in totalChained). */
  readonly malformedLines: number;
  /**
   * `true` only when every break has `contentValidAroundBreak === true`.
   * `false` if ANY break's content could not be confirmed valid (including
   * `null` — unknown is never treated as safe here, unlike the softer
   * warning posture of {@link import('../audit-integrity.js').inspectAuditIntegrity}).
   */
  readonly allBreaksContentValid: boolean;
  /**
   * `true` when every audit file the walk covers is unmodified relative to
   * the current git `HEAD` (`git diff --quiet HEAD -- <file>` for each), i.e.
   * whatever is on disk is exactly what was committed. `null` when the
   * directory is not inside a git work tree, so the check could not run —
   * distinct from `false` (checked and found a local modification).
   */
  readonly matchesCommittedHead: boolean | null;
}

/**
 * Re-walks the on-disk chain like {@link import('../audit-integrity.js').walkAuditChain},
 * but — unlike that function, which keeps only the LAST break it saw and
 * exists to produce a single pass/fail line — collects EVERY discontinuity
 * and, for each, independently re-verifies the per-line content hash of the
 * events around it. This is deliberately a separate, read-only pass: it must
 * never share mutable state with the integrity walk that `doctor`/`verify`
 * depend on, so a bug here can degrade only diagnosis, never the actual gate.
 *
 * @param auditDir - Absolute path to `.mnema/audit/`
 * @param secret - Per-project HMAC secret for verifying v3 lines' content, or
 *   `null` when unavailable (a v3 line's content validity is then `null`,
 *   never assumed valid)
 * @param gitCwd - Working directory to run `git` from, or `null` to skip the
 *   git-anchor check entirely (report `matchesCommittedHead: null`)
 * @param gitRunner - Injectable git runner (tests avoid a real repo)
 * @returns The full diagnosis
 */
export function diagnoseAuditChain(
  auditDir: string,
  secret: Buffer | null,
  gitCwd: string | null,
  gitRunner: GitCommandRunner = defaultGitRunner,
): AuditDiagnosis {
  const files = orderedAuditFiles(auditDir);

  // First pass: parse every line once, keep the raw event + its file/lineno,
  // and note where the chain breaks. Kept as a flat array (not re-read per
  // break) so the content-window check below is O(events), not O(breaks²).
  interface Parsed {
    readonly file: string;
    readonly line: number;
    readonly event: Record<string, unknown>;
  }
  const parsed: Parsed[] = [];
  let malformedLines = 0;

  for (const file of files) {
    const lines = readFileSync(file, 'utf-8').split('\n');
    const base = file.split('/').pop() ?? file;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      if (line.length === 0) continue;
      try {
        const event = JSON.parse(line) as Record<string, unknown>;
        parsed.push({ file: base, line: i + 1, event });
      } catch {
        malformedLines += 1;
      }
    }
  }

  const chained = parsed.filter((p) => {
    const v = typeof p.event.v === 'number' ? p.event.v : 1;
    return v >= 2;
  });

  const contentValid = (p: Parsed): boolean | null => {
    const v = typeof p.event.v === 'number' ? p.event.v : 1;
    const hash = typeof p.event.hash === 'string' ? p.event.hash : null;
    if (v >= 3) {
      if (secret === null) return null;
      return hash === hmacEvent(p.event as unknown as AuditEvent, secret);
    }
    return hash === hashEvent(p.event as unknown as AuditEvent);
  };

  const breaks: ChainBreak[] = [];
  let prevHash: string | null = null;
  for (let idx = 0; idx < chained.length; idx++) {
    const p = chained[idx] as Parsed;
    const prev = (p.event.prev_hash ?? null) as string | null;
    if (prev !== prevHash) {
      const from = Math.max(0, idx - CONTENT_WINDOW);
      const to = Math.min(chained.length, idx + CONTENT_WINDOW + 1);
      const window = chained.slice(from, to);
      const verdicts = window.map(contentValid);
      // Unknown (v3, no secret) is NOT the same as valid: report null rather
      // than quietly upgrading an unverifiable window to "valid".
      const contentValidAroundBreak = verdicts.some((v) => v === false)
        ? false
        : verdicts.some((v) => v === null)
          ? null
          : true;
      breaks.push({
        file: p.file,
        line: p.line,
        chainedIndex: idx,
        at: typeof p.event.at === 'string' ? p.event.at : null,
        contentValidAroundBreak,
      });
    }
    prevHash = typeof p.event.hash === 'string' ? p.event.hash : null;
  }

  const allBreaksContentValid = breaks.every((b) => b.contentValidAroundBreak === true);

  let matchesCommittedHead: boolean | null = null;
  if (gitCwd !== null) {
    const isRepo = gitRunner(['rev-parse', '--is-inside-work-tree'], gitCwd);
    if (isRepo.status === 0 && isRepo.stdout.trim() === 'true') {
      matchesCommittedHead = files.every((file) => {
        // The file must actually be TRACKED in HEAD first. `git diff --quiet
        // HEAD -- <file>` exits 0 for an UNTRACKED file too (git has nothing
        // to compare), and the audit `.jsonl` files are commonly gitignored —
        // so a clean diff alone would let an untracked head masquerade as a
        // committed one. `ls-files --error-unmatch` exits non-zero unless the
        // path is in the index/HEAD, closing that hole.
        const tracked = gitRunner(['ls-files', '--error-unmatch', '--', file], gitCwd);
        if (tracked.status !== 0) return false;
        const diff = gitRunner(['diff', '--quiet', 'HEAD', '--', file], gitCwd);
        // `git diff --quiet` exits 0 (no diff) or 1 (diff); any other status
        // (no HEAD yet) is NOT a confirmed match.
        return diff.status === 0;
      });
    }
  }

  return {
    totalChained: chained.length,
    breaks,
    malformedLines,
    allBreaksContentValid,
    matchesCommittedHead,
  };
}
