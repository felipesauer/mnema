import type { AgentRunStatus } from '../enums/agent-run-status.js';

/**
 * AgentRun entity — a single execution of an external agent.
 *
 * Carries dual identity through {@link agentActorId} (the agent that
 * performed the work) and {@link invokedBy} (the human or parent agent
 * that initiated it).
 */
export interface AgentRun {
  readonly id: string;
  readonly agentActorId: string;
  readonly parentRunId: string | null;
  readonly invokedBy: string;
  readonly goal: string;
  readonly skillsLoaded: readonly string[];
  readonly status: AgentRunStatus;
  readonly result: string | null;
  readonly error: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly clientMetadata: Readonly<Record<string, unknown>>;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly depth: number;
}
