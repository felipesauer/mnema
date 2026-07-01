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
}
