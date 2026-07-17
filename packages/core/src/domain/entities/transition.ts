/**
 * Transition entity — append-only record of a task state change.
 *
 * Carries the dual-identity tuple: {@link actorId} (always the human
 * responsible), {@link viaActorId} (the agent that performed the work,
 * if any), and {@link agentRunId} (the run that produced the change).
 */
export interface Transition {
  readonly id: string;
  readonly taskId: string;
  /** Source state; `null` on creation */
  readonly fromState: string | null;
  readonly toState: string;
  readonly action: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly actorId: string;
  readonly viaActorId: string | null;
  readonly agentRunId: string | null;
  readonly at: string;
}
