/**
 * Skill entity — a reusable procedure an agent records for itself.
 *
 * Versioned: a slug can have multiple rows, one per version. The latest
 * version is what `skill_show(slug)` returns by default.
 */
export interface Skill {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly version: number;
  readonly description: string;
  readonly content: string;
  readonly toolsUsed: readonly string[];
  /**
   * When true, the skill is meant to be invoked (run), not just read as
   * documentation. Passive skills leave this false.
   */
  readonly invocable: boolean;
  /**
   * Commands whose output is injected as context when the skill is shown
   * — e.g. `['mnema tasks ready']` for a "pick next task" skill. Empty for
   * a skill with no dynamic context.
   */
  readonly dynamicContext: readonly string[];
  readonly usageCount: number;
  readonly lastUsedAt: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  /**
   * Id of the successor skill row that replaces this version, or `null`
   * when this version has not been superseded. Because skill is keyed by
   * (slug, version), the pointer is the successor row's `id` (as decision
   * stores it), not a slug — see the supersede ADR. A superseded latest
   * version drops out of the default listing and search; one-way.
   */
  readonly supersededBy: string | null;
}
