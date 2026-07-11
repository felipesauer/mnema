/**
 * Memory entity — a durable fact about the project.
 *
 * Distinct from {@link Decision}: a memory is asserted as truth (e.g.
 * "client requires PCI-DSS"), not deliberated in a proposed→accepted
 * cycle. Distinct from observations: memories are upserted, not
 * append-only.
 */
export interface Memory {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly content: string;
  readonly topics: readonly string[];
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  /**
   * When the memory was archived (soft, reversible retirement), or `null`
   * when active. Archived memories are excluded from the default listing;
   * re-recording the same slug clears this.
   */
  readonly archivedAt: string | null;
  /**
   * Slug of the successor memory that replaces this one, or `null` when
   * this memory has not been superseded. Superseded memories are excluded
   * from the default listing and from search; unlike archival this is a
   * one-way pointer (see the supersede ADR).
   */
  readonly supersededBy: string | null;
  /**
   * Slug of a newer memory that *contradicts* (obsoletes) this one, or
   * `null` when nothing contradicts it. Unlike {@link supersededBy}, an
   * obsoleted memory stays visible — the contradiction is informative — but
   * is annotated obsolete and de-ranked so the current truth is unambiguous.
   */
  readonly obsoletedBy: string | null;
  /**
   * Area this memory belongs to — a path or package like
   * `packages/notifier`, or `null` for project-global. A scope narrows what
   * the bootstrap and search surface for a given area; it never hides the
   * memory outright (see {@link SkillService}/bootstrap scoping).
   */
  readonly scope: string | null;
}
