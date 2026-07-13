import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

/** Result of running a git subcommand. */
export interface GitResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs a git command in `cwd`. Injectable so tests avoid a real repo. */
export type GitCommandRunner = (args: readonly string[], cwd: string) => GitResult;

/** The real git runner (spawns an actual `git` process). Exported so other
 * read-only git checks (e.g. {@link import('./audit/audit-diagnose.js').diagnoseAuditChain})
 * reuse the same spawn/timeout discipline instead of re-implementing it. */
export const defaultGitRunner: GitCommandRunner = (args, cwd) => {
  const result = spawnSync('git', [...args], { cwd, encoding: 'utf-8', timeout: 15_000 });
  return {
    status: result.status,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
  };
};

/** Outcome of one `git commit` the helper made. */
export interface CommitStep {
  /** `trail` = the .mnema/ mirror, `code` = everything else. */
  readonly kind: 'trail' | 'code';
  readonly message: string;
  /** Repo-relative paths included in this commit. */
  readonly paths: readonly string[];
}

/** What {@link GitCommitService.commit} did. */
export interface CommitPlanResult {
  readonly committed: readonly CommitStep[];
  /** Set when nothing was committed, explaining why. */
  readonly nothing?: string;
}

export class GitCommitNotARepoError extends Error {
  constructor() {
    super('not a git repository (or git is unavailable)');
    this.name = 'GitCommitNotARepoError';
  }
}

export class GitCommitFailedError extends Error {
  constructor(
    readonly kind: 'trail' | 'code',
    readonly stderr: string,
  ) {
    super(`git commit (${kind}) failed: ${stderr.trim() || 'unknown error'}`);
    this.name = 'GitCommitFailedError';
  }
}

/** Options for {@link GitCommitService.commit}. */
export interface CommitOptions {
  /** Commit message for the code changes (required unless trailOnly). */
  readonly message?: string;
  /** Commit message for the .mnema/ trail. Has a sensible default. */
  readonly trailMessage?: string;
  /** Only commit the .mnema/ trail; leave code changes untouched. */
  readonly trailOnly?: boolean;
}

const DEFAULT_TRAIL_MESSAGE = 'chore(mnema): update trail';

/**
 * Commits the Mnema trail (the versioned `.mnema/` mirror) SEPARATELY from
 * code — trail first, then code — so the mirror churn an agent produces on
 * every transition never mixes into a code diff.
 *
 * The trail is auto-staged (it is machine-generated, committed in full);
 * CODE is taken from the index verbatim — the user stages what they want
 * with `git add` / `git add -p`, and the code commit carries no pathspec,
 * so unstaged edits and partial staging are preserved. Deliberately
 * conservative: it auto-stages only the trail dir (never `git add -A` of
 * code), never pushes, never amends, never makes an empty commit, and
 * refuses to run mid-merge/rebase.
 *
 * Clone-survival is preserved: the trail is committed, not hidden.
 */
export class GitCommitService {
  /**
   * @param projectRoot - Absolute repo path git commands run in.
   * @param trailDir - The versioned mirror root, relative to the repo
   *   (`.mnema` by default). Everything under it is the trail bucket.
   */
  constructor(
    private readonly projectRoot: string,
    private readonly trailDir: string = '.mnema',
    private readonly run: GitCommandRunner = defaultGitRunner,
    /**
     * Extra repo-root files that ride along in the trail commit (exact-path
     * match), for mnema-authored root files like AGENTS.md that live outside
     * `.mnema`. Empty by default so the service alone stages nothing but the
     * trail dir; the CLI passes `git.trail_extra_paths`.
     */
    private readonly trailExtraPaths: readonly string[] = [],
  ) {}

  private git(...args: string[]): GitResult {
    return this.run(args, this.projectRoot);
  }

  private isRepo(): boolean {
    const r = this.git('rev-parse', '--is-inside-work-tree');
    return r.status === 0 && r.stdout.trim() === 'true';
  }

  /**
   * True when a merge/rebase/cherry-pick/bisect is in progress. Git
   * refuses a partial commit in these states, and committing here would be
   * surprising, so the helper bails out early with a clear error instead of
   * landing the trail commit and then failing on the code commit.
   */
  private sequencerInProgress(): string | null {
    const dir = this.git('rev-parse', '--git-dir').stdout.trim();
    if (dir.length === 0) return null;
    const base = dir.startsWith('/') ? dir : `${this.projectRoot}/${dir}`;
    const markers: Array<[string, string]> = [
      ['MERGE_HEAD', 'a merge'],
      ['rebase-merge', 'a rebase'],
      ['rebase-apply', 'a rebase'],
      ['CHERRY_PICK_HEAD', 'a cherry-pick'],
      ['REVERT_HEAD', 'a revert'],
      ['BISECT_LOG', 'a bisect'],
    ];
    for (const [marker, label] of markers) {
      if (existsSync(`${base}/${marker}`)) return label;
    }
    return null;
  }

  /**
   * Repo-relative paths currently STAGED (in the index) whose path is /
   * is not under the trail dir. Uses `git diff --cached --name-only -z`, so
   * it reflects exactly what the user staged (respecting `git add -p`) —
   * NUL-delimited, no quoting, no rename pairs to unwind (name-only emits a
   * single path per entry).
   */
  private stagedPaths(): { trail: string[]; code: string[] } {
    const out = this.git('diff', '--cached', '--name-only', '-z').stdout;
    const trail: string[] = [];
    const code: string[] = [];
    const prefix = `${this.trailDir.replace(/\/$/, '')}/`;
    const extra = new Set(this.trailExtraPaths);
    for (const filePath of out.split('\0')) {
      if (filePath.length === 0) continue;
      if (filePath === this.trailDir || filePath.startsWith(prefix) || extra.has(filePath)) {
        trail.push(filePath);
      } else code.push(filePath);
    }
    return { trail, code };
  }

  /**
   * Commits pending changes as up to two commits — the `.mnema/` trail
   * first, then the code — WITHOUT ever touching the working tree beyond
   * staging the trail:
   *
   * 1. `git add -- .mnema` stages the (machine-generated) trail in full.
   * 2. The trail commit uses `git commit -- .mnema`, so only the trail is
   *    committed.
   * 3. The code commit is `git commit` with NO pathspec — it commits
   *    exactly what the user had already staged (their `git add` / `git
   *    add -p`), never the working-tree version, so unstaged edits and
   *    partial staging are preserved.
   *
   * Skips a bucket with nothing to commit; never makes an empty commit;
   * never pushes or amends. Refuses to run mid-merge/rebase so it can't
   * leave a half-done state.
   *
   * @throws GitCommitNotARepoError when not inside a git work tree
   * @throws GitCommitFailedError when a git command returns non-zero
   */
  commit(options: CommitOptions): CommitPlanResult {
    if (!this.isRepo()) throw new GitCommitNotARepoError();
    const sequencer = this.sequencerInProgress();
    if (sequencer !== null) {
      throw new GitCommitFailedError(
        'trail',
        `${sequencer} is in progress — finish or abort it, then commit`,
      );
    }

    const committed: CommitStep[] = [];

    // 1. Stage the whole trail (it is machine churn — there is no partial
    //    staging of it a user would want to preserve), then commit ONLY the
    //    trail by pathspec. Nothing else is auto-staged.
    const addTrail = this.git('add', '--', this.trailDir);
    if (addTrail.status !== 0) throw new GitCommitFailedError('trail', addTrail.stderr);
    // Also stage the configured mnema-authored root files (e.g. AGENTS.md),
    // each only when present. `git add --intent-to-add`-free: a plain `git add`
    // of a missing/unchanged path is harmless (git no-ops when it matches
    // nothing tracked), so a repo without the file simply stages nothing. We
    // never throw on a missing extra path — it is optional by design.
    for (const p of this.trailExtraPaths) {
      this.git('add', '--', p);
    }

    // `stagedPaths` classifies the extras as trail (via trailExtraPaths), so
    // the trail bucket now includes any extra file that actually got staged.
    const trailStaged = this.stagedPaths().trail;
    if (trailStaged.length > 0) {
      const message = options.trailMessage ?? DEFAULT_TRAIL_MESSAGE;
      const stagedExtras = trailStaged.filter((p) => this.trailExtraPaths.includes(p));
      // Commit by explicit pathspec so ONLY the trail dir and the staged extra
      // files land — never anything else the user may have staged.
      const r = this.git('commit', '-m', message, '--', this.trailDir, ...stagedExtras);
      if (r.status !== 0) throw new GitCommitFailedError('trail', r.stderr);
      committed.push({ kind: 'trail', message, paths: trailStaged });
    }

    // 2. Code = whatever the user already staged outside the trail. We do
    //    NOT `git add` code, and the commit carries no pathspec, so it uses
    //    the index verbatim.
    if (!options.trailOnly) {
      const codeStaged = this.stagedPaths().code;
      if (codeStaged.length > 0) {
        const message = options.message;
        if (message === undefined || message.trim().length === 0) {
          throw new GitCommitFailedError('code', 'a commit message is required for code changes');
        }
        const r = this.git('commit', '-m', message);
        if (r.status !== 0) throw new GitCommitFailedError('code', r.stderr);
        committed.push({ kind: 'code', message, paths: codeStaged });
      }
    }

    if (committed.length === 0) {
      return {
        committed,
        nothing: options.trailOnly
          ? 'no trail changes to commit'
          : 'nothing to commit — stage your code changes with `git add` first (the .mnema/ trail is staged automatically)',
      };
    }
    return { committed };
  }
}
