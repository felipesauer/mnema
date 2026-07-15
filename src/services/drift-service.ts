import type { TaskEvidenceRepository } from '../storage/sqlite/repositories/task-evidence-repository.js';
import { type CommandResult, type CommandRunner, defaultRunner } from './git/github-pr-service.js';

/** One commit on the branch with no task tied to it. */
export interface UntrackedCommit {
  /** Abbreviated SHA. */
  readonly sha: string;
  /** First line of the commit message. */
  readonly subject: string;
}

/**
 * An untracked commit whose subject names one or more EXISTING task keys —
 * the work was done and mentions its task, but no evidence links them yet.
 * This is the one-command-away case: attach the SHA to the task.
 */
export interface LinkableCommit {
  readonly sha: string;
  readonly subject: string;
  /** Existing task keys parsed from the subject (deduped, in order). */
  readonly taskKeys: readonly string[];
}

/**
 * The result of a commit-drift scan.
 *
 * `checked` is the honesty bit (same contract as {@link CommitVerifier}):
 * `false` whenever git could not be consulted — no `git`, not a work
 * tree, the runner errored. Callers must treat an unchecked result as
 * "unknown", never "clean" and never "all untracked".
 */
export interface CommitDrift {
  readonly checked: boolean;
  /**
   * Untracked commits whose subject names an existing task — link them with
   * `task_attach_evidence` (the SHA is the ref). Split out from
   * {@link untracked} because the remedy is different: these are one command
   * away from being tracked, the rest need a task first.
   */
  readonly linkable: readonly LinkableCommit[];
  /**
   * Untracked commits with no existing task key in the subject — genuinely
   * task-less work (a task must be created before evidence can be attached).
   */
  readonly untracked: readonly UntrackedCommit[];
  /** How many commits were scanned (0 when unchecked). */
  readonly scanned: number;
  /** Why the scan was skipped, when `checked` is false. */
  readonly reason?: string;
}

/** How many commits back to scan when no base ref narrows the range. */
const DEFAULT_SCAN_LIMIT = 30;

/**
 * Detects "ghost work": commits on the current branch that no task claims.
 *
 * The report's core governance gap is a session that commits code with no
 * task in progress — the audit records the mutation but nothing ties the
 * code to the plan. This scans the branch's recent commits and flags any
 * whose SHA is not referenced by commit-kind evidence on some task.
 *
 * It is a **signal**, never a gate: it reads git read-only and degrades
 * to `checked: false` (a silent no-op with a reason) whenever git is
 * absent — exactly like {@link CommitVerifier} — so it never raises a
 * false alarm on a machine or CI runner without a work tree. Uses the
 * same injectable {@link CommandRunner} so tests drive it with a mock
 * and never shell out.
 */
export class DriftService {
  /** Matches a task key for THIS project in a commit subject: `KEY-<n>`. */
  private readonly keyPattern: RegExp;

  constructor(
    private readonly evidence: TaskEvidenceRepository,
    private readonly run: CommandRunner = defaultRunner,
    /**
     * The active project key (e.g. `NOTA`). Task keys are parsed from commit
     * subjects to split "linkable" (mentions an existing task) from genuinely
     * task-less commits. Optional so existing callers/tests keep working; when
     * absent every untracked commit stays in `untracked` (no key parsing).
     */
    private readonly projectKey: string | null = null,
    /**
     * Existence check for a parsed key. A key that parses but names no live
     * task is NOT linkable — the mention is stale or a typo. Optional; when
     * absent (no project key wired) it is never consulted.
     */
    private readonly taskExists: (key: string) => boolean = () => false,
  ) {
    // `\b … -(\d+)\b`: the trailing digit requirement means `NOTA-EPIC-32`
    // (an epic/ADR key) never matches as a task key. Escape the project key
    // so a punctuation-bearing key cannot inject regex syntax.
    const escaped = (projectKey ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    this.keyPattern = new RegExp(`\\b${escaped}-(\\d+)\\b`, 'g');
  }

  /** Existing task keys named in a commit subject (deduped, in first-seen order). */
  private taskKeysIn(subject: string): string[] {
    if (this.projectKey === null) return [];
    const seen = new Set<string>();
    this.keyPattern.lastIndex = 0;
    for (const match of subject.matchAll(this.keyPattern)) {
      const key = match[0];
      if (!seen.has(key) && this.taskExists(key)) seen.add(key);
    }
    return [...seen];
  }

  /**
   * Scans for commits on the branch at `cwd` that no task claims.
   *
   * @param cwd - Directory to run git in (the project root)
   * @param options.base - A base ref (e.g. `main`); when given, only
   *   commits reachable from HEAD but not from base are scanned. Without
   *   it, the last {@link DEFAULT_SCAN_LIMIT} commits are scanned.
   * @param options.limit - Override the no-base scan bound.
   * @returns A {@link CommitDrift}; `checked: false` when git is unavailable
   */
  scan(cwd: string, options: { base?: string; limit?: number } = {}): CommitDrift {
    const inRepo = this.run('git', ['-C', cwd, 'rev-parse', '--is-inside-work-tree']);
    if (!ranOk(inRepo) || inRepo.stdout.trim() !== 'true') {
      return {
        checked: false,
        linkable: [],
        untracked: [],
        scanned: 0,
        reason: skipReason(inRepo),
      };
    }

    // A NUL/newline-delimited "<sha>\x1f<subject>" list. `%h` is the
    // abbreviated SHA, `%s` the subject. Range: base..HEAD when a base is
    // given, else a bounded tail so the scan is O(limit), not O(history).
    const range = options.base === undefined ? [] : [`${options.base}..HEAD`];
    const bound =
      options.base === undefined ? ['-n', String(options.limit ?? DEFAULT_SCAN_LIMIT)] : [];
    const log = this.run('git', ['-C', cwd, 'log', ...bound, '--pretty=format:%h\x1f%s', ...range]);
    if (!ranOk(log)) {
      return { checked: false, linkable: [], untracked: [], scanned: 0, reason: skipReason(log) };
    }

    const commits = log.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        const sep = line.indexOf('\x1f');
        return sep === -1
          ? { sha: line, subject: '' }
          : { sha: line.slice(0, sep), subject: line.slice(sep + 1) };
      });

    // Refs recorded as commit evidence. Match by prefix in both
    // directions so a short evidence SHA covers a longer log SHA and vice
    // versa — evidence is attached as whatever the agent had to hand.
    const refs = this.evidence.commitRefs().map((r) => r.ref.trim().toLowerCase());
    const isTracked = (sha: string): boolean => {
      const s = sha.toLowerCase();
      return refs.some((ref) => ref.length > 0 && (s.startsWith(ref) || ref.startsWith(s)));
    };

    // Split the commits that carry no evidence link: a subject naming an
    // existing task is "linkable" (attach the SHA and it is tracked), the rest
    // are genuinely task-less. A commit already tracked by evidence is neither.
    const linkable: LinkableCommit[] = [];
    const untracked: UntrackedCommit[] = [];
    for (const c of commits) {
      if (isTracked(c.sha)) continue;
      const taskKeys = this.taskKeysIn(c.subject);
      if (taskKeys.length > 0) linkable.push({ sha: c.sha, subject: c.subject, taskKeys });
      else untracked.push({ sha: c.sha, subject: c.subject });
    }
    return { checked: true, linkable, untracked, scanned: commits.length };
  }
}

/** True when a command actually ran and exited cleanly. */
function ranOk(result: CommandResult): boolean {
  return result.error === undefined && result.status === 0;
}

/** A short reason for a skipped scan, mirroring CommitVerifier's phrasing. */
function skipReason(result: CommandResult): string {
  if (result.error !== undefined) return 'git not available';
  return 'not a git work tree';
}
