import type { Task } from '../domain/entities/task.js';
import { EnforcementMode } from '../domain/enums/enforcement-mode.js';
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

/** Matches a v4/v7 UUID so an assignee reference can be told apart from a handle. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    private readonly identity: {
      ensureActor: (handle: string, kind: 'human' | 'agent') => string;
      findActorIdByHandle: (handle: string) => string | null;
    },
    // How a failed gate is enforced. Defaults to Blocking — the historical
    // behaviour (a failed gate always blocks) — so callers that don't pass
    // it keep working; the container supplies the configured value.
    private readonly enforcementMode: EnforcementMode = EnforcementMode.Blocking,
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

    const assignee = this.resolveAssignee(input.assigneeId ?? null);
    if (!assignee.ok) return assignee;

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
          assigneeId: assignee.value,
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
   * Resolves an assignee reference (a handle like `maria` or a raw UUID)
   * to an actor id, or `null` when unset. A handle is looked up — never
   * created — so a typo surfaces as a clean {@link ErrorCode.UnknownAssignee}
   * instead of the raw `FOREIGN KEY constraint failed` the database would
   * throw on an unknown id. (The reporter, by contrast, is the active
   * identity and is always ensured.)
   *
   * @param reference - Handle, UUID, or null
   * @returns The resolved actor id (or null) on success
   */
  private resolveAssignee(reference: string | null): Result<string | null, MnemaError> {
    if (reference === null || reference.length === 0) return Ok(null);
    if (UUID_PATTERN.test(reference)) return Ok(reference);
    const id = this.identity.findActorIdByHandle(reference);
    if (id === null) return Err({ kind: ErrorCode.UnknownAssignee, handle: reference });
    return Ok(id);
  }

  /**
   * Assigns (or clears, when `assignee` is null) a task's owner without a
   * state change. A first-class operation so callers don't have to route
   * an assignment through a workflow transition.
   *
   * @param input - Task key + assignee reference + identity tuple
   * @returns The updated task or a structured error
   */
  assign(input: {
    readonly taskKey: string;
    readonly assignee: string | null;
    readonly actor: string;
    readonly via?: string;
    readonly runId?: string;
  }): Result<Task, MnemaError> {
    const task = this.tasks.findByKey(input.taskKey);
    if (task === null) {
      return Err({ kind: ErrorCode.TaskNotFound, taskKey: input.taskKey });
    }
    const assignee = this.resolveAssignee(input.assignee);
    if (!assignee.ok) return assignee;

    const writeResult = tryMutation(() =>
      this.tasks.updateFields(task.id, { assigneeId: assignee.value }),
    );
    if (!writeResult.ok) return writeResult;
    const updated = writeResult.value;

    this.audit.write({
      kind: 'task_assigned',
      actor: input.actor,
      via: input.via,
      run: input.runId,
      data: { key: updated.key, assignee_id: assignee.value },
    });

    this.sync.syncTask(updated.key);

    return Ok(updated);
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

    // Let a gate validate the task's resulting state, not just the delta:
    // a first-class field already persisted satisfies a `requires` rule
    // without being resent, and leaving it out of the payload never
    // overwrites the stored value. Only task-backed fields are offered as
    // defaults — ephemeral gate fields (e.g. `reason`) are never sourced
    // from the row. An explicit value in the payload still wins.
    const resolution = this.stateMachine.resolveTransition(
      task.state,
      input.action,
      input.payload,
      persistedFieldDefaults(task),
    );

    // An unknown action is never negotiable — there is nothing to enforce.
    if (!resolution.ok) {
      const available = this.stateMachine.listActionsFrom(task.state).map((a) => a.action);
      return Err({
        kind: ErrorCode.InvalidTransition,
        taskKey: task.key,
        fromState: task.state,
        action: input.action,
        available,
      });
    }

    // Apply `enforcement_mode` when required fields are missing. The actor
    // matters: `via` present means an agent drove this, and `strict` holds
    // agents to the gate while letting a human force the transition.
    const isAgent = input.via !== undefined;
    let gateOverride: ErrorIssue[] | null = null;
    if (!resolution.value.gate.ok) {
      const issues = fromZodIssues(resolution.value.gate.issues);
      const blocked =
        this.enforcementMode === EnforcementMode.Blocking ||
        (this.enforcementMode === EnforcementMode.Strict && isAgent);
      if (blocked) {
        this.audit.write({
          kind: 'transition_blocked',
          actor: input.actor,
          via: input.via,
          run: input.runId,
          data: {
            key: task.key,
            action: input.action,
            mode: this.enforcementMode,
            missing: issues.map((i) => i.path.join('.') || '(root)'),
          },
        });
        return Err({
          kind: ErrorCode.GateFailed,
          taskKey: task.key,
          action: input.action,
          issues,
        });
      }
      // Allowed despite the failed gate (advisory, or strict + human).
      // Remember it so the post-commit audit records the override.
      gateOverride = issues;
    }

    const { to, data } = resolution.value;

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
      const spec = resolution.value.requiresSpec;
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

      // Resolve a mutating `assignee_id` here, the same way `create`/`assign`
      // do: an unknown handle fails closed with UNKNOWN_ASSIGNEE instead of
      // the fold quietly minting a ghost actor for it. The resolved id is
      // written back so the fold persists an actor id, never a raw handle.
      if (typeof payload.assignee_id === 'string' && isMutatingField(spec, 'assignee_id')) {
        const resolved = this.resolveAssignee(payload.assignee_id);
        if (!resolved.ok) return resolved;
        payload.assignee_id = resolved.value;
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
        // `assignee_id` was already resolved to an actor id above, so the
        // fold's resolver is the identity — it must not create an actor.
        const persisted = persistableFromPayload(
          (data ?? {}) as Record<string, unknown>,
          resolution.value.requiresSpec,
          (id) => id,
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

    // The gate failed but the mode let it through (advisory, or strict +
    // human). Record the override so a skipped gate still leaves a trail —
    // the whole point of the product is that nothing happens off the record.
    if (gateOverride !== null) {
      this.audit.write({
        kind: 'gate_overridden',
        actor: input.actor,
        via: input.via,
        run: input.runId,
        data: {
          key: task.key,
          action: input.action,
          mode: this.enforcementMode,
          missing: gateOverride.map((i) => i.path.join('.') || '(root)'),
        },
      });
    }

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
 * `assignee_id` is already resolved to an actor id by the caller (which
 * fails closed on an unknown handle), so `resolveActor` here is the
 * identity. It stays a parameter so the column mapping is testable in
 * isolation.
 *
 * Returns `null` when nothing in the payload is persistable, so the
 * caller can skip the UPDATE altogether and avoid a needless
 * `updated_at` bump.
 *
 * @param payload - Validated transition payload (assignee_id pre-resolved)
 * @param resolveActor - Maps the already-resolved assignee value through
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

/**
 * Builds the set of already-persisted, first-class task fields a gate may
 * fall back to when they are absent from a transition payload. Keyed by
 * the snake_case names workflows use in `requires`. Only task-backed
 * fields appear here — ephemeral gate fields (e.g. `reason`) are never
 * sourced from the row, so they must still be supplied explicitly.
 *
 * @param task - Current task row
 * @returns Default values for the gate merge
 */
function persistedFieldDefaults(task: Task): Record<string, unknown> {
  const defaults: Record<string, unknown> = {
    title: task.title,
    acceptance_criteria: [...task.acceptanceCriteria],
  };
  if (task.description !== null) defaults.description = task.description;
  if (task.estimate !== null) defaults.estimate = task.estimate;
  defaults.priority = task.priority;
  if (task.assigneeId !== null) defaults.assignee_id = task.assigneeId;
  return defaults;
}
