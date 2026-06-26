import type { AgentRun } from '../domain/entities/agent-run.js';
import { ActorKind } from '../domain/enums/actor-kind.js';
import { AgentPlanState } from '../domain/enums/agent-plan-state.js';
import { AgentRunStatus } from '../domain/enums/agent-run-status.js';
import { ErrorCode } from '../errors/error-codes.js';
import type { MnemaError } from '../errors/mnema-error.js';
import type { ActorRepository } from '../storage/sqlite/repositories/actor-repository.js';
import type { AgentPlanRepository } from '../storage/sqlite/repositories/agent-plan-repository.js';
import type { AgentRunRepository } from '../storage/sqlite/repositories/agent-run-repository.js';
import type { TransitionRepository } from '../storage/sqlite/repositories/transition-repository.js';
import type { AuditService } from './audit-service.js';
import type { IdentityService } from './identity-service.js';
import { Err, Ok, type Result } from './result.js';

/**
 * Maximum nesting depth allowed for agent runs (mirrors the SQL CHECK).
 */
export const AGENT_RUN_DEPTH_LIMIT = 5;

/**
 * Input for {@link AgentRunService.start}.
 */
export interface StartRunInput {
  readonly goal: string;
  readonly actor: string;
  readonly agentHandle: string;
  readonly parentRunId?: string;
  readonly skillsLoaded?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly clientMetadata?: Readonly<Record<string, unknown>>;
}

/**
 * Input for {@link AgentRunService.end}.
 */
export interface EndRunInput {
  readonly runId: string;
  readonly status: AgentRunStatus;
  readonly result?: string | null;
  readonly errorMessage?: string | null;
}

/**
 * Optional hook fired after an agent run terminates. Used by the MCP
 * server to flush the persistent sync buffer; the CLI ignores it.
 */
export type RunEndHook = (run: AgentRun) => void;

/**
 * Input for {@link AgentRunService.resume}.
 */
export interface ResumeRunInput {
  readonly runId: string;
  readonly actor: string;
}

/**
 * A single unfinished thread left behind by a run — either a plan step
 * that never reached a terminal state, or a child run still open.
 */
export interface OpenItem {
  readonly kind: 'plan' | 'child_run';
  readonly id: string;
  readonly label: string;
  readonly status: string;
}

/**
 * A read-only digest of what a run did and what it left open. Reuses
 * the same data `mnema agent inspect` renders, condensed into counts
 * plus the list of still-open threads so a resumed session knows where
 * to pick up.
 */
export interface RunSummary {
  readonly run: AgentRun;
  readonly mutationCount: number;
  readonly planCount: number;
  readonly openItems: readonly OpenItem[];
}

/**
 * Orchestrates the lifecycle of `agent_run` rows.
 *
 * Each run captures the dual identity tuple: `actor` (the human who
 * invoked the work, sourced from {@link IdentityService.getDefaultActor})
 * and `agentActor` (resolved via the MCP `agent_handle`). Plans are
 * automatically archived by the SQL trigger when the run ends.
 */
export class AgentRunService {
  constructor(
    private readonly runs: AgentRunRepository,
    private readonly actors: ActorRepository,
    private readonly identity: IdentityService,
    private readonly audit: AuditService,
    private readonly plans: AgentPlanRepository,
    private readonly transitions: TransitionRepository,
    private readonly onRunEnd: RunEndHook = () => {},
  ) {}

  /**
   * Starts a new agent run. Resolves both actor (human) and agent
   * actor entries, enforces the depth limit, and persists the row in
   * `running` status.
   *
   * @param input - Run start parameters
   * @returns The newly created run or a structured error
   */
  start(input: StartRunInput): Result<AgentRun, MnemaError> {
    const invokedById = this.identity.ensureActor(input.actor, ActorKind.Human);
    const agentActorHandle = `agent:${input.agentHandle}`;
    const agentActorId = this.identity.ensureActor(agentActorHandle, ActorKind.Agent);

    let depth = 0;
    if (input.parentRunId !== undefined) {
      const parent = this.runs.findById(input.parentRunId);
      if (parent === null) {
        return Err({ kind: ErrorCode.AgentRunNotFound, runId: input.parentRunId });
      }
      depth = parent.depth + 1;
      if (depth > AGENT_RUN_DEPTH_LIMIT) {
        return Err({
          kind: ErrorCode.DepthLimitExceeded,
          entity: 'agent_run',
          attemptedDepth: depth,
          limit: AGENT_RUN_DEPTH_LIMIT,
        });
      }
    }

    const run = this.runs.insert({
      agentActorId,
      invokedBy: invokedById,
      goal: input.goal,
      parentRunId: input.parentRunId ?? null,
      skillsLoaded: input.skillsLoaded,
      metadata: input.metadata,
      clientMetadata: input.clientMetadata,
      depth,
    });

    this.audit.write({
      kind: 'run_started',
      actor: input.actor,
      via: agentActorHandle,
      run: run.id,
      data: {
        goal: input.goal,
        parent_run_id: run.parentRunId,
        depth: run.depth,
      },
    });

    return Ok(run);
  }

  /**
   * Marks a run as ended with a terminal status. Fires the run-end
   * hook (used by the MCP server to flush the sync buffer).
   *
   * @param input - Run id and terminal status
   * @returns The updated run or a structured error
   */
  end(input: EndRunInput): Result<AgentRun, MnemaError> {
    const current = this.runs.findById(input.runId);
    if (current === null) {
      return Err({ kind: ErrorCode.AgentRunNotFound, runId: input.runId });
    }
    if (
      current.status === AgentRunStatus.Completed ||
      current.status === AgentRunStatus.Failed ||
      current.status === AgentRunStatus.Aborted
    ) {
      return Err({
        kind: ErrorCode.AgentRunAlreadyEnded,
        runId: input.runId,
        status: current.status,
      });
    }

    const updated = this.runs.end(
      input.runId,
      input.status,
      input.result ?? null,
      input.errorMessage ?? null,
    );
    if (updated === null) {
      return Err({ kind: ErrorCode.AgentRunNotFound, runId: input.runId });
    }

    const invokedBy = this.actors.findById(current.invokedBy);
    const agentActor = this.actors.findById(current.agentActorId);
    this.audit.write({
      kind: 'run_ended',
      actor: invokedBy?.handle ?? current.invokedBy,
      via: agentActor?.handle ?? undefined,
      run: updated.id,
      data: {
        status: updated.status,
        result: updated.result,
        error: updated.error,
      },
    });

    this.onRunEnd(updated);

    return Ok(updated);
  }

  /**
   * Reattaches to an interrupted run instead of opening a new one.
   *
   * An `aborted` or `failed` run is an orphaned session — a gap in the
   * chain of custody. Resuming reopens that same run (clearing its
   * terminal fields, flipping it back to `running`) so subsequent work
   * lands on the original link rather than a fresh one. A run that is
   * still `running` resumes idempotently (reattach, no state change). A
   * `completed` run is deliberately closed and is rejected.
   *
   * @param input - Run id and the human reattaching
   * @returns The reopened (or already-running) run, or a structured error
   */
  resume(input: ResumeRunInput): Result<AgentRun, MnemaError> {
    const current = this.runs.findById(input.runId);
    if (current === null) {
      return Err({ kind: ErrorCode.AgentRunNotFound, runId: input.runId });
    }

    if (current.status === AgentRunStatus.Completed) {
      return Err({
        kind: ErrorCode.AgentRunNotResumable,
        runId: input.runId,
        status: current.status,
      });
    }

    const agentActor = this.actors.findById(current.agentActorId);
    const via = agentActor?.handle ?? undefined;

    // Already running: reattach without touching the row, so resuming a
    // live session is a safe no-op.
    if (current.status === AgentRunStatus.Running) {
      this.audit.write({
        kind: 'run_resumed',
        actor: input.actor,
        via,
        run: current.id,
        data: { from_status: current.status, reattached: true },
      });
      return Ok(current);
    }

    const reopened = this.runs.reopen(input.runId);
    if (reopened === null) {
      return Err({ kind: ErrorCode.AgentRunNotFound, runId: input.runId });
    }

    this.audit.write({
      kind: 'run_resumed',
      actor: input.actor,
      via,
      run: reopened.id,
      data: { from_status: current.status, reattached: false },
    });

    return Ok(reopened);
  }

  /**
   * Builds a read-only digest of a run: how many mutations and plans it
   * produced, plus every still-open thread (non-terminal plan steps and
   * children that never ended). Reuses the data `agent inspect` renders.
   *
   * @param runId - Run identifier
   * @returns The summary or `AGENT_RUN_NOT_FOUND`
   */
  summarize(runId: string): Result<RunSummary, MnemaError> {
    const run = this.runs.findById(runId);
    if (run === null) {
      return Err({ kind: ErrorCode.AgentRunNotFound, runId });
    }

    const plans = this.plans.findByRun(runId);
    const transitions = this.transitions.findByRun(runId);
    const children = this.runs.findChildren(runId);

    const openItems: OpenItem[] = [];
    for (const plan of plans) {
      if (
        plan.state !== AgentPlanState.Completed &&
        plan.state !== AgentPlanState.Skipped &&
        plan.state !== AgentPlanState.Failed
      ) {
        openItems.push({ kind: 'plan', id: plan.id, label: plan.content, status: plan.state });
      }
    }
    for (const child of children) {
      if (child.status === AgentRunStatus.Running) {
        openItems.push({
          kind: 'child_run',
          id: child.id,
          label: child.goal,
          status: child.status,
        });
      }
    }

    return Ok({
      run,
      mutationCount: transitions.length,
      planCount: plans.length,
      openItems,
    });
  }

  /**
   * Returns a run by id, or `AGENT_RUN_NOT_FOUND` when missing.
   *
   * @param runId - Run identifier
   * @returns The run or a structured error
   */
  findById(runId: string): Result<AgentRun, MnemaError> {
    const run = this.runs.findById(runId);
    if (run === null) {
      return Err({ kind: ErrorCode.AgentRunNotFound, runId });
    }
    return Ok(run);
  }

  /**
   * Returns the direct children of a run. Empty array when there are
   * none. Used by `mnema agent inspect` to render the run hierarchy.
   *
   * @param parentRunId - Parent run identifier
   * @returns Children ordered by start time
   */
  findChildren(parentRunId: string): readonly AgentRun[] {
    return this.runs.findChildren(parentRunId);
  }
}
