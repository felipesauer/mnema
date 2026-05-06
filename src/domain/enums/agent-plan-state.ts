/**
 * State of a single step inside an agent_run.
 */
export enum AgentPlanState {
  Pending = 'pending',
  InProgress = 'in_progress',
  Completed = 'completed',
  Skipped = 'skipped',
  Failed = 'failed',
}
