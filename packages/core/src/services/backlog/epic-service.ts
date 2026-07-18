import { Err, Ok, type Result } from '../../common/result.js';
import type { Epic } from '../../domain/entities/epic.js';
import type { Task } from '../../domain/entities/task.js';
import type { EpicLifecycle } from '../../domain/enums/epic-lifecycle.js';
import { EpicState } from '../../domain/enums/epic-state.js';
import type { StateMachine } from '../../domain/state-machine/state-machine.js';
import { ErrorCode } from '../../errors/error-codes.js';
import type { ErrorIssue, MnemaError } from '../../errors/mnema-error.js';
import type { EpicRepository } from '../../storage/sqlite/repositories/epic-repository.js';
import type { ProjectRepository } from '../../storage/sqlite/repositories/project-repository.js';
import type { TaskRepository } from '../../storage/sqlite/repositories/task-repository.js';
import type { AuditService } from '../integrity/audit-service.js';
import type { RoadmapMirror } from '../sync/roadmap-mirror.js';
import type { SyncService } from '../sync/sync-service.js';

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
 * Input for {@link EpicService.update}. Every content field is optional —
 * only the ones supplied are overwritten.
 */
export interface UpdateEpicInput {
  readonly epicKey: string;
  readonly title?: string;
  readonly description?: string | null;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly actor: string;
  readonly via?: string;
  readonly runId?: string;
}

/**
 * Input for {@link EpicService.delete}.
 */
export interface DeleteEpicInput {
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
  /** Derived progress label — see {@link EpicLifecycle}. */
  readonly lifecycle: EpicLifecycle;
}

/** Projected side effects of closing or deleting an epic — see {@link EpicService.impact}. */
export interface EpicImpact {
  readonly epicKey: string;
  readonly state: string;
  readonly attachedTaskKeys: readonly string[];
  readonly attachedTaskCount: number;
  /** Attached tasks not in a terminal state — a close would strand these. */
  readonly nonTerminalTaskKeys: readonly string[];
  /** True when a delete would be refused because tasks are still attached. */
  readonly deleteWouldBeRefused: boolean;
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

    const issues: ErrorIssue[] = [];
    checkTitle(input.title, issues);
    if (issues.length > 0) {
      return Err({ kind: ErrorCode.ValidationFailed, issues });
    }

    // BEGIN IMMEDIATE: take the write lock before the nextSequence COUNT so
    // two processes on one state.db cannot mint the same key.
    const epic = this.epics.runInTransactionImmediate(() => {
      const sequence = this.epics.nextSequence(project.id);
      const key = `${project.key}-EPIC-${sequence}`;
      return this.epics.insert({
        key,
        projectId: project.id,
        title: input.title,
        description: input.description ?? null,
      });
    });

    this.audit.write({
      kind: 'epic_created',
      actor: input.actor,
      via: input.via,
      run: input.runId,
      // The committed id binds provenance to the clone-stable identity.
      data: { id: epic.id, key: epic.key, title: epic.title },
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
   * Edits an epic's content (title / description / metadata) after
   * creation. Only the supplied fields are overwritten; the rest are left
   * as-is. The markdown mirror is rewritten so the versioned `.md`
   * reflects the edit.
   *
   * The `epics` table carries no `updated_at`, so there is no
   * optimistic-concurrency token to compare — edits are last-write-wins,
   * the same contract sync rebuild already uses when it folds content
   * drift back onto an epic row.
   *
   * @param input - Epic key + content fields + identity tuple
   * @returns The updated epic or a structured error
   */
  update(input: UpdateEpicInput): Result<Epic, MnemaError> {
    const epic = this.epics.findByKey(input.epicKey);
    if (epic === null) {
      return Err({ kind: ErrorCode.EpicNotFound, epicKey: input.epicKey });
    }

    if (input.title !== undefined) {
      const issues: ErrorIssue[] = [];
      checkTitle(input.title, issues);
      if (issues.length > 0) {
        return Err({ kind: ErrorCode.ValidationFailed, issues });
      }
    }

    const updated = this.epics.runInTransaction(() =>
      this.epics.updateFields(epic.id, {
        title: input.title,
        description: input.description,
        metadata: input.metadata,
      }),
    );

    this.audit.write({
      kind: 'epic_updated',
      actor: input.actor,
      via: input.via,
      run: input.runId,
      data: { key: updated.key, title: updated.title },
    });

    this.mirror?.writeEpic(updated);

    return Ok(updated);
  }

  /**
   * Soft-deletes an epic and drops its markdown mirror. Refuses when the
   * epic still has tasks attached — the same protective stance as
   * {@link close}, so a stray delete can't strand tasks pointing at an
   * epic that no longer resolves. Detach the tasks first (`epic remove`),
   * then delete.
   *
   * @param input - Epic key + identity tuple
   * @returns The soft-deleted epic or a structured error
   */
  delete(input: DeleteEpicInput): Result<Epic, MnemaError> {
    const epic = this.epics.findByKey(input.epicKey);
    if (epic === null) {
      return Err({ kind: ErrorCode.EpicNotFound, epicKey: input.epicKey });
    }

    const taskKeys = this.epics.listTaskKeys(epic.id);
    if (taskKeys.length > 0) {
      return Err({
        kind: ErrorCode.EpicHasTasks,
        epicKey: epic.key,
        taskCount: taskKeys.length,
      });
    }

    // Unlink the mirror BEFORE the soft-delete commit. A filesystem unlink
    // can't join the SQLite transaction, so the two steps can't be atomic —
    // the order is chosen so a crash between them leaves a self-healing
    // state rather than an orphan. Removing the `.md` first means a crash
    // leaves a live row with no mirror, which `rebuildMirrors` re-creates
    // (benign). The reverse order would leave a soft-deleted row with a live
    // `.md`, and a rebuild would re-insert the deleted epic as live — an
    // orphan that reads as live. This matches how task soft-delete drops the
    // markdown for a row it is about to remove from the active set.
    this.mirror?.removeEpic(epic.key);

    const deleted = this.epics.runInTransaction(() => this.epics.softDelete(epic.id));
    if (!deleted) {
      return Err({ kind: ErrorCode.EpicNotFound, epicKey: input.epicKey });
    }

    this.audit.write({
      kind: 'epic_deleted',
      actor: input.actor,
      via: input.via,
      run: input.runId,
      data: { key: epic.key },
    });

    return Ok(epic);
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
   * Projects the blast radius of closing or deleting an epic, without
   * mutating anything. Callers surface this as a pre-flight "intent diff"
   * so an agent sees the side effects before committing to a destructive
   * op. Reports the attached tasks (all of them, plus the non-terminal
   * subset that a close would strand mid-flight) so the caller can warn
   * about work that is not finished, and whether a delete would be refused
   * (delete requires zero attached tasks).
   *
   * @param epicKey - Epic key
   * @returns The impact view or `EpicNotFound`
   */
  impact(epicKey: string): Result<EpicImpact, MnemaError> {
    const epic = this.epics.findByKey(epicKey);
    if (epic === null) {
      return Err({ kind: ErrorCode.EpicNotFound, epicKey });
    }
    const taskKeys = this.epics.listTaskKeys(epic.id);
    const nonTerminal = taskKeys
      .map((key) => this.tasks.findByKey(key))
      .filter((t): t is Task => t !== null && !this.stateMachine.isTerminal(t.state))
      .map((t) => t.key);
    return Ok({
      epicKey: epic.key,
      state: epic.state,
      attachedTaskKeys: taskKeys,
      attachedTaskCount: taskKeys.length,
      nonTerminalTaskKeys: nonTerminal,
      // delete() refuses while any task is attached; close() is always allowed
      // but strands non-terminal tasks under a closed epic.
      deleteWouldBeRefused: taskKeys.length > 0,
    });
  }

  /**
   * Derives the epic's lifecycle label from its state and the states of
   * its tasks. Never stored — always computed.
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

  /**
   * Writes a markdown mirror for every epic that has none — the recovery
   * path for projects created before mirrors existed, or after a manual
   * deletion. Existing files are left untouched.
   *
   * @param projectKey - Project key
   * @returns Keys of the epics whose mirror was just written
   */
  rebuildMirrors(projectKey: string): string[] {
    if (this.mirror === null) return [];
    const rebuilt: string[] = [];
    for (const epic of this.list(projectKey)) {
      if (!this.mirror.hasEpic(epic.key)) {
        this.mirror.writeEpic(epic);
        rebuilt.push(epic.key);
      }
    }
    return rebuilt;
  }
}

/**
 * Pushes an issue when a title is outside the 3..200 length the create
 * path enforces (via the MCP schema). Gives `update` the same contract at
 * the service boundary so the CLI and MCP producers reject identically.
 */
function checkTitle(title: string, issues: ErrorIssue[]): void {
  if (title.length < 3) {
    issues.push({ path: ['title'], message: 'must be at least 3 characters' });
  } else if (title.length > 200) {
    issues.push({ path: ['title'], message: 'must be at most 200 characters' });
  }
}
