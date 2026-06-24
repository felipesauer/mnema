import type { Task } from '../domain/entities/task.js';
import type { TaskState } from '../domain/enums/task-state.js';
import { generateTaskKey } from '../domain/id-generator.js';
import type { StateMachine } from '../domain/state-machine/state-machine.js';
import type { FieldSpec } from '../domain/state-machine/workflow-meta-schema.js';
import { checkOptionalIntInRange, checkOptionalNonNegativeInt } from '../domain/validation.js';
import { ErrorCode } from '../errors/error-codes.js';
import { type ErrorIssue, fromZodIssues, type MnemaError } from '../errors/mnema-error.js';
import type { ProjectRepository } from '../storage/sqlite/repositories/project-repository.js';
import type {
  TaskFieldUpdates,
  TaskRepository,
} from '../storage/sqlite/repositories/task-repository.js';
import type { TransitionRepository } from '../storage/sqlite/repositories/transition-repository.js';
import { tryMutation } from '../storage/sqlite/sqlite-error-map.js';
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
  /** Estimated context cost in tokens; distinct from `estimate` (story points). */
  readonly contextBudget?: number | null;
  readonly priority?: number;
  readonly assigneeId?: string | null;
  /**
   * Free-form metadata persisted alongside the task. Importers use it
   * to carry source-specific data (`{ source: 'github', issue_number,
   * author, labels }`) so the trail back to the original record is
   * preserved without bloating the canonical fields.
   */
  readonly metadata?: Readonly<Record<string, unknown>>;
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
 *
 * `state` accepts any workflow state string; consumers should validate
 * against `stateMachine.getWorkflow().states` before calling, but the
 * service will simply return zero rows for unknown states rather than
 * throw — workflow-portability matters more than strict typing here.
 */
export interface ListTasksFilter {
  readonly state?: string;
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

    const issues: ErrorIssue[] = [];
    checkOptionalNonNegativeInt(input.estimate, 'estimate', issues);
    checkOptionalNonNegativeInt(input.contextBudget, 'context_budget', issues);
    checkOptionalIntInRange(input.priority, 'priority', 1, 5, issues);
    if (issues.length > 0) {
      return Err({ kind: ErrorCode.ValidationFailed, issues });
    }

    const reporterId = this.identity.ensureActor(input.actor, 'human');
    const viaActorId =
      input.via !== undefined ? this.identity.ensureActor(input.via, 'agent') : null;
    const initialState = this.stateMachine.getWorkflow().initial as TaskState;

    const writeResult = tryMutation(() =>
      this.tasks.runInTransaction(() => {
        const sequence = this.tasks.nextSequence(project.id);
        const key = generateTaskKey(project.key, sequence);

        const created = this.tasks.insert({
          key,
          projectId: project.id,
          title: input.title,
          description: input.description ?? null,
          acceptanceCriteria: input.acceptanceCriteria ?? [],
          estimate: input.estimate ?? null,
          contextBudget: input.contextBudget ?? null,
          priority: input.priority ?? 3,
          assigneeId: input.assigneeId ?? null,
          reporterId,
          state: initialState,
          metadata: input.metadata,
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
      }),
    );
    if (!writeResult.ok) return writeResult;
    const task = writeResult.value;

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

    // A "terminal" state is one with no declared outbound transitions —
    // any workflow that does declare them (e.g. jira-classic's
    // `CLOSED.reopen`) should be honoured. Block only when the JSON
    // truly leaves the state without exits.
    if (this.stateMachine.isTerminal(task.state)) {
      const exits = this.stateMachine.listActionsFrom(task.state);
      if (exits.length === 0) {
        return Err({
          kind: ErrorCode.TerminalState,
          taskKey: task.key,
          state: task.state,
        });
      }
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

    // A custom workflow may declare `estimate`/`priority` as a MUTATING gate
    // field with looser bounds than the first-class column allows (estimate ≥
    // 0 integer; priority 1..5). The gate would accept e.g. priority=8, then
    // the column fold would silently drop it — Ok returned, audit says 8, the
    // task row unchanged. Validate against the column invariant here so the
    // transition fails closed, symmetric with create(). This applies ONLY to
    // mutating fields: a `validating` field is recorded in the audit payload
    // and never folded to a column, so its value must not be column-validated.
    if (data !== null && typeof data === 'object') {
      const payload = data as Record<string, unknown>;
      const spec = validation.value.requiresSpec;
      const foldIssues: ErrorIssue[] = [];
      if (typeof payload.estimate === 'number' && isMutatingField(spec, 'estimate')) {
        checkOptionalNonNegativeInt(payload.estimate, 'estimate', foldIssues);
      }
      if (typeof payload.priority === 'number' && isMutatingField(spec, 'priority')) {
        checkOptionalIntInRange(payload.priority, 'priority', 1, 5, foldIssues);
      }
      if (foldIssues.length > 0) {
        return Err({ kind: ErrorCode.ValidationFailed, issues: foldIssues });
      }
    }

    const actorId = this.identity.ensureActor(input.actor, 'human');
    const viaActorId =
      input.via !== undefined ? this.identity.ensureActor(input.via, 'agent') : null;

    type TransitionOutcome =
      | { readonly kind: 'ok'; readonly task: Task }
      | { readonly kind: 'not_found' }
      | { readonly kind: 'conflict'; readonly currentUpdatedAt: string };

    // Default the optimistic-concurrency token to whatever we just
    // read so concurrent transitions can't lose-write each other.
    // Callers that need to write blind can opt in by passing an
    // explicit empty string (treated as "no token") — there is no
    // CLI surface for that today, and the default is fail-closed.
    const expectedUpdatedAt =
      input.expectedUpdatedAt !== undefined ? input.expectedUpdatedAt : task.updatedAt;

    const outcomeResult = tryMutation(() =>
      this.tasks.runInTransaction((): TransitionOutcome => {
        const result = this.tasks.updateState(task.id, to as TaskState, expectedUpdatedAt);
        if (!result.ok) {
          if (result.reason.kind === 'CONFLICT') {
            return { kind: 'conflict', currentUpdatedAt: result.reason.currentUpdatedAt };
          }
          return { kind: 'not_found' };
        }

        // Fold validated payload back onto the task itself so a later
        // `task show` reflects what the user declared at the gate. Two
        // filters apply: (a) the field has to map to a first-class task
        // column (whitelist below); (b) the workflow spec for the field
        // must not declare `field_kind: 'validating'` — those are
        // one-shot annotations that live in `transitions.payload` only.
        const persisted = persistableFromPayload(
          (data ?? {}) as Record<string, unknown>,
          validation.value.requiresSpec,
          (handle) => this.identity.ensureActor(handle, 'human'),
        );
        let finalTask =
          persisted === null ? result.task : this.tasks.updateFields(task.id, persisted);

        // The `reopen` action is the canonical signal across the
        // shipping workflows (default, jira-classic) that work is
        // being re-entered after reaching a terminal state — bump the
        // counter on the task row so consumers can flag chronically
        // reopened items.
        if (input.action === 'reopen') {
          const bumped = this.tasks.incrementReopenCount(task.id);
          if (bumped !== null) finalTask = bumped;
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

        return { kind: 'ok', task: finalTask };
      }),
    );
    if (!outcomeResult.ok) return outcomeResult;
    const outcome = outcomeResult.value;

    if (outcome.kind === 'not_found') {
      return Err({ kind: ErrorCode.TaskNotFound, taskKey: task.key });
    }
    if (outcome.kind === 'conflict') {
      return Err({
        kind: ErrorCode.Conflict,
        entity: 'task',
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

  /**
   * Looks up active tasks with an exact title match in the given
   * project. Returns an empty array when the project is unknown rather
   * than an error — used by importers that want to skip duplicates
   * without short-circuiting the whole import on a misconfigured key.
   *
   * @param projectKey - Project key
   * @param title - Exact title to match
   * @returns Matching active tasks (usually 0 or 1)
   */
  findActiveByTitle(projectKey: string, title: string): Task[] {
    const project = this.projects.findByKey(projectKey);
    if (project === null) return [];
    return this.tasks.findByTitle(project.id, title);
  }

  /**
   * Soft-deletes a task by stamping `deleted_at`. The row stays in the
   * database so it can be restored by {@link restore}; the markdown
   * mirror is rebuilt on the next sync (the deleted task is omitted).
   *
   * @param input - Task key + identity tuple
   * @returns The deleted task (post-stamp) or a structured error
   */
  softDelete(input: {
    taskKey: string;
    actor: string;
    via?: string;
    runId?: string;
  }): Result<Task, MnemaError> {
    const task = this.tasks.findByKey(input.taskKey);
    if (task === null) {
      return Err({ kind: ErrorCode.TaskNotFound, taskKey: input.taskKey });
    }

    const ok = this.tasks.softDelete(task.id);
    if (!ok) {
      return Err({ kind: ErrorCode.TaskNotFound, taskKey: input.taskKey });
    }

    this.audit.write({
      kind: 'task_deleted',
      actor: input.actor,
      via: input.via,
      run: input.runId,
      data: { key: task.key, state: task.state },
    });

    this.sync.syncTask(task.key);

    const updated = this.tasks.findByKeyIncludingDeleted(input.taskKey);
    if (updated === null) {
      return Err({ kind: ErrorCode.TaskNotFound, taskKey: input.taskKey });
    }
    return Ok(updated);
  }

  /**
   * Restores a previously soft-deleted task by clearing `deleted_at`.
   *
   * @param input - Task key + identity tuple
   * @returns The restored task or a structured error
   */
  restore(input: {
    taskKey: string;
    actor: string;
    via?: string;
    runId?: string;
  }): Result<Task, MnemaError> {
    const task = this.tasks.findByKeyIncludingDeleted(input.taskKey);
    if (task === null) {
      return Err({ kind: ErrorCode.TaskNotFound, taskKey: input.taskKey });
    }

    const ok = this.tasks.restore(task.id);
    if (!ok) {
      return Err({ kind: ErrorCode.TaskNotFound, taskKey: input.taskKey });
    }

    this.audit.write({
      kind: 'task_restored',
      actor: input.actor,
      via: input.via,
      run: input.runId,
      data: { key: task.key, state: task.state },
    });

    this.sync.syncTask(task.key);

    const restored = this.tasks.findByKey(input.taskKey);
    if (restored === null) {
      return Err({ kind: ErrorCode.TaskNotFound, taskKey: input.taskKey });
    }
    return Ok(restored);
  }
}

/**
 * Whether a gate field folds onto its first-class task column. A field
 * declared `field_kind: 'validating'` is a one-shot annotation that lives only
 * in `transitions.payload`; anything else (or absent from the spec) folds.
 * Shared by the transition fold-validation guard and {@link persistableFromPayload}
 * so the two cannot drift.
 */
function isMutatingField(
  requiresSpec: Readonly<Record<string, FieldSpec>>,
  field: string,
): boolean {
  const spec = requiresSpec[field];
  return spec === undefined || (spec.field_kind ?? 'mutating') === 'mutating';
}

/**
 * Picks the subset of a transition payload that maps to first-class
 * task columns. Annotation-only payload bits (reason, approval_note,
 * pr_url, note, supersededBy, …) are filtered out — they remain in
 * `transitions.payload` for audit but never overwrite the task row.
 *
 * `assignee_id` carries a *handle* in the payload (the audit trail is
 * human-readable), but the column is a foreign key to `actors.id`. The
 * passed-in `resolveActor` translates handle → UUID, ensuring the actor
 * exists.
 *
 * Returns `null` when nothing in the payload is persistable, so the
 * caller can skip the UPDATE altogether and avoid a needless
 * `updated_at` bump.
 *
 * @param payload - Validated transition payload
 * @param resolveActor - Maps a human handle to the actor UUID (creating one if needed)
 * @returns Subset suitable for {@link TaskRepository.updateFields} or null
 */
function persistableFromPayload(
  payload: Record<string, unknown>,
  requiresSpec: Readonly<Record<string, FieldSpec>>,
  resolveActor: (handle: string) => string,
): TaskFieldUpdates | null {
  const updates: TaskFieldUpdates = {};
  let touched = false;
  const isMutating = (field: string): boolean => isMutatingField(requiresSpec, field);

  if (typeof payload.title === 'string' && isMutating('title')) {
    (updates as { title?: string }).title = payload.title;
    touched = true;
  }
  if (typeof payload.description === 'string' && isMutating('description')) {
    (updates as { description?: string | null }).description = payload.description;
    touched = true;
  }
  if (Array.isArray(payload.acceptance_criteria) && isMutating('acceptance_criteria')) {
    (updates as { acceptanceCriteria?: readonly string[] }).acceptanceCriteria =
      payload.acceptance_criteria.filter((v): v is string => typeof v === 'string');
    touched = true;
  }
  // `typeof NaN === 'number'`, so a non-finite/out-of-range value from the
  // payload would otherwise reach the column and trip a NOT NULL / CHECK
  // constraint. Only fold through values that satisfy the same invariant the
  // create path enforces; anything else is dropped (a `requires` field would
  // already have been rejected by the workflow gate before reaching here).
  if (
    typeof payload.estimate === 'number' &&
    Number.isInteger(payload.estimate) &&
    payload.estimate >= 0 &&
    isMutating('estimate')
  ) {
    (updates as { estimate?: number | null }).estimate = payload.estimate;
    touched = true;
  }
  if (
    typeof payload.priority === 'number' &&
    Number.isInteger(payload.priority) &&
    payload.priority >= 1 &&
    payload.priority <= 5 &&
    isMutating('priority')
  ) {
    (updates as { priority?: number }).priority = payload.priority;
    touched = true;
  }
  if (
    typeof payload.assignee_id === 'string' &&
    payload.assignee_id.length > 0 &&
    isMutating('assignee_id')
  ) {
    (updates as { assigneeId?: string | null }).assigneeId = resolveActor(payload.assignee_id);
    touched = true;
  }

  return touched ? updates : null;
}
