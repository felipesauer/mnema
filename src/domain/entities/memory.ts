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
}
