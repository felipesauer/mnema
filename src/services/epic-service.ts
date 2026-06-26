import type { Epic } from '../domain/entities/epic.js';
import type { Task } from '../domain/entities/task.js';
import type { EpicLifecycle } from '../domain/enums/epic-lifecycle.js';
import { EpicState } from '../domain/enums/epic-state.js';
import type { StateMachine } from '../domain/state-machine/state-machine.js';
import { ErrorCode } from '../errors/error-codes.js';
import type { MnemaError } from '../errors/mnema-error.js';
import type { EpicRepository } from '../storage/sqlite/repositories/epic-repository.js';
import type { ProjectRepository } from '../storage/sqlite/repositories/project-repository.js';
import type { TaskRepository } from '../storage/sqlite/repositories/task-repository.js';
import type { AuditService } from './audit-service.js';
import { Err, Ok, type Result } from './result.js';
import type { RoadmapMirror } from './roadmap-mirror.js';
import type { SyncService } from './sync-service.js';

/**
 * Input for {@link EpicService.create}.
 */
export interface CreateEpicInput {
  readonly projectKey: string;
  readonly title: string;
  readonly description?: string;
  readonly actor: string;
  readonly via?: string;
  readonly runId?: string;
}

/**
 * Input for {@link EpicService.close}.
 */
export interface CloseEpicInput {
  readonly epicKey: string;
  readonly actor: string;
  readonly via?: string;
  readonly runId?: string;
}

/**
 * Input for {@link EpicService.addTask} / {@link EpicService.removeTask}.
 */
export interface EpicTaskInput {
  readonly epicKey: string;
  readonly taskKey: string;
  readonly actor: string;
  readonly via?: string;
  readonly runId?: string;
}

/**
 * Snapshot view of an epic plus the keys of its tasks.
 */
export interface EpicView {
  readonly epic: Epic;
  readonly taskKeys: readonly string[];
  /** Derived progress label — see {@link EpicLifecycle} (MNEMA-ADR-24). */
  readonly lifecycle: EpicLifecycle;
}

/**
 * Manages epics — long-lived containers that group tasks under a theme
 * or feature. Lifecycle is intentionally minimal: `OPEN → CLOSED`,
 * never reopened.
 */
export class EpicService {
  constructor(
    private readonly epics: EpicRepository,
    private readonly tasks: TaskRepository,
    private readonly projects: ProjectRepository,
    private readonly audit: AuditService,
    private readonly stateMachine: StateMachine,
    // Optional so unit tests can drive the service without a filesystem.
    // The container always wires both: `mirror` versions the epic itself,
    // `sync` rewrites a task's markdown when its epic link changes.
    private readonly mirror: RoadmapMirror | null = null,
    private readonly sync: SyncService | null = null,
  ) {}

  /**
   * Creates a new epic in `OPEN` state.
   *
   * @param input - Epic fields + identity tuple
   * @returns The created epic or a structured error
   */
  create(input: CreateEpicInput): Result<Epic, MnemaError> {
    // Workflows that declare `features.epics: false` (e.g. `lean`) do
    // not have an epic concept — refuse rather than create a row no
    // transition will reference.
    const workflow = this.stateMachine.getWorkflow();
    if (!workflow.features.epics) {
      return Err({
        kind: ErrorCode.FeatureNotAvailable,
        feature: 'epics',
        workflow: workflow.name,
      });
    }

    const project = this.projects.findByKey(input.projectKey);
    if (project === null) {
      return Err({ kind: ErrorCode.ProjectNotFound, projectKey: input.projectKey });
    }

    const sequence = this.epics.nextSequence(project.id);
    const key = `${project.key}-EPIC-${sequence}`;

    const epic = this.epics.insert({
      key,
      projectId: project.id,
      title: input.title,
      description: input.description ?? null,
    });

    this.audit.write({
      kind: 'epic_created',
      actor: input.actor,
      via: input.via,
      run: input.runId,
      data: { key: epic.key, title: epic.title },
    });

    this.mirror?.writeEpic(epic);

    return Ok(epic);
  }

  /**
   * Closes an `OPEN` epic.
   *
   * @param input - Epic key + identity tuple
   * @returns The updated epic or a structured error
   */
  close(input: CloseEpicInput): Result<Epic, MnemaError> {
    const epic = this.epics.findByKey(input.epicKey);
    if (epic === null) {
      return Err({ kind: ErrorCode.EpicNotFound, epicKey: input.epicKey });
    }
    if (epic.state !== EpicState.Open) {
      return Err({
        kind: ErrorCode.EpicInvalidState,
        epicKey: epic.key,
        fromState: epic.state,
        toState: EpicState.Closed,
      });
    }
    const updated = this.epics.updateState(epic.id, EpicState.Closed);
    if (updated === null) {
      return Err({ kind: ErrorCode.EpicNotFound, epicKey: input.epicKey });
    }

    this.audit.write({
      kind: 'epic_closed',
      actor: input.actor,
      via: input.via,
      run: input.runId,
      data: { key: updated.key },
    });

    this.mirror?.writeEpic(updated);

    return Ok(updated);
  }

  /**
   * Attaches a task to an epic.
   *
   * @param input - Epic key + task key + identity tuple
   * @returns The updated task or a structured error
   */
  addTask(input: EpicTaskInput): Result<Task, MnemaError> {
    const epic = this.epics.findByKey(input.epicKey);
    if (epic === null) {
      return Err({ kind: ErrorCode.EpicNotFound, epicKey: input.epicKey });
    }
    const task = this.tasks.findByKey(input.taskKey);
    if (task === null) {
      return Err({ kind: ErrorCode.TaskNotFound, taskKey: input.taskKey });
    }
    this.epics.addTask(epic.id, task.id);

    this.audit.write({
      kind: 'epic_task_added',
      actor: input.actor,
      via: input.via,
      run: input.runId,
      data: { epic_key: epic.key, task_key: task.key },
    });

    // The epic link lives in the task's markdown, so rewrite it.
    this.sync?.syncTask(task.key, { action: 'epic_task_added', runId: input.runId });

    const updated = this.tasks.findByKey(input.taskKey);
    if (updated === null) {
      return Err({ kind: ErrorCode.TaskNotFound, taskKey: input.taskKey });
    }
    return Ok(updated);
  }

  /**
   * Removes a task from its epic (no-op if it has none).
   *
   * @param input - Task key + identity tuple
   * @returns The updated task or a structured error
   */
  removeTask(input: EpicTaskInput): Result<Task, MnemaError> {
    const task = this.tasks.findByKey(input.taskKey);
    if (task === null) {
      return Err({ kind: ErrorCode.TaskNotFound, taskKey: input.taskKey });
    }
    this.epics.removeTask(task.id);

    this.audit.write({
      kind: 'epic_task_removed',
      actor: input.actor,
      via: input.via,
      run: input.runId,
      data: { epic_key: input.epicKey, task_key: task.key },
    });

    // The epic link lives in the task's markdown, so rewrite it.
    this.sync?.syncTask(task.key, { action: 'epic_task_removed', runId: input.runId });

    const updated = this.tasks.findByKey(input.taskKey);
    if (updated === null) {
      return Err({ kind: ErrorCode.TaskNotFound, taskKey: input.taskKey });
    }
    return Ok(updated);
  }

  /**
   * Returns an epic plus the keys of its tasks.
   *
   * @param epicKey - Epic key
   * @returns The epic view or a structured error when unknown
   */
  show(epicKey: string): Result<EpicView, MnemaError> {
    const epic = this.epics.findByKey(epicKey);
    if (epic === null) {
      return Err({ kind: ErrorCode.EpicNotFound, epicKey });
    }
    const taskKeys = this.epics.listTaskKeys(epic.id);
    return Ok({ epic, taskKeys, lifecycle: this.deriveLifecycle(epic, taskKeys) });
  }

  /**
   * Derives the epic's lifecycle label from its state and the states of
   * its tasks. Never stored — always computed (MNEMA-ADR-24).
   */
  private deriveLifecycle(epic: Epic, taskKeys: readonly string[]): EpicLifecycle {
    if (epic.state === EpicState.Closed) return 'closed';
    if (taskKeys.length === 0) return 'empty';
    const tasks = taskKeys
      .map((key) => this.tasks.findByKey(key))
      .filter((t): t is Task => t !== null);
    const allTerminal =
      tasks.length > 0 && tasks.every((t) => this.stateMachine.isTerminal(t.state));
    return allTerminal ? 'developed' : 'in-progress';
  }

  /**
   * Lists epics of a project ordered by creation.
   *
   * @param projectKey - Project key
   * @param state - Optional state filter
   * @returns Epics ordered by `created_at`
   */
  list(projectKey: string, state?: EpicState): readonly Epic[] {
    const project = this.projects.findByKey(projectKey);
    if (project === null) return [];
    return this.epics.findByProject(project.id, state);
  }
}
