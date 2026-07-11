import type { GitCommitRef } from '../domain/entities/task.js';
import type { TaskRepository } from '../storage/sqlite/repositories/task-repository.js';
import { type CommandResult, type CommandRunner, defaultRunner } from './github-pr-service.js';

/** The outcome of one observer pass. */
export interface GitObserveResult {
  /** Whether git could be consulted (same honesty bit as CommitVerifier). */
  readonly checked: boolean;
  /** The task key that was linked, or null when nothing unambiguous applied. */
  readonly linkedTaskKey: string | null;
  /** Why nothing was linked / the scan was skipped. */
  readonly reason?: string;
}

/** How many recent commits to read on the branch. */
const COMMIT_SCAN_LIMIT = 30;

/**
 * The opt-in git observer (MNEMA-ADR-49). While `mnema watch --git` runs,
 * one pass reads the repo READ-ONLY and, for the *unambiguous* case — a
 * single IN_PROGRESS task assigned to the acting actor — populates that
 * task's first-class git link (branch + commits) and returns the key.
 *
 * It never writes to `.git/`, never blocks anything, and degrades to a
 * silent no-op (`checked: false`) when git is absent — the same contract as
 * {@link CommitVerifier}/{@link DriftService}. When zero or more than one
 * IN_PROGRESS task matches, it links NOTHING (the commits stay visible via
 * `mnema drift`) rather than guessing an owner — a false link is worse than
 * an honest gap.
 */
export class GitObserverService {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly identity: { findActorIdByHandle: (h: string) => string | null },
    private readonly run: CommandRunner = defaultRunner,
  ) {}

  /**
   * Runs one observation pass over the repo at `cwd` for `actorHandle`.
   *
   * @param cwd - Directory to run git in (the project root)
   * @param actorHandle - The acting actor's handle (scopes the task match)
   * @returns A {@link GitObserveResult}
   */
  observe(cwd: string, actorHandle: string): GitObserveResult {
    const inRepo = this.run('git', ['-C', cwd, 'rev-parse', '--is-inside-work-tree']);
    if (!ranOk(inRepo) || inRepo.stdout.trim() !== 'true') {
      return { checked: false, linkedTaskKey: null, reason: skipReason(inRepo) };
    }

    const branchOut = this.run('git', ['-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD']);
    if (!ranOk(branchOut)) {
      return { checked: false, linkedTaskKey: null, reason: skipReason(branchOut) };
    }
    const branch = branchOut.stdout.trim();

    // The unambiguous owner: exactly one IN_PROGRESS task assigned to this
    // actor. Zero or many → link nothing (leave it for `mnema drift`).
    const actorId = this.identity.findActorIdByHandle(actorHandle);
    if (actorId === null) {
      return { checked: true, linkedTaskKey: null, reason: 'unknown actor' };
    }
    const mine = this.tasks.findByState('IN_PROGRESS').filter((t) => t.assigneeId === actorId);
    if (mine.length !== 1) {
      return {
        checked: true,
        linkedTaskKey: null,
        reason:
          mine.length === 0
            ? 'no in-progress task for this actor'
            : `${String(mine.length)} in-progress tasks for this actor — ambiguous`,
      };
    }
    const task = mine[0];
    if (task === undefined) return { checked: true, linkedTaskKey: null };

    // Read recent commits on the branch (read-only).
    const log = this.run('git', [
      '-C',
      cwd,
      'log',
      '-n',
      String(COMMIT_SCAN_LIMIT),
      '--pretty=format:%h\x1f%s',
    ]);
    const commits: GitCommitRef[] = ranOk(log)
      ? log.stdout
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
          .map((line) => {
            const sep = line.indexOf('\x1f');
            return sep === -1
              ? { sha: line, subject: '' }
              : { sha: line.slice(0, sep), subject: line.slice(sep + 1) };
          })
      : [];

    this.tasks.setGitLink(task.id, { branch, commits, pr: task.gitPr });
    return { checked: true, linkedTaskKey: task.key };
  }
}

/** True when a command actually ran and exited cleanly. */
function ranOk(result: CommandResult): boolean {
  return result.error === undefined && result.status === 0;
}

/** A short reason for a skipped pass, mirroring CommitVerifier's phrasing. */
function skipReason(result: CommandResult): string {
  if (result.error !== undefined) return 'git not available';
  return 'not a git work tree';
}
