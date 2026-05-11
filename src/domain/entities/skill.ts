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
  readonly usageCount: number;
  readonly lastUsedAt: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}
