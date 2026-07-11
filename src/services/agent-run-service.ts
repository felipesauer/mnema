import type { AgentRun } from '../domain/entities/agent-run.js';
import { ActorKind } from '../domain/enums/actor-kind.js';
import { AgentPlanState } from '../domain/enums/agent-plan-state.js';
import { AgentRunStatus } from '../domain/enums/agent-run-status.js';
import type { StateMachine } from '../domain/state-machine/state-machine.js';
import { ErrorCode } from '../errors/error-codes.js';
import type { MnemaError } from '../errors/mnema-error.js';
import type { ActorRepository } from '../storage/sqlite/repositories/actor-repository.js';
import type { AgentPlanRepository } from '../storage/sqlite/repositories/agent-plan-repository.js';
import type { AgentRunRepository } from '../storage/sqlite/repositories/agent-run-repository.js';
import type { TaskRepository } from '../storage/sqlite/repositories/task-repository.js';
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
 * A task the run drove into a non-terminal state and never moved out of —
 * the concrete "what I was in the middle of" a resumed session needs.
 * `state` is where this run last left it; a later run could have moved it,
 * but for resuming *this* run its own last move is the honest stop point.
 */
export interface ActiveTask {
  readonly key: string;
  readonly state: string;
  readonly lastAction: string;
  readonly at: string;
}

/**
 * A read-only digest of what a run did and what it left open. Reuses
 * the same data `mnema agent inspect` renders, condensed into counts
 * plus the list of still-open threads so a resumed session knows where
 * to pick up.
 *
 * Beyond counts and open plans, it reconstructs *focus*: the tasks the
 * run left mid-flight (`activeTasks`), the last few moves it made
 * (`recentChanges`), and a one-line `resumeHint` that says, in prose,
 * where to pick up — so a dropped session does not have to re-derive its
 * own state from raw counts.
 */
export interface RunSummary {
  readonly run: AgentRun;
  readonly mutationCount: number;
  readonly planCount: number;
  readonly openItems: readonly OpenItem[];
  readonly activeTasks: readonly ActiveTask[];
  readonly recentChanges: readonly string[];
  readonly resumeHint: string;
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
    private readonly tasks: TaskRepository,
    private readonly stateMachine: StateMachine,
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

    // Focus reconstruction. Group the run's transitions by task and keep
    // the last one (for the "what did I last do to it" context), but decide
    // whether it is still in flight from the task's *current* state, not the
    // transition's — the task may have moved since, and same-millisecond
    // transitions make transition order an unreliable tiebreaker. A task
    // that is currently non-terminal is work a resumed session picks up.
    const lastByTask = new Map<string, (typeof transitions)[number]>();
    for (const t of transitions) lastByTask.set(t.taskKey, t);
    const activeTasks: ActiveTask[] = [];
    for (const t of lastByTask.values()) {
      const task = this.tasks.findById(t.taskId);
      if (task === null) continue; // deleted since — nothing to resume
      if (!this.stateMachine.isTerminal(task.state)) {
        activeTasks.push({ key: t.taskKey, state: task.state, lastAction: t.action, at: t.at });
      }
    }
    activeTasks.sort((a, b) => b.at.localeCompare(a.at));

    // The last few moves, newest first — a compact timeline standing in for
    // the full run_diff so the summary is self-contained without a second call.
    const recentChanges = [...transitions]
      .reverse()
      .slice(0, 5)
      .map((t) => `${t.taskKey}: ${t.fromState ?? '—'} → ${t.toState}`);

    return Ok({
      run,
      mutationCount: transitions.length,
      planCount: plans.length,
      openItems,
      activeTasks,
      recentChanges,
      resumeHint: buildResumeHint({ activeTasks, openItems, mutationCount: transitions.length }),
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

/**
 * Turns the reconstructed focus into one actionable sentence. The order
 * mirrors what a resuming session should do first: finish a task left
 * mid-flight, then work an open plan step, else acknowledge a bookkeeping
 * run with nothing outstanding, else a run that did nothing at all.
 */
function buildResumeHint(input: {
  readonly activeTasks: readonly ActiveTask[];
  readonly openItems: readonly OpenItem[];
  readonly mutationCount: number;
}): string {
  const { activeTasks, openItems, mutationCount } = input;
  const first = activeTasks[0];
  if (first !== undefined) {
    const more =
      activeTasks.length > 1 ? ` (+${String(activeTasks.length - 1)} more mid-flight)` : '';
    return `You were on ${first.key}, left ${first.state} after \`${first.lastAction}\`${more}. Resume it before starting new work.`;
  }
  const openPlans = openItems.filter((i) => i.kind === 'plan');
  if (openPlans.length > 0) {
    return `No task left in progress, but ${String(openPlans.length)} plan step(s) are still open — continue with: ${openPlans[0]?.label ?? ''}.`;
  }
  if (mutationCount > 0) {
    return 'This run finished every task it touched and left no open plans — nothing to resume; pick up new work.';
  }
  return 'This run recorded no task mutations — nothing to resume; start the work its goal describes.';
}
