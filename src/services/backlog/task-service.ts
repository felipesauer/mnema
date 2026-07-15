import { Err, Ok, type Result } from '../../common/result.js';
import type { Task } from '../../domain/entities/task.js';
import { EnforcementMode } from '../../domain/enums/enforcement-mode.js';
import type { TaskState } from '../../domain/enums/task-state.js';
import { generateTaskKey } from '../../domain/id-generator.js';
import { hasInvocationMarkup } from '../../domain/invocation-markup.js';
import type { StateMachine } from '../../domain/state-machine/state-machine.js';
import type { FieldSpec } from '../../domain/state-machine/workflow-meta-schema.js';
import { checkOptionalIntInRange, checkOptionalNonNegativeInt } from '../../domain/validation.js';
import { ErrorCode } from '../../errors/error-codes.js';
import { type ErrorIssue, fromZodIssues, type MnemaError } from '../../errors/mnema-error.js';
import type { ITaskRepository, TaskFieldUpdates } from '../../ports/task-repository.port.js';
import type { ProjectRepository } from '../../storage/sqlite/repositories/project-repository.js';
import type { TransitionRepository } from '../../storage/sqlite/repositories/transition-repository.js';
import { tryMutation } from '../../storage/sqlite/sqlite-error-map.js';
import type { AuditService } from '../integrity/audit-service.js';
import type { SyncService } from '../sync/sync-service.js';

/** Matches a v4/v7 UUID so an assignee reference can be told apart from a handle. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Assignee references that mean "the caller" — resolved to the default
 * actor's id rather than looked up as a handle. Lets an MCP agent that has
 * no way to learn valid handles still assign work to itself without first
 * running a CLI to register an actor.
 */
const SELF_REFERENCES: ReadonlySet<string> = new Set(['me', 'self']);

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
    private readonly tasks: ITaskRepository,
    private readonly transitions: TransitionRepository,
    private readonly projects: ProjectRepository,
    private readonly stateMachine: StateMachine,
    private readonly audit: AuditService,
    private readonly sync: SyncService,
    private readonly identity: {
      ensureActor: (handle: string, kind: 'human' | 'agent') => string;
      findActorIdByHandle: (handle: string) => string | null;
      getDefaultActor: () => string;
    },
    // How a failed gate is enforced. Defaults to Blocking — the historical
    // behaviour (a failed gate always blocks) — so callers that don't pass
    // it keep working; the container supplies the configured value.
    private readonly enforcementMode: EnforcementMode = EnforcementMode.Blocking,
    // When true, the start action (picking a task up for work) requires the
    // acting actor to hold a live claim on the task. Defaults to false —
    // the historical behaviour (no claim required to start) — so callers
    // that don't pass it, and every single-agent flow, keep working; the
    // container supplies the configured `claims.require_to_start`.
    private readonly requireClaimToStart: boolean = false,
    // Per-gate-field severity (MNEMA-ADR-48), layered on `enforcementMode`.
    // Maps a required gate field name to `off` | `warn` | `block`. Empty
    // (the default) reproduces the pure global behaviour.
    private readonly fieldSeverity: Readonly<Record<string, 'off' | 'warn' | 'block'>> = {},
  ) {}

  /** See {@link consumeLastGateOverride}. */
  private lastGateOverride: ErrorIssue[] | null = null;

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
    checkTitle(input.title, issues);
    checkNoInvocationMarkup(input, issues);
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
      // BEGIN IMMEDIATE: take the write lock before the nextSequence COUNT so
      // two processes on one state.db cannot mint the same key.
      this.tasks.runInTransactionImmediate(() => {
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
   * Resolves an assignee reference (a handle like `maria`, the literal
   * `me`/`self`, or a raw UUID) to an actor id, or `null` when unset.
   *
   * `me`/`self` resolve to the default actor — the one the caller is
   * already acting as — so an MCP agent with no way to learn valid handles
   * can still assign work to itself. A real (non-self) handle is looked up
   * and never created, so a typo surfaces as a clean
   * {@link ErrorCode.UnknownAssignee} instead of the raw
   * `FOREIGN KEY constraint failed` the database would throw on an unknown
   * id. (The reporter, by contrast, is the active identity and is always
   * ensured.)
   *
   * @param reference - Handle, `me`/`self`, UUID, or null
   * @returns The resolved actor id (or null) on success
   */
  private resolveAssignee(reference: string | null): Result<string | null, MnemaError> {
    if (reference === null || reference.length === 0) return Ok(null);
    if (SELF_REFERENCES.has(reference.toLowerCase())) {
      const handle = this.identity.getDefaultActor();
      return Ok(this.identity.ensureActor(handle, 'human'));
    }
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
   * Edits a task's content (title / description / acceptance criteria)
   * after creation, without a state change. Fills the gap the DRAFT →
   * READY submit gate leaves: once a task is past DRAFT there was no way
   * to correct its content.
   *
   * Refuses when the task sits in a terminal state — a completed or
   * canceled task's content is part of the record and must not drift.
   * Reuses the same optimistic-concurrency token as {@link transition}:
   * `expectedUpdatedAt` defaults to the row we just read, so a concurrent
   * edit surfaces a CONFLICT instead of a silent lost write.
   *
   * @param input - Task key + content fields + identity tuple
   * @returns The updated task or a structured error
   */
  updateContent(input: {
    readonly taskKey: string;
    readonly title?: string;
    readonly description?: string | null;
    readonly acceptanceCriteria?: readonly string[];
    readonly actor: string;
    readonly via?: string;
    readonly runId?: string;
    readonly expectedUpdatedAt?: string;
  }): Result<Task, MnemaError> {
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

    const issues: ErrorIssue[] = [];
    if (input.title !== undefined) checkTitle(input.title, issues);
    checkNoInvocationMarkup(input, issues);
    if (issues.length > 0) {
      return Err({ kind: ErrorCode.ValidationFailed, issues });
    }

    const expectedUpdatedAt =
      input.expectedUpdatedAt !== undefined ? input.expectedUpdatedAt : task.updatedAt;

    type UpdateOutcome =
      | { readonly kind: 'ok'; readonly task: Task }
      | { readonly kind: 'conflict'; readonly currentUpdatedAt: string };

    const outcomeResult = tryMutation(() =>
      this.tasks.runInTransaction((): UpdateOutcome => {
        const current = this.tasks.findById(task.id);
        if (current === null || current.updatedAt !== expectedUpdatedAt) {
          return {
            kind: 'conflict',
            currentUpdatedAt: current?.updatedAt ?? task.updatedAt,
          };
        }
        const updated = this.tasks.updateFields(task.id, {
          title: input.title,
          description: input.description,
          acceptanceCriteria: input.acceptanceCriteria,
        });
        return { kind: 'ok', task: updated };
      }),
    );
    if (!outcomeResult.ok) return outcomeResult;
    const outcome = outcomeResult.value;

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
      kind: 'task_content_updated',
      actor: input.actor,
      via: input.via,
      run: input.runId,
      data: { key: updated.key, state: updated.state },
    });

    this.sync.syncTask(updated.key);

    return Ok(updated);
  }

  /**
   * Claims a task for an actor with a lease that expires on its own —
   * closes the window between two sessions reading the same READY task
   * and each deciding to work on it, which optimistic concurrency on
   * `transition` only catches AFTER one of them has already written.
   *
   * Not a workflow action: claiming does not change `state`, so it is a
   * first-class operation (mirroring {@link assign}) rather than a
   * transition. This method only manages the lease itself; whether the
   * `start` action then requires a live claim by the acting actor is
   * governed by the `claims.require_to_start` flag (default off), enforced
   * in {@link transition}.
   *
   * @param input - Task key, claiming actor, lease length in minutes
   * @returns The claimed task, or {@link ErrorCode.TaskAlreadyClaimed} when
   *   another actor already holds a live lease
   */
  claim(input: {
    readonly taskKey: string;
    readonly actor: string;
    readonly via?: string;
    readonly runId?: string;
    readonly leaseMinutes: number;
  }): Result<Task, MnemaError> {
    const task = this.tasks.findByKey(input.taskKey);
    if (task === null) {
      return Err({ kind: ErrorCode.TaskNotFound, taskKey: input.taskKey });
    }

    const claimingActorId =
      input.via !== undefined
        ? this.identity.ensureActor(input.via, 'agent')
        : this.identity.ensureActor(input.actor, 'human');

    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + input.leaseMinutes * 60_000).toISOString();

    const claimResult = tryMutation(() =>
      this.tasks.claim(task.id, claimingActorId, leaseExpiresAt, now.toISOString()),
    );
    if (!claimResult.ok) return claimResult;
    const outcome = claimResult.value;

    if (!outcome.ok) {
      if (outcome.reason.kind === 'NOT_FOUND') {
        return Err({ kind: ErrorCode.TaskNotFound, taskKey: input.taskKey });
      }
      return Err({
        kind: ErrorCode.TaskAlreadyClaimed,
        taskKey: task.key,
        claimedBy: outcome.reason.claimedBy,
        leaseExpiresAt: outcome.reason.leaseExpiresAt,
      });
    }
    const updated = outcome.task;

    this.audit.write({
      kind: 'task_claimed',
      actor: input.actor,
      via: input.via,
      run: input.runId,
      data: { key: updated.key, claimed_by: claimingActorId, lease_expires_at: leaseExpiresAt },
    });

    return Ok(updated);
  }

  /**
   * Releases a task's claim. Only the actor currently holding the lease
   * can release it — a no-op (not an error) when the task is unclaimed or
   * held by someone else, so a defensive "release on exit" call from a
   * session that never held the lease (or whose lease already expired and
   * was reclaimed) cannot clear another session's live claim.
   *
   * @param input - Task key + releasing actor
   * @returns The task (claim cleared or left untouched) or a structured error
   */
  releaseClaim(input: {
    readonly taskKey: string;
    readonly actor: string;
    readonly via?: string;
    readonly runId?: string;
  }): Result<Task, MnemaError> {
    const task = this.tasks.findByKey(input.taskKey);
    if (task === null) {
      return Err({ kind: ErrorCode.TaskNotFound, taskKey: input.taskKey });
    }

    const releasingActorId =
      input.via !== undefined
        ? this.identity.ensureActor(input.via, 'agent')
        : this.identity.ensureActor(input.actor, 'human');

    const released = tryMutation(() => this.tasks.releaseClaim(task.id, releasingActorId));
    if (!released.ok) return released;

    if (released.value) {
      this.audit.write({
        kind: 'task_claim_released',
        actor: input.actor,
        via: input.via,
        run: input.runId,
        data: { key: task.key },
      });
    }

    const reloaded = this.tasks.findByKey(input.taskKey);
    if (reloaded === null) {
      return Err({ kind: ErrorCode.TaskNotFound, taskKey: input.taskKey });
    }
    return Ok(reloaded);
  }

  /**
   * Moves a task to a new state by executing a workflow action.
   *
   * Validates against the active workflow's gates and persists every
   * change (state mutation + transition log) atomically.
   *
   * DONE-gate (PR/CI policy) is intentionally NOT enforced here — it is an
   * MCP-layer concern by design. The gate depends on a live GitHub PR-status
   * client and `config.github.done_pr_policy`, neither of which the service
   * owns, and the MCP transition handler already runs it *before* calling this
   * method (see `transition-tools.ts`). Duplicating it here would double-apply
   * on the MCP path (the check would fire twice) and pull a GitHub dependency
   * into the service. The CLI move path does not carry a PR context, so it has
   * nothing to gate on; keeping the policy at the MCP boundary keeps this method
   * transport-agnostic.
   *
   * @param input - Action, payload, and identity context
   * @returns The updated task or a structured error
   */
  /**
   * Whether calling `action` on the task with `taskKey` would be an
   * idempotent no-op — the action targets the state the task is already in,
   * the action is not otherwise valid from that state (so it is a retry, not
   * a real re-entry), AND the caller is the actor who last moved the task
   * there (so a late different actor is not mistaken for a retry). Mirrors
   * the guard in {@link transition} so the surface annotation matches actual
   * behaviour. Surfaces use it to add an "already there" indicator. Returns
   * false for an unknown task.
   */
  wouldBeNoOp(taskKey: string, action: string, actor: string, via?: string): boolean {
    const task = this.tasks.findByKey(taskKey);
    if (task === null) return false;
    // A genuinely valid action from here is not a no-op even if it loops back
    // to the same state — only a retry (invalid-from-here + targets current).
    const validHere = this.stateMachine
      .listActionsFrom(task.state)
      .some((a) => a.action === action);
    if (validHere) return false;
    if (!this.stateMachine.actionTargets(action).has(task.state)) return false;
    return this.lastMoverMatches(task.id, { actor, via });
  }

  /**
   * Whether the last transition on this task was recorded by the same
   * MOVER now retrying — the "same actor" half of the idempotency guard. A
   * genuine retry re-issues its own prior move; a different mover arriving
   * after the state already changed is a lost-write attempt, not a retry.
   *
   * The mover identity is the DRIVING AGENT (`via`) whenever there is one.
   * mnema's real deployment is one shared human identity with many agent
   * sessions distinguished only by `via`, so matching on the human `actor`
   * would treat EVERY prior move by that human as a retry — agent B stalely
   * re-issuing a move agent A already made would be silently swallowed
   * (lost write). So: with a `via`, require the last move to be from the SAME
   * `via`. Only a call with no `via` (pure-human CLI, where the human is the
   * mover) matches on `actor`. No prior transition is treated as "not a
   * match" — fail closed toward the error rather than a spurious no-op.
   */
  private lastMoverMatches(
    taskId: string,
    input: { readonly actor: string; readonly via?: string },
  ): boolean {
    const history = this.transitions.findByTask(taskId);
    const last = history[history.length - 1];
    if (last === undefined) return false;
    const viaId = input.via !== undefined ? this.identity.findActorIdByHandle(input.via) : null;
    if (viaId !== null) {
      // Agent-driven: the retry must come from the same agent session.
      return last.viaActorId === viaId;
    }
    // Pure-human (no via): the human actor is the mover. Match only a prior
    // move that was ALSO human-only (no via) by the same actor — an agent's
    // prior move is not a human's retry.
    const actorId = this.identity.findActorIdByHandle(input.actor);
    return actorId !== null && last.actorId === actorId && last.viaActorId === null;
  }

  transition(input: TransitionInput): Result<Task, MnemaError> {
    // A previous call's override must never leak into this one.
    this.lastGateOverride = null;
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
      // Idempotent-by-intent: a dropped AI session retries. If the action
      // the caller asked for targets the state the task is ALREADY in, the
      // earlier attempt succeeded and this is a retry — return the task as a
      // no-op success rather than INVALID_TRANSITION, so the agent does not
      // burn context handling a non-error. No write, no gate, no audit event.
      //
      // But "already in the target state" is ALSO what a stale concurrent
      // writer sees after SOMEONE ELSE moved the row (the lost-write race).
      // Two guards keep the no-op from masking that:
      //   1. A stale optimistic-concurrency token (an OLD updatedAt) means a
      //      concurrent writer — never a no-op.
      //   2. The retry must come from the actor who LAST moved the task into
      //      its current state. A genuine retry re-issues its own prior move;
      //      a different actor arriving late (bob after alice) is a lost-write
      //      attempt, not a retry, and must still be refused. This is the
      //      "same actor" condition the idempotency contract calls for.
      const carriesStaleToken =
        input.expectedUpdatedAt !== undefined &&
        input.expectedUpdatedAt.length > 0 &&
        input.expectedUpdatedAt !== task.updatedAt;
      if (
        !carriesStaleToken &&
        this.stateMachine.actionTargets(input.action).has(task.state) &&
        this.lastMoverMatches(task.id, input)
      ) {
        return Ok(task);
      }
      const available = this.stateMachine.listActionsFrom(task.state).map((a) => a.action);
      return Err({
        kind: ErrorCode.InvalidTransition,
        taskKey: task.key,
        fromState: task.state,
        action: input.action,
        available,
      });
    }

    // Apply enforcement when required fields are missing. Two layers
    // (MNEMA-ADR-48): the global `enforcement_mode` decides the default for
    // the acting actor (`via` present ⇒ an agent drove this; `strict` holds
    // agents but lets a human force it), and an optional per-field severity
    // overrides that PER failing field. A transition blocks iff at least one
    // failing field resolves to `block`; fields that resolve to `warn`/`off`
    // let the transition proceed (recorded as an advisory override).
    const isAgent = input.via !== undefined;
    let gateOverride: ErrorIssue[] | null = null;
    if (!resolution.value.gate.ok) {
      const issues = fromZodIssues(resolution.value.gate.issues);
      const globalBlocks =
        this.enforcementMode === EnforcementMode.Blocking ||
        (this.enforcementMode === EnforcementMode.Strict && isAgent);

      // Resolve each failing field to an effective severity. `off` drops the
      // issue entirely; an explicit `warn`/`block` overrides the global mode;
      // absent falls back to the global block decision.
      const blocking: ErrorIssue[] = [];
      const warned: ErrorIssue[] = [];
      for (const issue of issues) {
        const field = issue.path[0];
        const severity = typeof field === 'string' ? this.fieldSeverity[field] : undefined;
        if (severity === 'off') continue;
        if (severity === 'block') blocking.push(issue);
        else if (severity === 'warn') warned.push(issue);
        else if (globalBlocks) blocking.push(issue);
        else warned.push(issue);
      }

      if (blocking.length > 0) {
        this.audit.write({
          kind: 'transition_blocked',
          actor: input.actor,
          via: input.via,
          run: input.runId,
          data: {
            key: task.key,
            action: input.action,
            mode: this.enforcementMode,
            missing: blocking.map((i) => i.path.join('.') || '(root)'),
          },
        });
        return Err({
          kind: ErrorCode.GateFailed,
          taskKey: task.key,
          action: input.action,
          issues: blocking,
        });
      }
      // Nothing blocked: the transition proceeds. Remember any warned issues
      // so the post-commit audit records the override (advisory, or a
      // per-field warn/off, or strict + human).
      if (warned.length > 0) gateOverride = warned;
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
      // Free-text fields that fold onto columns (e.g. submit's title /
      // description / acceptance_criteria) get the same markup screen as
      // create()/update(), so a garbled tool call cannot spill invocation
      // markup into a task via a transition payload either.
      checkNoInvocationMarkup(
        {
          title: typeof payload.title === 'string' ? payload.title : undefined,
          description: typeof payload.description === 'string' ? payload.description : undefined,
          acceptanceCriteria: Array.isArray(payload.acceptance_criteria)
            ? (payload.acceptance_criteria.filter((v) => typeof v === 'string') as string[])
            : undefined,
        },
        foldIssues,
      );
      // Annotation-only free-text (completion_note, approval_note, feedback,
      // reason, note) never folds onto a column, so it escapes the check
      // above — yet it lands verbatim in transitions.payload/audit, the exact
      // spill this screen prevents. Screen it here too.
      for (const field of ANNOTATION_TEXT_FIELDS) {
        const value = payload[field];
        if (typeof value === 'string' && hasInvocationMarkup(value)) {
          foldIssues.push({
            path: [field],
            message: 'contains tool-invocation markup; pass each field as its own argument',
          });
        }
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
    // The actor a claim is attributed to mirrors `claim`: the agent when a
    // `via` handle drove this, otherwise the human. The start-time claim
    // gate must compare against the SAME identity that would have claimed.
    const claimActorId = viaActorId !== null ? viaActorId : actorId;

    // The start-time claim gate (`claims.require_to_start`) applies only to
    // the workflow's pickable-entry transition — the `start` action — never
    // to re-entries like `unblock`/`request_changes` that also land in the
    // in-progress state. Resolved from the workflow so no state is assumed.
    const startAction = this.stateMachine.startAction();
    const gateClaimOnStart =
      this.requireClaimToStart && startAction !== null && input.action === startAction;
    const enteringTerminal = this.stateMachine.isTerminal(to);

    type TransitionOutcome =
      | { readonly kind: 'ok'; readonly task: Task }
      | { readonly kind: 'not_found' }
      | { readonly kind: 'conflict'; readonly currentUpdatedAt: string }
      | { readonly kind: 'not_claimed'; readonly claimedBy: string | null };

    // Default the optimistic-concurrency token to whatever we just
    // read so concurrent transitions can't lose-write each other.
    // Callers that need to write blind can opt in by passing an
    // explicit empty string (treated as "no token") — there is no
    // CLI surface for that today, and the default is fail-closed.
    const expectedUpdatedAt =
      input.expectedUpdatedAt !== undefined ? input.expectedUpdatedAt : task.updatedAt;

    const outcomeResult = tryMutation(() =>
      this.tasks.runInTransaction((): TransitionOutcome => {
        // Start-time claim gate. Read the claim fresh inside the transaction
        // so it is consistent with the state write that follows: the acting
        // actor must hold a live, non-expired lease. A foreign live lease or
        // no lease at all refuses the start; an expired lease counts as
        // unclaimed. Off by default — this whole block is skipped unless the
        // flag is on AND this is the start action.
        if (gateClaimOnStart) {
          const claim = this.tasks.findClaim(task.id);
          if (claim === null) {
            return { kind: 'not_found' };
          }
          const held =
            claim.claimedBy !== null &&
            claim.leaseExpiresAt !== null &&
            Date.parse(claim.leaseExpiresAt) > Date.now();
          if (!held || claim.claimedBy !== claimActorId) {
            // Name a foreign live holder; a stale/expired or absent claim
            // reports null so the caller knows it just needs to claim.
            return { kind: 'not_claimed', claimedBy: held ? claim.claimedBy : null };
          }
        }

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

        // The `reopen` action bumps the counter only when work is genuinely
        // re-entered from a TERMINAL state (the from-state) — the signal
        // consumers use to flag chronically reopened items. A custom workflow
        // could wire `reopen` between two non-terminal states; counting that
        // would inflate the metric, so gate the bump on the from-state being
        // terminal rather than on the action name alone.
        if (input.action === 'reopen' && this.stateMachine.isTerminal(task.state)) {
          const bumped = this.tasks.incrementReopenCount(task.id);
          if (bumped !== null) finalTask = bumped;
        }

        // Reaching a terminal state retires any dangling claim, in the
        // same transaction as the state change. Unlike a release, this
        // does not require the actor to hold the lease — a completed or
        // canceled task must never carry a stale claimed_by. Reload so the
        // returned task reflects the cleared lease.
        if (enteringTerminal && this.tasks.clearClaim(task.id)) {
          const reloaded = this.tasks.findById(task.id);
          if (reloaded !== null) finalTask = reloaded;
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
    if (outcome.kind === 'not_claimed') {
      return Err({
        kind: ErrorCode.TaskNotClaimed,
        taskKey: task.key,
        claimedBy: outcome.claimedBy,
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
      // Expose the override to the caller (consume-once) so an interactive
      // surface can WARN the human at the moment it happens — the audit row
      // alone is invisible until someone reads the history.
      this.lastGateOverride = gateOverride;
    }

    this.sync.syncTask(task.key);

    return Ok(updated);
  }

  /**
   * The gate override recorded by the MOST RECENT successful {@link transition}
   * on this instance, or `null` when the last transition passed its gate
   * cleanly. Reading it clears it (consume-once), so a caller can surface a
   * "gate overridden — proceeding without <fields>" warning exactly once.
   * Instance-scoped and serial by construction (one container per CLI process
   * / MCP call chain), not a concurrency-safe channel.
   */
  consumeLastGateOverride(): ErrorIssue[] | null {
    const override = this.lastGateOverride;
    this.lastGateOverride = null;
    return override;
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
 * Pushes an issue when a title is outside the 3..200 length the create
 * path enforces (via the MCP schema). Gives content edits the same
 * contract at the service boundary so the CLI and MCP producers reject
 * identically.
 */
function checkTitle(title: string, issues: ErrorIssue[]): void {
  if (title.length < 3) {
    issues.push({ path: ['title'], message: 'must be at least 3 characters' });
  } else if (title.length > 200) {
    issues.push({ path: ['title'], message: 'must be at most 200 characters' });
  }
}

/**
 * Rejects tool-invocation markup in a task's free-text fields. A garbled
 * MCP call can spill `<invoke>` / `<parameter name=…>` / a `</field>` envelope
 * into a value; persisting it leaves a garbage trailer and empty siblings.
 * decision/observation/memory already screen their content this way — this
 * gives task fields the same contract at the service boundary, so the CLI
 * and MCP producers reject identically. Each acceptance-criterion line is
 * screened under an indexed path so the offender is pinpointed.
 */
/**
 * Annotation-only gate fields that are free text: they live in
 * `transitions.payload`/audit and never fold onto a task column, so the
 * column-shaped {@link checkNoInvocationMarkup} does not see them. The
 * transition guard screens them separately.
 */
const ANNOTATION_TEXT_FIELDS = [
  'completion_note',
  'approval_note',
  'feedback',
  'reason',
  'note',
] as const;

function checkNoInvocationMarkup(
  fields: {
    readonly title?: string;
    readonly description?: string | null;
    readonly acceptanceCriteria?: readonly string[];
  },
  issues: ErrorIssue[],
): void {
  const scalar: [string, string | null | undefined][] = [
    ['title', fields.title],
    ['description', fields.description],
  ];
  for (const [field, value] of scalar) {
    if (typeof value === 'string' && hasInvocationMarkup(value)) {
      issues.push({
        path: [field],
        message: 'contains tool-invocation markup; pass each field as its own argument',
      });
    }
  }
  const criteria = fields.acceptanceCriteria ?? [];
  criteria.forEach((line, i) => {
    if (hasInvocationMarkup(line)) {
      issues.push({
        path: ['acceptance_criteria', String(i)],
        message: 'contains tool-invocation markup; pass each field as its own argument',
      });
    }
  });
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
