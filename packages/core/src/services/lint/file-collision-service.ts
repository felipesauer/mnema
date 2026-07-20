import { Err, Ok, type Result } from '../../common/result.js';
import type { Task } from '../../domain/entities/task.js';
import { deriveAlias } from '../../domain/entity-alias.js';
import { ErrorCode } from '../../errors/error-codes.js';
import type { MnemaError } from '../../errors/mnema-error.js';
import type { EpicRepository } from '../../storage/sqlite/repositories/epic-repository.js';
import type { SprintRepository } from '../../storage/sqlite/repositories/sprint-repository.js';
import type { TaskEvidenceRepository } from '../../storage/sqlite/repositories/task-evidence-repository.js';
import type { TaskRepository } from '../../storage/sqlite/repositories/task-repository.js';
import { resolveEntity } from '../backlog/resolve-entity.js';
import { type CommandRunner, defaultRunner } from '../git/github-pr-service.js';

/** What the collision scan is scoped to. */
export type CollisionScope =
  | { readonly kind: 'epic'; readonly key: string }
  | { readonly kind: 'sprint'; readonly key: string };

/** Two in-scope tasks that touch one or more of the same files. */
export interface FileCollision {
  readonly taskA: string;
  readonly taskB: string;
  /** Files both tasks touch, sorted. */
  readonly files: readonly string[];
}

/** The result of a collision scan. */
export interface CollisionReport {
  readonly scope: CollisionScope;
  /** Tasks for which a file set could be determined (had commit evidence). */
  readonly analysed: readonly string[];
  /** Tasks with no commit evidence, so no files could be inferred. */
  readonly skipped: readonly string[];
  /** Overlapping pairs, most-files-in-common first. */
  readonly collisions: readonly FileCollision[];
}

/**
 * Warns when related work items touch the same files — the "13 PRs all
 * edited mcp-server.ts and nobody saw it coming" failure. Mnema knows
 * the dependency/epic/sprint structure; this crosses it with the files
 * each task touches.
 *
 * The file set for a task is *inferred from its commit evidence*: each
 * `kind=commit` evidence ref is expanded with `git show --name-only`, so
 * attaching a commit is how a task declares what it touched — no new
 * schema, and it reuses the evidence surface commit-verification already
 * builds on. A task with no commit evidence yields no files (reported as
 * skipped, not silently ignored). Advisory only: a warning, never a gate.
 *
 * Uses the injectable {@link CommandRunner} (like GitHubPrService /
 * CommitVerifier), so tests drive it with a mock and it degrades to
 * "no files" outside a git repo rather than throwing.
 */
export class FileCollisionService {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly evidence: TaskEvidenceRepository,
    private readonly epics: EpicRepository,
    private readonly sprints: SprintRepository,
    private readonly projectRoot: string,
    private readonly run: CommandRunner = defaultRunner,
  ) {}

  /**
   * Scans a scope for file collisions between its tasks.
   *
   * @param scope - epic or sprint
   * @returns The report or `EpicNotFound` / `SprintNotFound`
   */
  scan(scope: CollisionScope): Result<CollisionReport, MnemaError> {
    const tasksResult = this.resolveScope(scope);
    if (!tasksResult.ok) return tasksResult;
    const scopeTasks = tasksResult.value;

    // Compute each task's touched-file set from its commit evidence, keyed by
    // the display alias (the handle the report carries).
    const filesByAlias = new Map<string, Set<string>>();
    const analysed: string[] = [];
    const skipped: string[] = [];
    for (const task of scopeTasks) {
      const alias = deriveAlias('task', task.id);
      const files = this.filesFor(task.id);
      if (files.size === 0) {
        skipped.push(alias);
      } else {
        filesByAlias.set(alias, files);
        analysed.push(alias);
      }
    }

    // Compare every unordered pair of analysed tasks for shared files.
    const collisions: FileCollision[] = [];
    const aliases = [...filesByAlias.keys()].sort();
    for (let i = 0; i < aliases.length; i += 1) {
      for (let j = i + 1; j < aliases.length; j += 1) {
        const a = aliases[i] as string;
        const b = aliases[j] as string;
        const shared = intersect(
          filesByAlias.get(a) ?? new Set(),
          filesByAlias.get(b) ?? new Set(),
        );
        if (shared.length > 0) {
          collisions.push({ taskA: a, taskB: b, files: shared });
        }
      }
    }
    collisions.sort((x, y) => y.files.length - x.files.length);

    return Ok({ scope, analysed: analysed.sort(), skipped: skipped.sort(), collisions });
  }

  /**
   * The set of files a task touched, inferred from its `kind=commit`
   * evidence via `git show --name-only`. Empty when the task has no
   * commit evidence or git cannot resolve the refs (advisory: a miss is
   * silent, never a throw).
   *
   * @param taskId - Internal task id
   */
  filesFor(taskId: string): Set<string> {
    const files = new Set<string>();
    for (const ev of this.evidence.findByTask(taskId)) {
      if (ev.kind !== 'commit') continue;
      const sha = ev.ref.trim();
      if (sha.length === 0) continue;
      // `--end-of-options` forces git to treat `sha` as a revision operand,
      // never a flag — an evidence ref like `--output=<path>` would otherwise
      // be honoured by `git show` and write an arbitrary file. Evidence refs
      // are not format-validated at attach time, so a hostile ref can reach
      // here from the database.
      const result = this.run('git', [
        '-C',
        this.projectRoot,
        'show',
        '--name-only',
        '--format=',
        '--end-of-options',
        sha,
      ]);
      if (result.error !== undefined || result.status !== 0) continue;
      for (const line of result.stdout.split('\n')) {
        const path = line.trim();
        if (path.length > 0) files.add(path);
      }
    }
    return files;
  }

  /** Resolves the scope to its active tasks. */
  private resolveScope(scope: CollisionScope): Result<Task[], MnemaError> {
    if (scope.kind === 'epic') {
      const epicResult = resolveEntity(this.epics, scope.key, (handle) => ({
        kind: ErrorCode.EpicNotFound,
        epicKey: handle,
      }));
      if (!epicResult.ok) return Err(epicResult.error);
      const epic = epicResult.value;
      return Ok(this.tasks.findByEpic(epic.id));
    }
    const sprintResult = resolveEntity(this.sprints, scope.key, (handle) => ({
      kind: ErrorCode.SprintNotFound,
      sprintKey: handle,
    }));
    if (!sprintResult.ok) return Err(sprintResult.error);
    const sprint = sprintResult.value;
    return Ok(this.sprints.listTasks(sprint.id));
  }
}

/** Sorted intersection of two string sets. */
function intersect(a: ReadonlySet<string>, b: ReadonlySet<string>): string[] {
  const shared: string[] = [];
  for (const item of a) {
    if (b.has(item)) shared.push(item);
  }
  return shared.sort();
}
