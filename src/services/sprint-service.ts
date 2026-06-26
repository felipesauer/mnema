import type { Sprint } from '../domain/entities/sprint.js';
import type { SprintMetric } from '../domain/entities/sprint-metric.js';
import type { Task } from '../domain/entities/task.js';
import { SprintState } from '../domain/enums/sprint-state.js';
import type { StateMachine } from '../domain/state-machine/state-machine.js';
import { checkOptionalFiniteNumber, checkRequiredFiniteNumber } from '../domain/validation.js';
import { ErrorCode } from '../errors/error-codes.js';
import type { ErrorIssue, MnemaError } from '../errors/mnema-error.js';
import type { ProjectRepository } from '../storage/sqlite/repositories/project-repository.js';
import type { SprintMetricRepository } from '../storage/sqlite/repositories/sprint-metric-repository.js';
import type { SprintRepository } from '../storage/sqlite/repositories/sprint-repository.js';
import type { TaskRepository } from '../storage/sqlite/repositories/task-repository.js';
import { tryMutation } from '../storage/sqlite/sqlite-error-map.js';
import { isIso8601 } from '../utils/iso-date.js';
import type { AuditService } from './audit-service.js';
import { Err, Ok, type Result } from './result.js';
import type { RoadmapMirror } from './roadmap-mirror.js';
import type { SyncService } from './sync-service.js';

/**
 * Upper bound for sprint capacity in story points; lifted from
 * DESIGN.md §6.4 (no real team plans above 1k). The lower bound is 1
 * — zero capacity is a CLOSED sprint, not a planned one.
 */
const MAX_SPRINT_CAPACITY = 1000;

/**
 * Input for {@link SprintService.plan}.
 */
export interface PlanSprintInput {
  readonly projectKey: string;
  readonly name: string;
  readonly goal?: string;
  readonly startsAt?: string;
  readonly endsAt?: string;
  readonly capacity?: number;
  readonly actor: string;
  readonly via?: string;
  readonly runId?: string;
}

/**
 * Input for {@link SprintService.start} and {@link SprintService.close}.
 */
export interface SprintTransitionInput {
  readonly sprintKey: string;
  readonly actor: string;
  readonly via?: string;
  readonly runId?: string;
  /**
   * Optional optimistic-concurrency token. When supplied, the
   * transition only proceeds if the sprint's current `updatedAt`
   * matches; otherwise a `Conflict` error is returned with the
   * latest server-side timestamp.
   */
  readonly expectedUpdatedAt?: string;
}

/**
 * Input for {@link SprintService.addTask} / {@link SprintService.removeTask}.
 */
export interface SprintTaskInput {
  readonly sprintKey: string;
  readonly taskKey: string;
  readonly actor: string;
  readonly via?: string;
  readonly runId?: string;
}

/**
 * Snapshot view of a sprint plus its tasks.
 */
export interface SprintView {
  readonly sprint: Sprint;
  readonly tasks: readonly Task[];
  readonly metrics: readonly SprintMetric[];
}

/**
 * Input for {@link SprintService.addMetric}.
 */
export interface AddSprintMetricInput {
  readonly sprintKey: string;
  readonly name: string;
  readonly baseline?: number | null;
  readonly target: number;
  readonly unit?: string | null;
  readonly dueDate?: string | null;
  readonly actor: string;
  readonly via?: string;
  readonly runId?: string;
}

/**
 * Orchestrates sprint lifecycle and task assignment.
 *
 * State transitions are linear: PLANNED → ACTIVE → CLOSED. Reopen of a
 * closed sprint is intentionally out of scope. The "one ACTIVE sprint
 * per project" invariant is enforced both here and at the SQL layer
 * via a unique partial index.
 */
export class SprintService {
  constructor(
    private readonly sprints: SprintRepository,
    private readonly tasks: TaskRepository,
    private readonly projects: ProjectRepository,
    private readonly audit: AuditService,
    private readonly stateMachine: StateMachine,
    private readonly metrics: SprintMetricRepository,
    // Optional so unit tests can drive the service without a filesystem.
    // `mirror` versions the sprint; `sync` rewrites a task's markdown when
    // its sprint link changes.
    private readonly mirror: RoadmapMirror | null = null,
    private readonly sync: SyncService | null = null,
  ) {}

  /**
   * Plans a new sprint in `PLANNED` state.
   *
   * @param input - Sprint metadata + identity tuple
   * @returns The created sprint or a structured error
   */
  plan(input: PlanSprintInput): Result<Sprint, MnemaError> {
    // Workflows like `kanban` declare `features.sprints: false` to
    // signal that sprint semantics do not apply; planning one would
    // create a queryable row that no transition references. Refuse
    // with a structured error and direct the user to a sprint-aware
    // workflow.
    const workflow = this.stateMachine.getWorkflow();
    if (!workflow.features.sprints) {
      return Err({
        kind: ErrorCode.FeatureNotAvailable,
        feature: 'sprints',
        workflow: workflow.name,
      });
    }

    const issues = validatePlanInput(input);
    if (issues.length > 0) {
      return Err({ kind: ErrorCode.SprintInvalidPayload, issues });
    }

    const project = this.projects.findByKey(input.projectKey);
    if (project === null) {
      return Err({ kind: ErrorCode.ProjectNotFound, projectKey: input.projectKey });
    }

    const sequence = this.sprints.nextSequence(project.id);
    const key = `${project.key}-SPRINT-${sequence}`;

    const sprintResult = tryMutation(() =>
      this.sprints.insert({
        key,
        projectId: project.id,
        name: input.name,
        goal: input.goal ?? null,
        startsAt: input.startsAt ?? null,
        endsAt: input.endsAt ?? null,
        capacity: input.capacity ?? null,
      }),
    );
    if (!sprintResult.ok) return sprintResult;
    const sprint = sprintResult.value;

    this.audit.write({
      kind: 'sprint_planned',
      actor: input.actor,
      via: input.via,
      run: input.runId,
      data: { key: sprint.key, name: sprint.name, goal: sprint.goal },
    });

    this.mirror?.writeSprint(sprint);

    return Ok(sprint);
  }

  /**
   * Activates a `PLANNED` sprint. Fails if another sprint of the same
   * project is already active.
   *
   * @param input - Sprint identifier + identity tuple
   * @returns The updated sprint or a structured error
   */
  start(input: SprintTransitionInput): Result<Sprint, MnemaError> {
    const sprint = this.sprints.findByKey(input.sprintKey);
    if (sprint === null) {
      return Err({ kind: ErrorCode.SprintNotFound, sprintKey: input.sprintKey });
    }
    if (sprint.state !== SprintState.Planned) {
      return Err({
        kind: ErrorCode.SprintInvalidState,
        sprintKey: sprint.key,
        fromState: sprint.state,
        toState: SprintState.Active,
      });
    }
    const active = this.sprints.findActive(sprint.projectId);
    if (active !== null) {
      const projectKey = sprint.key.split('-SPRINT-')[0] ?? sprint.projectId;
      return Err({
        kind: ErrorCode.ActiveSprintExists,
        projectKey,
        activeSprintKey: active.key,
      });
    }

    // Default token to the row we just read; closes the lost-write
    // window when callers don't pass --expected-updated-at.
    const expectedUpdatedAt =
      input.expectedUpdatedAt !== undefined ? input.expectedUpdatedAt : sprint.updatedAt;

    // The `findActive` check above closes the common case, but two
    // concurrent CLI invocations can race past it before either UPDATE
    // fires. The partial unique index `idx_sprints_active` then
    // refuses the second update with `SQLITE_CONSTRAINT_UNIQUE`. Wrap
    // the call so the loser gets the same `ACTIVE_SPRINT_EXISTS` it
    // would have got from `findActive`.
    const wrapped = tryMutation(() =>
      this.sprints.updateState(sprint.id, SprintState.Active, expectedUpdatedAt),
    );
    if (!wrapped.ok) {
      if (wrapped.error.kind === ErrorCode.ActiveSprintExists) {
        // The race winner's key was not in the SqliteError message; look it up.
        const winner = this.sprints.findActive(sprint.projectId);
        const projectKey = sprint.key.split('-SPRINT-')[0] ?? sprint.projectId;
        return Err({
          kind: ErrorCode.ActiveSprintExists,
          projectKey,
          activeSprintKey: winner?.key ?? '(unknown)',
        });
      }
      return Err(wrapped.error);
    }
    const result = wrapped.value;
    if (!result.ok) {
      if (result.reason.kind === 'NOT_FOUND') {
        return Err({ kind: ErrorCode.SprintNotFound, sprintKey: input.sprintKey });
      }
      return Err({
        kind: ErrorCode.Conflict,
        entity: 'sprint',
        taskKey: sprint.key,
        currentUpdatedAt: result.reason.currentUpdatedAt,
      });
    }
    const updated = result.sprint;

    this.audit.write({
      kind: 'sprint_started',
      actor: input.actor,
      via: input.via,
      run: input.runId,
      data: { key: updated.key },
    });

    this.mirror?.writeSprint(updated);

    return Ok(updated);
  }

  /**
   * Closes an `ACTIVE` sprint.
   *
   * @param input - Sprint identifier + identity tuple
   * @returns The updated sprint or a structured error
   */
  close(input: SprintTransitionInput): Result<Sprint, MnemaError> {
    const sprint = this.sprints.findByKey(input.sprintKey);
    if (sprint === null) {
      return Err({ kind: ErrorCode.SprintNotFound, sprintKey: input.sprintKey });
    }
    if (sprint.state !== SprintState.Active) {
      return Err({
        kind: ErrorCode.SprintInvalidState,
        sprintKey: sprint.key,
        fromState: sprint.state,
        toState: SprintState.Closed,
      });
    }

    // Default token to the row we just read so two concurrent
    // `sprint close` calls don't both audit "closed" against an
    // already-closed sprint.
    const expectedUpdatedAt =
      input.expectedUpdatedAt !== undefined ? input.expectedUpdatedAt : sprint.updatedAt;

    const result = this.sprints.updateState(sprint.id, SprintState.Closed, expectedUpdatedAt);
    if (!result.ok) {
      if (result.reason.kind === 'NOT_FOUND') {
        return Err({ kind: ErrorCode.SprintNotFound, sprintKey: input.sprintKey });
      }
      return Err({
        kind: ErrorCode.Conflict,
        entity: 'sprint',
        taskKey: sprint.key,
        currentUpdatedAt: result.reason.currentUpdatedAt,
      });
    }
    const updated = result.sprint;

    this.audit.write({
      kind: 'sprint_closed',
      actor: input.actor,
      via: input.via,
      run: input.runId,
      data: { key: updated.key },
    });

    this.mirror?.writeSprint(updated);

    return Ok(updated);
  }

  /**
   * Assigns a task to a sprint.
   *
   * @param input - Sprint key + task key + identity tuple
   * @returns The updated task or a structured error
   */
  addTask(input: SprintTaskInput): Result<Task, MnemaError> {
    const sprint = this.sprints.findByKey(input.sprintKey);
    if (sprint === null) {
      return Err({ kind: ErrorCode.SprintNotFound, sprintKey: input.sprintKey });
    }
    const task = this.tasks.findByKey(input.taskKey);
    if (task === null) {
      return Err({ kind: ErrorCode.TaskNotFound, taskKey: input.taskKey });
    }

    this.sprints.addTask(sprint.id, task.id);

    this.audit.write({
      kind: 'sprint_task_added',
      actor: input.actor,
      via: input.via,
      run: input.runId,
      data: { sprint_key: sprint.key, task_key: task.key },
    });

    // The sprint link lives in the task's markdown, so rewrite it.
    this.sync?.syncTask(task.key, { action: 'sprint_task_added', runId: input.runId });

    const updated = this.tasks.findByKey(input.taskKey);
    if (updated === null) {
      return Err({ kind: ErrorCode.TaskNotFound, taskKey: input.taskKey });
    }
    return Ok(updated);
  }

  /**
   * Removes a task from its current sprint (no-op if it has none).
   *
   * @param input - Task key + identity tuple
   * @returns The updated task or a structured error
   */
  removeTask(input: SprintTaskInput): Result<Task, MnemaError> {
    const task = this.tasks.findByKey(input.taskKey);
    if (task === null) {
      return Err({ kind: ErrorCode.TaskNotFound, taskKey: input.taskKey });
    }

    this.sprints.removeTask(task.id);

    this.audit.write({
      kind: 'sprint_task_removed',
      actor: input.actor,
      via: input.via,
      run: input.runId,
      data: { sprint_key: input.sprintKey, task_key: task.key },
    });

    // The sprint link lives in the task's markdown, so rewrite it.
    this.sync?.syncTask(task.key, { action: 'sprint_task_removed', runId: input.runId });

    const updated = this.tasks.findByKey(input.taskKey);
    if (updated === null) {
      return Err({ kind: ErrorCode.TaskNotFound, taskKey: input.taskKey });
    }
    return Ok(updated);
  }

  /**
   * Returns a sprint plus its current task list.
   *
   * @param sprintKey - Sprint identifier
   * @returns The sprint view or `null` if the sprint is unknown
   */
  show(sprintKey: string): SprintView | null {
    const sprint = this.sprints.findByKey(sprintKey);
    if (sprint === null) return null;
    return {
      sprint,
      tasks: this.sprints.listTasks(sprint.id),
      metrics: this.metrics.findBySprint(sprint.id),
    };
  }

  /**
   * Adds a measurable metric to a sprint. CLI-only mutation, in line
   * with the rest of the sprint lifecycle (MNEMA-ADR-25).
   *
   * @param input - Sprint key + metric fields + identity tuple
   * @returns The created metric or a structured error
   */
  addMetric(input: AddSprintMetricInput): Result<SprintMetric, MnemaError> {
    const sprint = this.sprints.findByKey(input.sprintKey);
    if (sprint === null) {
      return Err({ kind: ErrorCode.SprintNotFound, sprintKey: input.sprintKey });
    }
    const issues: ErrorIssue[] = [];
    checkRequiredFiniteNumber(input.target, 'target', issues);
    checkOptionalFiniteNumber(input.baseline ?? null, 'baseline', issues);
    if (issues.length > 0) {
      return Err({ kind: ErrorCode.ValidationFailed, issues });
    }
    if (this.metrics.exists(sprint.id, input.name)) {
      return Err({
        kind: ErrorCode.SprintMetricDuplicate,
        sprintKey: input.sprintKey,
        name: input.name,
      });
    }
    // Wrap the insert: a concurrent writer can pass the exists() check above
    // and lose the UNIQUE(sprint_id, name) race — map that to the structured
    // duplicate rather than letting a raw SqliteError escape.
    const createdResult = tryMutation(() =>
      this.metrics.insert({
        sprintId: sprint.id,
        name: input.name,
        baseline: input.baseline ?? null,
        target: input.target,
        unit: input.unit ?? null,
        dueDate: input.dueDate ?? null,
      }),
    );
    if (!createdResult.ok) {
      if (createdResult.error.kind === ErrorCode.SprintMetricDuplicate) {
        return Err({
          kind: ErrorCode.SprintMetricDuplicate,
          sprintKey: input.sprintKey,
          name: input.name,
        });
      }
      return createdResult;
    }
    const created = createdResult.value;
    this.audit.write({
      kind: 'sprint_metric_added',
      actor: input.actor,
      via: input.via,
      run: input.runId,
      data: { sprint_key: sprint.key, name: input.name, target: input.target },
    });
    return Ok(created);
  }

  /**
   * Lists a sprint's metrics.
   *
   * @param sprintKey - Sprint identifier
   * @returns Metrics or a structured error when the sprint is unknown
   */
  metricsFor(sprintKey: string): Result<SprintMetric[], MnemaError> {
    const sprint = this.sprints.findByKey(sprintKey);
    if (sprint === null) {
      return Err({ kind: ErrorCode.SprintNotFound, sprintKey });
    }
    return Ok(this.metrics.findBySprint(sprint.id));
  }

  /**
   * Returns the active sprint for the current project, or `null`.
   *
   * @param projectKey - Project key
   * @returns Active sprint view or `null`
   */
  active(projectKey: string): SprintView | null {
    const project = this.projects.findByKey(projectKey);
    if (project === null) return null;
    const sprint = this.sprints.findActive(project.id);
    if (sprint === null) return null;
    return {
      sprint,
      tasks: this.sprints.listTasks(sprint.id),
      metrics: this.metrics.findBySprint(sprint.id),
    };
  }

  /**
   * Lists every sprint of a project.
   *
   * @param projectKey - Project key
   * @returns Sprints ordered by creation
   */
  list(projectKey: string): readonly Sprint[] {
    const project = this.projects.findByKey(projectKey);
    if (project === null) return [];
    return this.sprints.findByProject(project.id);
  }
}

function validatePlanInput(input: PlanSprintInput): ErrorIssue[] {
  const issues: ErrorIssue[] = [];

  if (input.startsAt !== undefined && !isIso8601(input.startsAt)) {
    issues.push({ path: ['startsAt'], message: 'must be a valid ISO8601 date' });
  }
  if (input.endsAt !== undefined && !isIso8601(input.endsAt)) {
    issues.push({ path: ['endsAt'], message: 'must be a valid ISO8601 date' });
  }
  if (
    input.startsAt !== undefined &&
    input.endsAt !== undefined &&
    isIso8601(input.startsAt) &&
    isIso8601(input.endsAt) &&
    new Date(input.endsAt).getTime() < new Date(input.startsAt).getTime()
  ) {
    issues.push({ path: ['endsAt'], message: 'must be on or after startsAt' });
  }
  if (input.capacity !== undefined) {
    if (!Number.isFinite(input.capacity) || !Number.isInteger(input.capacity)) {
      issues.push({ path: ['capacity'], message: 'must be a positive integer' });
    } else if (input.capacity < 1 || input.capacity > MAX_SPRINT_CAPACITY) {
      issues.push({
        path: ['capacity'],
        message: `must be between 1 and ${MAX_SPRINT_CAPACITY}`,
      });
    }
  }

  return issues;
}
