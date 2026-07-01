import type { Skill } from '../../../domain/entities/skill.js';
import { generateUuid } from '../../../domain/id-generator.js';
import { isoNow } from '../../../utils/iso-now.js';
import type { SqliteAdapter } from '../sqlite-adapter.js';

interface SkillRow {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly version: number;
  readonly description: string;
  readonly content: string;
  readonly tools_used: string;
  readonly invocable: number;
  readonly dynamic_context: string;
  readonly usage_count: number;
  readonly last_used_at: string | null;
  readonly created_by: string;
  readonly created_at: string;
  readonly updated_at: string;
}

/**
 * Input for {@link SkillRepository.insert}.
 */
export interface SkillInsertInput {
  readonly slug: string;
  readonly name: string;
  readonly version: number;
  readonly description: string;
  readonly content: string;
  readonly toolsUsed: readonly string[];
  readonly invocable?: boolean;
  readonly dynamicContext?: readonly string[];
  readonly createdBy: string;
}

/**
 * Persistence for {@link Skill}. Each (slug, version) is a separate row;
 * use {@link findLatestBySlug} to get the most recent version.
 */
export class SkillRepository {
  constructor(private readonly adapter: SqliteAdapter) {}

  /**
   * Finds the latest version row for a given slug.
   *
   * @param slug - Skill slug
   * @returns The latest skill row or `null`
   */
  findLatestBySlug(slug: string): Skill | null {
    const row = this.adapter
      .getDatabase()
      .prepare('SELECT * FROM skills WHERE slug = ? ORDER BY version DESC LIMIT 1')
      .get(slug) as SkillRow | undefined;
    return row === undefined ? null : rowToSkill(row);
  }

  /**
   * Finds a specific version of a skill by slug.
   *
   * @param slug - Skill slug
   * @param version - Version number
   * @returns The skill row or `null`
   */
  findBySlugAndVersion(slug: string, version: number): Skill | null {
    const row = this.adapter
      .getDatabase()
      .prepare('SELECT * FROM skills WHERE slug = ? AND version = ?')
      .get(slug, version) as SkillRow | undefined;
    return row === undefined ? null : rowToSkill(row);
  }

  /**
   * Lists every recorded version for a slug, newest first.
   *
   * @param slug - Skill slug
   * @returns Skill rows
   */
  listBySlug(slug: string): Skill[] {
    const rows = this.adapter
      .getDatabase()
      .prepare('SELECT * FROM skills WHERE slug = ? ORDER BY version DESC')
      .all(slug) as SkillRow[];
    return rows.map(rowToSkill);
  }

  /**
   * Lists the latest version of every distinct slug.
   *
   * @returns Skill rows (one per slug)
   */
  listLatest(): Skill[] {
    const rows = this.adapter
      .getDatabase()
      .prepare(
        `SELECT s.* FROM skills s
         INNER JOIN (
           SELECT slug, MAX(version) AS max_version
           FROM skills
           GROUP BY slug
         ) latest ON s.slug = latest.slug AND s.version = latest.max_version
         ORDER BY s.usage_count DESC, s.updated_at DESC`,
      )
      .all() as SkillRow[];
    return rows.map(rowToSkill);
  }

  /**
   * Inserts a new skill row. Caller decides the version number; uniqueness
   * is enforced by the SQL UNIQUE constraint on (slug, version).
   *
   * @param input - Skill fields
   * @returns The newly created skill
   */
  insert(input: SkillInsertInput): Skill {
    const id = generateUuid();
    const now = isoNow();
    this.adapter
      .getDatabase()
      .prepare(
        `INSERT INTO skills (
           id, slug, name, version, description, content,
           tools_used, invocable, dynamic_context,
           usage_count, last_used_at, created_by, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?)`,
      )
      .run(
        id,
        input.slug,
        input.name,
        input.version,
        input.description,
        input.content,
        JSON.stringify(input.toolsUsed),
        input.invocable === true ? 1 : 0,
        JSON.stringify(input.dynamicContext ?? []),
        input.createdBy,
        now,
        now,
      );

    const created = this.findBySlugAndVersion(input.slug, input.version);
    if (created === null) {
      throw new Error('skill insert succeeded but row not found');
    }
    return created;
  }

  /**
   * Overwrites an existing skill row's content/description/name/toolsUsed.
   * Used in `mode='update'` when content differs but version stays.
   *
   * @param id - Skill row id
   * @param fields - Mutable fields
   * @returns The updated skill or `null` if id is unknown
   */
  updateContent(
    id: string,
    fields: {
      readonly name: string;
      readonly description: string;
      readonly content: string;
      readonly toolsUsed: readonly string[];
      readonly invocable?: boolean;
      readonly dynamicContext?: readonly string[];
    },
  ): Skill | null {
    this.adapter
      .getDatabase()
      .prepare(
        `UPDATE skills
            SET name = ?, description = ?, content = ?, tools_used = ?,
                invocable = ?, dynamic_context = ?, updated_at = ?
          WHERE id = ?`,
      )
      .run(
        fields.name,
        fields.description,
        fields.content,
        JSON.stringify(fields.toolsUsed),
        fields.invocable === true ? 1 : 0,
        JSON.stringify(fields.dynamicContext ?? []),
        isoNow(),
        id,
      );
    const row = this.adapter.getDatabase().prepare('SELECT * FROM skills WHERE id = ?').get(id) as
      | SkillRow
      | undefined;
    return row === undefined ? null : rowToSkill(row);
  }

  /**
   * Increments `usage_count` and sets `last_used_at` for the latest
   * version of a slug.
   *
   * @param slug - Skill slug
   * @returns The updated skill, or `null` when the slug is unknown
   */
  incrementUsage(slug: string): Skill | null {
    const latest = this.findLatestBySlug(slug);
    if (latest === null) return null;
    this.adapter
      .getDatabase()
      .prepare('UPDATE skills SET usage_count = usage_count + 1, last_used_at = ? WHERE id = ?')
      .run(isoNow(), latest.id);
    return this.findLatestBySlug(slug);
  }
}

function rowToSkill(row: SkillRow): Skill {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    version: row.version,
    description: row.description,
    content: row.content,
    toolsUsed: JSON.parse(row.tools_used) as string[],
    invocable: row.invocable === 1,
    dynamicContext: JSON.parse(row.dynamic_context) as string[],
    usageCount: row.usage_count,
    lastUsedAt: row.last_used_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
