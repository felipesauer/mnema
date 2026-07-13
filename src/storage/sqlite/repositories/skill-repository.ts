import type { Skill } from '../../../domain/entities/skill.js';
import { generateUuid } from '../../../domain/id-generator.js';
import { isoNow } from '../../../utils/iso-now.js';
import { splitSkillExampleSections } from '../../../utils/skill-body.js';
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
  readonly change_rationale: string | null;
  readonly scope: string | null;
  readonly usage_count: number;
  readonly last_used_at: string | null;
  readonly created_by: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly superseded_by: string | null;
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
  readonly changeRationale?: string | null;
  readonly scope?: string | null;
  readonly createdBy: string;
}

/**
 * Persistence for {@link Skill}. Each (slug, version) is a separate row;
 * use {@link findLatestBySlug} to get the most recent version.
 */
export class SkillRepository {
  constructor(private readonly adapter: SqliteAdapter) {}

  /**
   * Runs `fn` inside a SQLite transaction, propagating its return value.
   * Used to make a read-then-write atomic — e.g. computing the next version
   * number from the latest row and inserting it as one unit, so two
   * concurrent `new_version` records cannot both read the same latest and
   * collide (better-sqlite3 is synchronous, but this keeps the invariant
   * explicit and correct rather than relying on the runtime).
   *
   * @param fn - Synchronous callback executed inside the transaction
   * @returns Whatever `fn` returns
   */
  runInTransaction<T>(fn: () => T): T {
    return this.adapter.getDatabase().transaction(fn)();
  }

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
   * Finds a skill row by its id. Used to resolve a `superseded_by` pointer
   * — which stores the successor ROW's id, not a slug — back to something a
   * human can follow.
   *
   * @param id - Skill row id
   * @returns The skill row or `null`
   */
  findById(id: string): Skill | null {
    const row = this.adapter.getDatabase().prepare('SELECT * FROM skills WHERE id = ?').get(id) as
      | SkillRow
      | undefined;
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
         WHERE s.superseded_by IS NULL
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
    // Split the body so the FTS triggers can index example tokens at a much
    // lower weight than the core prose. `content` still stores the full body.
    const { core, examples } = splitSkillExampleSections(input.content);
    this.adapter
      .getDatabase()
      .prepare(
        `INSERT INTO skills (
           id, slug, name, version, description, content, content_core, content_examples,
           tools_used, invocable, dynamic_context, change_rationale, scope,
           usage_count, last_used_at, created_by, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?)`,
      )
      .run(
        id,
        input.slug,
        input.name,
        input.version,
        input.description,
        input.content,
        core,
        examples,
        JSON.stringify(input.toolsUsed),
        input.invocable === true ? 1 : 0,
        JSON.stringify(input.dynamicContext ?? []),
        input.changeRationale ?? null,
        input.scope ?? null,
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
      readonly changeRationale?: string | null;
      readonly scope?: string | null;
    },
  ): Skill | null {
    // Re-split on every content write so a re-recorded body re-derives its
    // core/examples columns (a version whose Example section changed must not
    // keep stale split columns).
    const { core, examples } = splitSkillExampleSections(fields.content);
    this.adapter
      .getDatabase()
      .prepare(
        `UPDATE skills
            SET name = ?, description = ?, content = ?, content_core = ?, content_examples = ?,
                tools_used = ?, invocable = ?, dynamic_context = ?, change_rationale = ?,
                scope = ?, updated_at = ?
          WHERE id = ?`,
      )
      .run(
        fields.name,
        fields.description,
        fields.content,
        core,
        examples,
        JSON.stringify(fields.toolsUsed),
        fields.invocable === true ? 1 : 0,
        JSON.stringify(fields.dynamicContext ?? []),
        fields.changeRationale ?? null,
        fields.scope ?? null,
        isoNow(),
        id,
      );
    const row = this.adapter.getDatabase().prepare('SELECT * FROM skills WHERE id = ?').get(id) as
      | SkillRow
      | undefined;
    return row === undefined ? null : rowToSkill(row);
  }

  /**
   * Supersedes a skill row by id: points `superseded_by` at the successor
   * row's id. Keyed by row id (not slug) because skill is `(slug, version)`
   * — a specific version is superseded, mirroring how decisions store the
   * successor's id. One-way. No-op returns `false` for an unknown or
   * already-superseded id.
   *
   * @param id - Id of the skill row being superseded
   * @param successorId - Id of the replacement skill row
   * @returns `true` when a row transitioned to superseded
   */
  supersede(id: string, successorId: string): boolean {
    const result = this.adapter
      .getDatabase()
      .prepare('UPDATE skills SET superseded_by = ? WHERE id = ? AND superseded_by IS NULL')
      .run(successorId, id);
    return result.changes > 0;
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
    changeRationale: row.change_rationale ?? null,
    scope: row.scope ?? null,
    usageCount: row.usage_count,
    lastUsedAt: row.last_used_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    supersededBy: row.superseded_by ?? null,
  };
}
