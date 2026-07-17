import { Err, Ok, type Result } from '../../common/result.js';
import type { AgentPlan } from '../../domain/entities/agent-plan.js';
import type { AgentPlanState } from '../../domain/enums/agent-plan-state.js';
import { ErrorCode } from '../../errors/error-codes.js';
import type { MnemaError } from '../../errors/mnema-error.js';
import type { AgentPlanRepository } from '../../storage/sqlite/repositories/agent-plan-repository.js';
import type { AgentRunRepository } from '../../storage/sqlite/repositories/agent-run-repository.js';
import type { TaskRepository } from '../../storage/sqlite/repositories/task-repository.js';

/**
 * Maximum nesting depth for plans (mirrors the SQL CHECK).
 */
export const AGENT_PLAN_DEPTH_LIMIT = 5;

/**
 * Input for {@link AgentPlanService.create}.
 *
 * `taskKey` is optional — when supplied, the service resolves it to a
 * `task_id` and stores it as a soft FK so audit views can link the
 * plan to its task. Plans without a task link describe orchestration
 * steps (research, design) that don't map 1:1 to a workflow task.
 */
export interface CreatePlanInput {
  readonly runId: string;
  readonly content: string;
  readonly parentPlanId?: string;
  readonly taskKey?: string;
  readonly position?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Input for {@link AgentPlanService.updateState}.
 *
 * Either `planId` (UUID) or the pair `{ runId, position }` works as
 * the identifier. The position-based form is convenient for agents
 * that declare a linear plan upfront and address steps by their
 * position rather than tracking 8 UUIDs in parallel.
 */
export interface UpdatePlanStateInput {
  readonly planId?: string;
  readonly runId?: string;
  readonly position?: number;
  readonly state: AgentPlanState;
  readonly result?: string | null;
}

/**
 * Options for {@link AgentPlanService.list}.
 */
export interface ListPlansOptions {
  readonly activeOnly?: boolean;
}

/**
 * Orchestrates the lifecycle of `agent_plan` rows.
 *
 * Plans live inside a parent run. Depth is bounded by
 * {@link AGENT_PLAN_DEPTH_LIMIT}; the SQL trigger archives every plan
 * attached to a run when the run terminates.
 */
export class AgentPlanService {
  constructor(
    private readonly plans: AgentPlanRepository,
    private readonly runs: AgentRunRepository,
    private readonly tasks: TaskRepository,
  ) {}

  /**
   * Creates a new plan attached to a run.
   *
   * @param input - Plan creation parameters
   * @returns The newly created plan or a structured error
   */
  create(input: CreatePlanInput): Result<AgentPlan, MnemaError> {
    if (this.runs.findById(input.runId) === null) {
      return Err({ kind: ErrorCode.AgentRunNotFound, runId: input.runId });
    }

    let depth = 0;
    if (input.parentPlanId !== undefined) {
      const parent = this.plans.findById(input.parentPlanId);
      if (parent === null) {
        return Err({ kind: ErrorCode.AgentPlanNotFound, planId: input.parentPlanId });
      }
      depth = parent.depth + 1;
      if (depth > AGENT_PLAN_DEPTH_LIMIT) {
        return Err({
          kind: ErrorCode.DepthLimitExceeded,
          entity: 'agent_plan',
          attemptedDepth: depth,
          limit: AGENT_PLAN_DEPTH_LIMIT,
        });
      }
    }

    let taskId: string | null = null;
    if (input.taskKey !== undefined) {
      const task = this.tasks.findByKey(input.taskKey);
      if (task === null) {
        return Err({ kind: ErrorCode.TaskNotFound, taskKey: input.taskKey });
      }
      taskId = task.id;
    }

    const plan = this.plans.insert({
      agentRunId: input.runId,
      content: input.content,
      parentPlanId: input.parentPlanId ?? null,
      taskId,
      position: input.position,
      depth,
      metadata: input.metadata,
    });

    return Ok(plan);
  }

  /**
   * Updates the state of an existing plan.
   *
   * @param input - Plan id, target state, optional result
   * @returns The updated plan or a structured error
   */
  updateState(input: UpdatePlanStateInput): Result<AgentPlan, MnemaError> {
    const planId = this.resolvePlanId(input);
    if (planId === null) {
      return Err({
        kind: ErrorCode.AgentPlanNotFound,
        planId: input.planId ?? `(run=${input.runId},pos=${input.position})`,
      });
    }
    const updated = this.plans.updateState(planId, input.state, input.result ?? null);
    if (updated === null) {
      return Err({ kind: ErrorCode.AgentPlanNotFound, planId });
    }
    return Ok(updated);
  }

  /**
   * Resolves the identifier to a plan id. Accepts either an explicit
   * `planId` or a `(runId, position)` pair. Position lookup matches the
   * first non-archived plan in the run with that position; ambiguous
   * positions resolve to the earliest-created plan.
   */
  private resolvePlanId(input: UpdatePlanStateInput): string | null {
    if (input.planId !== undefined) return input.planId;
    if (input.runId === undefined || input.position === undefined) return null;
    const candidates = this.plans
      .findByRun(input.runId, { activeOnly: true })
      .filter((p) => p.position === input.position);
    return candidates[0]?.id ?? null;
  }

  /**
   * Lists plans for a run, ordered by position then creation.
   *
   * @param runId - Run to filter by
   * @param options - When `activeOnly` is true, archived plans are skipped
   * @returns Array of matching plans
   */
  list(runId: string, options: ListPlansOptions = {}): AgentPlan[] {
    return this.plans.findByRun(runId, options);
  }
}
