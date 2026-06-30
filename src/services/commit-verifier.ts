import { type CommandResult, type CommandRunner, defaultRunner } from './github-pr-service.js';

/**
 * Outcome of checking a commit ref against the local git repository.
 *
 * `checked` is the honesty bit: it is `false` whenever the check could
 * not be performed (no `git` on PATH, not inside a work tree, the runner
 * errored). In that case `found` is meaningless and callers must treat
 * the result as "unknown", never as "missing" — the check degrades to a
 * no-op rather than a false alarm.
 */
export interface CommitCheck {
  /** Whether the verification actually ran. */
  readonly checked: boolean;
  /** Whether the ref resolves to a commit in the repo (only meaningful when `checked`). */
  readonly found: boolean;
  /** Human-readable reason the check was skipped or the ref was not found. */
  readonly reason?: string;
}

/**
 * Verifies that a commit ref (SHA, tag, branch — anything git can
 * resolve) actually names a commit in the local repository.
 *
 * Why: evidence of kind `commit` is stored as a bare string and nothing
 * checks it, so a typo'd or fabricated SHA passes silently — eroding the
 * trust the hash-chained audit log is meant to build. This is a
 * **warning** signal, never a gate: a missing ref does not block the
 * attach, and any inability to check (no git, not a repo, offline of
 * sorts) degrades to "unchecked" so it never raises a false alarm.
 *
 * Uses the same injectable {@link CommandRunner} pattern as
 * {@link GitHubPrService}, so tests drive it with a mock and never shell
 * out.
 */
export class CommitVerifier {
  constructor(private readonly run: CommandRunner = defaultRunner) {}

  /**
   * Checks whether `ref` resolves to a commit in the repo rooted at `cwd`.
   *
   * @param ref - A commit-ish: full/short SHA, tag, or branch name
   * @param cwd - Directory to run git in (the project root)
   * @returns A {@link CommitCheck}; `checked: false` when git is absent
   *   or `cwd` is not a work tree
   */
  verify(ref: string, cwd: string): CommitCheck {
    const trimmed = ref.trim();
    if (trimmed.length === 0) {
      return { checked: false, found: false, reason: 'empty ref' };
    }

    // First decide whether we are even in a position to check. If git is
    // missing or this is not a work tree, stay silent (unchecked) rather
    // than reporting the ref as missing.
    const inRepo = this.run('git', ['-C', cwd, 'rev-parse', '--is-inside-work-tree']);
    if (!ranOk(inRepo) || inRepo.stdout.trim() !== 'true') {
      return { checked: false, found: false, reason: reasonForSkip(inRepo) };
    }

    // `cat-file -e <ref>^{commit}` exits 0 iff the ref resolves to (or
    // peels to) a commit object. Passed as a single literal arg via the
    // array form — no shell, so the `^{commit}` suffix is safe.
    const check = this.run('git', ['-C', cwd, 'cat-file', '-e', `${trimmed}^{commit}`]);
    if (check.error !== undefined || check.status === null) {
      // The probe itself failed to execute — treat as unchecked.
      return { checked: false, found: false, reason: 'git invocation failed' };
    }
    if (check.status === 0) {
      return { checked: true, found: true };
    }
    return {
      checked: true,
      found: false,
      reason: `commit ${trimmed} not found in this repository`,
    };
  }
}

/** True when a command actually ran and exited cleanly. */
function ranOk(result: CommandResult): boolean {
  return result.error === undefined && result.status === 0;
}

/** A short reason for skipping the check, for the degraded path. */
function reasonForSkip(result: CommandResult): string {
  if (result.error !== undefined) return 'git not available';
  return 'not a git repository';
}
