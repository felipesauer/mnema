import type { Task } from '../domain/entities/task.js';
import type { TaskState } from '../domain/enums/task-state.js';
import { generateTaskKey } from '../domain/id-generator.js';
import type { StateMachine } from '../domain/state-machine/state-machine.js';
import { ErrorCode } from '../errors/error-codes.js';
import { fromZodIssues, type MnemaError } from '../errors/mnema-error.js';
import type { ProjectRepository } from '../storage/sqlite/repositories/project-repository.js';
import type { TaskRepository } from '../storage/sqlite/repositories/task-repository.js';
import type { TransitionRepository } from '../storage/sqlite/repositories/transition-repository.js';
import type { AuditService } from './audit-service.js';
import { Err, Ok, type Result } from './result.js';
import type { SyncService } from './sync-service.js';

/**
 * Input for creating a new task.
 *
 * Tasks always start in the workflow's initial state. Gates only
 * apply on subsequent transitions, so `create` accepts a minimal
 * shape and lets later moves (e.g. `submit`) enforce field rules.
 */
export interface CreateTaskInput {
  readonly projectKey: string;
  readonly title: string;
  readonly description?: string;
  readonly acceptanceCriteria?: readonly string[];
  readonly estimate?: number | null;
  readonly priority?: number;
  readonly assigneeId?: string | null;
  readonly actor: string;
  readonly via?: string;
  readonly runId?: string;
}

/**
 * Input for moving a task through a workflow action.
 */
export interface TransitionInput {
  readonly taskKey: string;
  readonly action: string;
  readonly payload: Record<string, unknown>;
  readonly actor: string;
  readonly via?: string;
  readonly runId?: string;
  readonly expectedUpdatedAt?: string;
}

/**
 * Filter for {@link TaskService.list}.
 */
export interface ListTasksFilter {
  readonly state?: TaskState;
}

/**
 * Orchestrates task lifecycle: creation, state transitions, queries.
 *
 * Every mutation runs inside a single SQLite transaction. Audit and
 * sync side-effects fire after the transaction commits — if those
 * fail, SQLite is already consistent.
 */
export class TaskService {
  constructor(
    private readonly tasks: TaskRepository,
    private readonly transitions: TransitionRepository,
    private readonly projects: ProjectRepository,
    private readonly stateMachine: StateMachine,
    private readonly audit: AuditService,
    private readonly sync: SyncService,
    private readonly identity: { ensureActor: (handle: string, kind: 'human' | 'agent') => string },
  ) {}

  /**
   * Creates a new task in the workflow's initial state.
   *
   * @param input - Task fields and identity context
   * @returns The created task or a structured error
   */
  create(input: CreateTaskInput): Result<Task, MnemaError> {
    const project = this.projects.findByKey(input.projectKey);
    if (project === null) {
      return Err({ kind: ErrorCode.ProjectNotFound, projectKey: input.projectKey });
    }

    const reporterId = this.identity.ensureActor(input.actor, 'human');
    const viaActorId =
      input.via !== undefined ? this.identity.ensureActor(input.via, 'agent') : null;
    const initialState = this.stateMachine.getWorkflow().initial as TaskState;

    const task = this.tasks.runInTransaction(() => {
      const sequence = this.tasks.nextSequence(project.id);
      const key = generateTaskKey(project.key, sequence);

      const created = this.tasks.insert({
        key,
        projectId: project.id,
        title: input.title,
        description: input.description ?? null,
        acceptanceCriteria: input.acceptanceCriteria ?? [],
        estimate: input.estimate ?? null,
        priority: input.priority ?? 3,
        assigneeId: input.assigneeId ?? null,
        reporterId,
        state: initialState,
      });

      this.transitions.record({
        taskId: created.id,
        fromState: null,
        toState: initialState,
        action: 'create',
        payload: { title: input.title },
        actorId: reporterId,
        viaActorId,
        agentRunId: input.runId ?? null,
      });

      return created;
    });

    this.audit.write({
      kind: 'task_created',
      actor: input.actor,
      via: input.via,
      run: input.runId,
      data: { key: task.key, title: task.title, state: task.state },
    });

    this.sync.syncTask(task.key);

    return Ok(task);
  }

  /**
   * Moves a task to a new state by executing a workflow action.
   *
   * Validates against the active workflow's gates and persists every
   * change (state mutation + transition log) atomically.
   *
   * @param input - Action, payload, and identity context
   * @returns The updated task or a structured error
   */
  transition(input: TransitionInput): Result<Task, MnemaError> {
    const task = this.tasks.findByKey(input.taskKey);
    if (task === null) {
      return Err({ kind: ErrorCode.TaskNotFound, taskKey: input.taskKey });
    }

    if (this.stateMachine.isTerminal(task.state)) {
      return Err({
        kind: ErrorCode.TerminalState,
        taskKey: task.key,
        state: task.state,
      });
    }

    const validation = this.stateMachine.validateTransition(
      task.state,
      input.action,
      input.payload,
    );

    if (!validation.ok) {
      const error = validation.error;
      if (error.kind === 'INVALID_TRANSITION') {
        const available = this.stateMachine.listActionsFrom(task.state).map((a) => a.action);
        return Err({
          kind: ErrorCode.InvalidTransition,
          taskKey: task.key,
          fromState: task.state,
          action: input.action,
          available,
        });
      }
      return Err({
        kind: ErrorCode.GateFailed,
        taskKey: task.key,
        action: input.action,
        issues: fromZodIssues(error.issues),
      });
    }

    const { to, data } = validation.value;
    const actorId = this.identity.ensureActor(input.actor, 'human');
    const viaActorId =
      input.via !== undefined ? this.identity.ensureActor(input.via, 'agent') : null;

    type TransitionOutcome =
      | { readonly kind: 'ok'; readonly task: Task }
      | { readonly kind: 'not_found' }
      | { readonly kind: 'conflict'; readonly currentUpdatedAt: string };

    const outcome = this.tasks.runInTransaction((): TransitionOutcome => {
      const result = this.tasks.updateState(
        task.id,
        to as TaskState,
        input.expectedUpdatedAt ?? null,
      );
      if (!result.ok) {
        if (result.reason.kind === 'CONFLICT') {
          return { kind: 'conflict', currentUpdatedAt: result.reason.currentUpdatedAt };
        }
        return { kind: 'not_found' };
      }

      this.transitions.record({
        taskId: task.id,
        fromState: task.state,
        toState: to,
        action: input.action,
        payload: (data ?? {}) as Record<string, unknown>,
        actorId,
        viaActorId,
        agentRunId: input.runId ?? null,
      });

      return { kind: 'ok', task: result.task };
    });

    if (outcome.kind === 'not_found') {
      return Err({ kind: ErrorCode.TaskNotFound, taskKey: task.key });
    }
    if (outcome.kind === 'conflict') {
      return Err({
        kind: ErrorCode.Conflict,
        taskKey: task.key,
        currentUpdatedAt: outcome.currentUpdatedAt,
      });
    }
    const updated = outcome.task;

    this.audit.write({
      kind: 'task_transitioned',
      actor: input.actor,
      via: input.via,
      run: input.runId,
      data: {
        key: task.key,
        from: task.state,
        to,
        action: input.action,
      },
    });

    this.sync.syncTask(task.key);

    return Ok(updated);
  }

  /**
   * Returns a task by its human-readable key.
   *
   * @param key - Task key (e.g. `"WEBAPP-42"`)
   * @returns The task or a {@link ErrorCode.TaskNotFound} error
   */
  findByKey(key: string): Result<Task, MnemaError> {
    const task = this.tasks.findByKey(key);
    if (task === null) {
      return Err({ kind: ErrorCode.TaskNotFound, taskKey: key });
    }
    return Ok(task);
  }

  /**
   * Lists tasks, optionally filtered by state.
   *
   * @param filter - Optional filter parameters
   * @returns Array of matching tasks ordered by key
   */
  list(filter: ListTasksFilter = {}): Task[] {
    if (filter.state !== undefined) {
      return this.tasks.findByState(filter.state);
    }
    return this.tasks.findAllActive();
  }
}
