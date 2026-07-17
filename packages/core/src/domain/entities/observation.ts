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
  /**
   * When set, the observation was archived (soft, one-way retirement) — it
   * is hidden from the default listing and from search, but the row and its
   * audit trail survive. `null` for an active observation.
   */
  readonly archivedAt: string | null;
}
