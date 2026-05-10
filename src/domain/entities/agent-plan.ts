import type { AgentPlanState } from '../enums/agent-plan-state.js';

/**
 * AgentPlan entity — an ephemeral step inside an agent_run.
 *
 * Plans are auto-archived when their parent run ends.
 */
export interface AgentPlan {
  readonly id: string;
  readonly agentRunId: string;
  readonly parentPlanId: string | null;
  /**
   * Internal task id this plan implements. Optional — plans without a
   * task link describe orchestration steps (research, design) that
   * don't map 1:1 to a workflow task. When present, audit views
   * (`agent inspect`) render the plan alongside the task's transitions.
   */
  readonly taskId: string | null;
  readonly content: string;
  readonly state: AgentPlanState;
  readonly result: string | null;
  readonly position: number;
  readonly depth: number;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly archivedAt: string | null;
  readonly createdAt: string;
}
