/**
 * Observation entity — an append-only context note recorded by an agent.
 *
 * Lighter than {@link Memory} (no slug, no mirror file). Useful for
 * recording short-lived signals that may inform later memories or skills
 * but aren't durable facts on their own.
 */
export interface Observation {
  readonly id: string;
  readonly content: string;
  readonly topics: readonly string[];
  readonly relatedTaskId: string | null;
  readonly createdBy: string;
  readonly at: string;
}
