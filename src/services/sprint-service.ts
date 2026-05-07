import type { Sprint } from '../domain/entities/sprint.js';
import type { Task } from '../domain/entities/task.js';
import { SprintState } from '../domain/enums/sprint-state.js';
import { ErrorCode } from '../errors/error-codes.js';
import type { ErrorIssue, MnemaError } from '../errors/mnema-error.js';
import type { ProjectRepository } from '../storage/sqlite/repositories/project-repository.js';
import type { SprintRepository } from '../storage/sqlite/repositories/sprint-repository.js';
import type { TaskRepository } from '../storage/sqlite/repositories/task-repository.js';
import { isIso8601 } from '../utils/iso-date.js';
import type { AuditService } from './audit-service.js';
import { Err, Ok, type Result } from './result.js';

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
  ) {}

  /**
   * Plans a new sprint in `PLANNED` state.
   *
   * @param input - Sprint metadata + identity tuple
   * @returns The created sprint or a structured error
   */
  plan(input: PlanSprintInput): Result<Sprint, MnemaError> {
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

    const sprint = this.sprints.insert({
      key,
      projectId: project.id,
      name: input.name,
      goal: input.goal ?? null,
      startsAt: input.startsAt ?? null,
      endsAt: input.endsAt ?? null,
      capacity: input.capacity ?? null,
    });

    this.audit.write({
      kind: 'sprint_planned',
      actor: input.actor,
      via: input.via,
      run: input.runId,
      data: { key: sprint.key, name: sprint.name, goal: sprint.goal },
    });

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

    const updated = this.sprints.updateState(sprint.id, SprintState.Active);
    if (updated === null) {
      return Err({ kind: ErrorCode.SprintNotFound, sprintKey: input.sprintKey });
    }

    this.audit.write({
      kind: 'sprint_started',
      actor: input.actor,
      via: input.via,
      run: input.runId,
      data: { key: updated.key },
    });

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

    const updated = this.sprints.updateState(sprint.id, SprintState.Closed);
    if (updated === null) {
      return Err({ kind: ErrorCode.SprintNotFound, sprintKey: input.sprintKey });
    }

    this.audit.write({
      kind: 'sprint_closed',
      actor: input.actor,
      via: input.via,
      run: input.runId,
      data: { key: updated.key },
    });

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
    return { sprint, tasks: this.sprints.listTasks(sprint.id) };
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
    return { sprint, tasks: this.sprints.listTasks(sprint.id) };
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
