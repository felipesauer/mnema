import type { AgentRun } from '../domain/entities/agent-run.js';
import { ActorKind } from '../domain/enums/actor-kind.js';
import { AgentRunStatus } from '../domain/enums/agent-run-status.js';
import { ErrorCode } from '../errors/error-codes.js';
import type { MnemaError } from '../errors/mnema-error.js';
import type { ActorRepository } from '../storage/sqlite/repositories/actor-repository.js';
import type { AgentRunRepository } from '../storage/sqlite/repositories/agent-run-repository.js';
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
}
