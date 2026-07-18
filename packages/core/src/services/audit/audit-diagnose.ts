import { readFileSync } from 'node:fs';
import { orderedAuditFiles } from '../../storage/audit/audit-files.js';
import { EVENT_FORMAT_VERSION, hmacEvent } from '../../storage/audit/audit-hash.js';
import type { AuditEvent } from '../../storage/audit/audit-writer.js';
import { defaultGitRunner, type GitCommandRunner } from '../git/git-commit-service.js';

/**
 * One `prev_hash` discontinuity found while walking the chain, with a verdict
 * on whether the CONTENT around it is authentic. This is the distinction
 * `mnema doctor`/`audit verify` collapse into a single "tampering" line: a
 * `prev_hash` break only proves the *sequence* was disturbed — the per-line
 * content hash proves (or disproves) that the *events themselves* were
 * altered. A break with fully-valid content hashes is the signature of
 * concurrent writers racing to append without a cross-process lock —
 * corruption of order, not of data. A break where a content hash ALSO fails
 * to verify is the signature of a real edit, and is never treated as benign.
 */
export interface ChainBreak {
  /** File the break's line is in (basename, e.g. `2026-06.jsonl`). */
  readonly file: string;
  /** 1-based line number within that file. */
  readonly line: number;
  /** 0-based position in the chained sequence. */
  readonly chainedIndex: number;
  /** ISO timestamp of the event at the break. */
  readonly at: string | null;
  /**
   * `true` when every event's own content hash matches its content, in a
   * window around the break (see {@link CONTENT_WINDOW}). `null` when a line
   * in the window could not be checked (no project secret).
   */
  readonly contentValidAroundBreak: boolean | null;
}

/** Events checked on each side of a break when validating surrounding content. */
const CONTENT_WINDOW = 5;

/** Full diagnostic report produced by {@link diagnoseAuditChain}. */
export interface AuditDiagnosis {
  /** Total chained events walked. */
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
 * @param secret - Per-project HMAC secret for verifying each line's content,
 *   or `null` when unavailable (a line's content validity is then `null`,
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

  const chained = parsed.filter(
    (p) => (typeof p.event.v === 'number' ? p.event.v : 0) === EVENT_FORMAT_VERSION,
  );

  const contentValid = (p: Parsed): boolean | null => {
    const hash = typeof p.event.hash === 'string' ? p.event.hash : null;
    // Each line is HMAC-keyed: unverifiable without the secret (a clone),
    // else the HMAC must recompute.
    if (secret === null) return null;
    return hash === hmacEvent(p.event as unknown as AuditEvent, secret);
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
      // Unknown (no secret) is NOT the same as valid: report null rather
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
