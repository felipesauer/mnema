import { Err, Ok, type Result } from '../../common/result.js';
import type { Dependency, DependencyKind } from '../../domain/entities/dependency.js';
import type { Task } from '../../domain/entities/task.js';
import type { StateMachine } from '../../domain/state-machine/state-machine.js';
import { ErrorCode } from '../../errors/error-codes.js';
import type { MnemaError } from '../../errors/mnema-error.js';
import type { DependencyRepository } from '../../storage/sqlite/repositories/dependency-repository.js';
import type { SprintRepository } from '../../storage/sqlite/repositories/sprint-repository.js';
import type { TaskRepository } from '../../storage/sqlite/repositories/task-repository.js';
import type { AuditService } from '../integrity/audit-service.js';
import { resolveEntity } from './resolve-entity.js';

/** The only `pickable` state a ready task can be in (per the default workflow). */
const READY_STATE = 'READY';

/**
 * Input for {@link DependencyService.link}.
 */
export interface LinkDependencyInput {
  readonly taskKey: string;
  readonly blocksTaskKey: string;
  readonly kind?: DependencyKind;
  readonly actor: string;
  readonly via?: string;
  readonly runId?: string;
}

/**
 * A task paired with the dependencies it declares and the dependencies
 * that point at it. Used by `task show` / CLI listings.
 */
export interface DependencyView {
  readonly dependsOn: readonly Dependency[];
  readonly blocks: readonly Dependency[];
}

/**
 * Manages task↔task dependencies over the existing `dependencies` table.
 *
 * Edge semantics: a row `(task_id=A, blocks_task_id=B)` means **A is
 * blocked by B** — B must reach a terminal state before A is ready.
 * Only `kind='blocks'` gates readiness; `relates_to`/`duplicates`/
 * `parent_of` are informational.
 *
 * Readiness is a *query* ({@link ready}), never an auto-transition
 * side-effect — consistent with "Mnema records work, it does not execute
 * it".
 */
export class DependencyService {
  constructor(
    private readonly dependencies: DependencyRepository,
    private readonly tasks: TaskRepository,
    private readonly sprints: SprintRepository,
    private readonly stateMachine: StateMachine,
    private readonly audit: AuditService,
  ) {}

  /**
   * Links two tasks with a dependency edge.
   *
   * @param input - Task keys + kind + identity tuple
   * @returns The created dependency or a structured error
   */
  link(input: LinkDependencyInput): Result<Dependency, MnemaError> {
    const kind: DependencyKind = input.kind ?? 'blocks';

    const taskResult = resolveEntity(this.tasks, input.taskKey, (taskKey) => ({
      kind: ErrorCode.TaskNotFound,
      taskKey,
    }));
    if (!taskResult.ok) return Err(taskResult.error);
    const task = taskResult.value;
    const blockerResult = resolveEntity(this.tasks, input.blocksTaskKey, (taskKey) => ({
      kind: ErrorCode.TaskNotFound,
      taskKey,
    }));
    if (!blockerResult.ok) return Err(blockerResult.error);
    const blocker = blockerResult.value;

    if (task.id === blocker.id) {
      return Err({ kind: ErrorCode.DependencySelf, taskKey: input.taskKey });
    }

    if (this.dependencies.exists(task.id, blocker.id, kind)) {
      return Err({
        kind: ErrorCode.DependencyDuplicate,
        taskKey: input.taskKey,
        blocksTaskKey: input.blocksTaskKey,
        dependencyKind: kind,
      });
    }

    // Cycle detection only applies to the `blocks` graph: would adding
    // "task is blocked by blocker" let us reach `task` again by walking
    // blockers forward from `blocker`?
    if (kind === 'blocks' && this.reachesViaBlocks(blocker.id, task.id)) {
      return Err({
        kind: ErrorCode.DependencyCycle,
        taskKey: input.taskKey,
        blocksTaskKey: input.blocksTaskKey,
      });
    }

    const created = this.dependencies.insert({
      taskId: task.id,
      blocksTaskId: blocker.id,
      kind,
    });

    this.audit.write({
      kind: 'dependency_linked',
      actor: input.actor,
      via: input.via,
      run: input.runId,
      data: { task_key: task.key, blocks_task_key: blocker.key, kind },
    });

    return Ok(created);
  }

  /**
   * Lists the dependencies declared by a task and the ones pointing at
   * it.
   *
   * @param taskKey - Task identifier
   * @returns The view or a structured error if the task is unknown
   */
  listFor(taskKey: string): Result<DependencyView, MnemaError> {
    const resolved = resolveEntity(this.tasks, taskKey, (handle) => ({
      kind: ErrorCode.TaskNotFound,
      taskKey: handle,
    }));
    if (!resolved.ok) return Err(resolved.error);
    const task = resolved.value;
    return Ok({
      dependsOn: this.dependencies.findByTask(task.id),
      blocks: this.dependencies.findBlocking(task.id),
    });
  }

  /**
   * Returns tasks that are ready to be picked up: in the workflow's
   * pickable state ({@link READY_STATE}) and with every blocking
   * dependency in a terminal state. Optionally scoped to one sprint.
   *
   * @param sprintKey - Optional sprint to scope the result to
   * @returns Ready tasks (ordered by key) or a structured error
   */
  ready(sprintKey?: string): Result<Task[], MnemaError> {
    let candidates: Task[];
    if (sprintKey === undefined) {
      candidates = this.tasks.findByState(READY_STATE);
    } else {
      const resolved = resolveEntity(this.sprints, sprintKey, (handle) => ({
        kind: ErrorCode.SprintNotFound,
        sprintKey: handle,
      }));
      if (!resolved.ok) return Err(resolved.error);
      const sprint = resolved.value;
      candidates = this.sprints.listTasks(sprint.id).filter((t) => t.state === READY_STATE);
    }

    const ready = candidates.filter((task) => this.blockersAllTerminal(task.id));
    return Ok(ready);
  }

  /**
   * True when every `blocks`-kind dependency of the task points at a
   * task in a terminal state.
   */
  private blockersAllTerminal(taskId: string): boolean {
    const deps = this.dependencies.findByTask(taskId).filter((d) => d.kind === 'blocks');
    for (const dep of deps) {
      const blocker = this.tasks.findById(dep.blocksTaskId);
      // A missing (soft-deleted) blocker no longer blocks; skip it.
      if (blocker === null) continue;
      if (!this.stateMachine.isTerminal(blocker.state)) return false;
    }
    return true;
  }

  /**
   * Walks the `blocks` graph forward from `startId` and reports whether
   * `targetId` is reachable. Used to reject cycles before inserting an
   * edge.
   */
  private reachesViaBlocks(startId: string, targetId: string): boolean {
    const seen = new Set<string>();
    const stack = [startId];
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined || seen.has(current)) continue;
      seen.add(current);
      if (current === targetId) return true;
      // Skip soft-deleted intermediate nodes so the cycle walk stays
      // consistent with the readiness walk (blockersAllTerminal also drops a
      // deleted blocker). A path that only reaches `targetId` *through* a
      // deleted node is not a live cycle and must not block the edge.
      // `startId` itself is exempt — it is the edge being created.
      if (current !== startId && this.tasks.findById(current) === null) continue;
      for (const dep of this.dependencies.findByTask(current)) {
        if (dep.kind === 'blocks') stack.push(dep.blocksTaskId);
      }
    }
    return false;
  }
}
