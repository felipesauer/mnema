import type { Memory } from '../../../domain/entities/memory.js';
import { generateUuid } from '../../../domain/id-generator.js';
import { isoNow } from '../../../utils/iso-now.js';
import type { SqliteAdapter } from '../sqlite-adapter.js';

interface MemoryRow {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly content: string;
  readonly topics: string;
  readonly created_by: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly archived_at: string | null;
  readonly superseded_by: string | null;
  readonly obsoleted_by: string | null;
  readonly scope: string | null;
}

/**
 * Input for {@link MemoryRepository.upsert}.
 */
export interface MemoryUpsertInput {
  readonly slug: string;
  readonly title: string;
  readonly content: string;
  readonly topics: readonly string[];
  readonly createdBy: string;
  /** Optional area (path/package) this memory belongs to; null = global. */
  readonly scope?: string | null;
}

/**
 * Input for {@link MemoryRepository.insertFromMirror} — a memory rebuilt from
 * its `.md` mirror, so the on-disk timestamps and raw `scope` are preserved
 * rather than regenerated. The mirror carries the authoritative scope in its
 * frontmatter (the folder is only a lossy presentational projection).
 */
export interface MemoryMirrorInput {
  readonly slug: string;
  readonly title: string;
  readonly content: string;
  readonly topics: readonly string[];
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Raw scope from the mirror frontmatter; null for a scopeless memory. */
  readonly scope: string | null;
}

/**
 * Persistence for {@link Memory}. Slug is the natural key (UNIQUE); a
 * second call with the same slug overwrites the prior content.
 */
export class MemoryRepository {
  constructor(private readonly adapter: SqliteAdapter) {}

  /**
   * Finds a memory by its slug.
   *
   * @param slug - Memory slug
   * @returns The memory or `null`
   */
  findBySlug(slug: string): Memory | null {
    const row = this.adapter
      .getDatabase()
      .prepare('SELECT * FROM memories WHERE slug = ?')
      .get(slug) as MemoryRow | undefined;
    return row === undefined ? null : rowToMemory(row);
  }

  /**
   * Lists memories, optionally filtered by topic. Archived memories are
   * excluded unless `includeArchived` is set — the default listing (and
   * the bootstrap inventory) shows only active memories.
   *
   * @param topic - Optional topic to filter by (membership in `topics`)
   * @param includeArchived - Include archived memories (default false)
   * @returns Memory rows ordered by `updated_at` desc
   */
  listAll(topic?: string, includeArchived = false): Memory[] {
    const rows = this.adapter
      .getDatabase()
      .prepare('SELECT * FROM memories ORDER BY updated_at DESC')
      .all() as MemoryRow[];
    let memories = rows.map(rowToMemory);
    // A superseded memory is always excluded from the default listing — it
    // has been replaced by a successor (there is no `includeSuperseded`
    // toggle, unlike archival, because supersede is one-way).
    memories = memories.filter((m) => m.supersededBy === null);
    if (!includeArchived) memories = memories.filter((m) => m.archivedAt === null);
    if (topic !== undefined) memories = memories.filter((m) => m.topics.includes(topic));
    // De-rank contradicted memories: they stay listed (the contradiction is
    // informative) but sink below the current truth, preserving the existing
    // updated_at DESC order within each group. Stable partition.
    const live = memories.filter((m) => m.obsoletedBy === null);
    const obsolete = memories.filter((m) => m.obsoletedBy !== null);
    return [...live, ...obsolete];
  }

  /**
   * Archives a memory by slug (soft, reversible). Sets `archived_at`; the
   * row and its audit trail survive. No-op returns `false` for an unknown
   * or already-archived slug.
   *
   * @param slug - Memory slug
   * @returns `true` when a row transitioned to archived
   */
  archive(slug: string): boolean {
    const result = this.adapter
      .getDatabase()
      .prepare('UPDATE memories SET archived_at = ? WHERE slug = ? AND archived_at IS NULL')
      .run(isoNow(), slug);
    return result.changes > 0;
  }

  /**
   * Supersedes a memory by slug: points `superseded_by` at the successor
   * slug. One-way — a superseded memory is excluded from listing and
   * search but the row and its audit trail survive. No-op returns `false`
   * for an unknown or already-superseded slug.
   *
   * @param slug - Slug of the memory being superseded
   * @param successorSlug - Slug of the replacement memory
   * @returns `true` when a row transitioned to superseded
   */
  supersede(slug: string, successorSlug: string): boolean {
    const result = this.adapter
      .getDatabase()
      .prepare('UPDATE memories SET superseded_by = ? WHERE slug = ? AND superseded_by IS NULL')
      .run(successorSlug, slug);
    return result.changes > 0;
  }

  /**
   * Marks a memory obsolete by pointing `obsoleted_by` at the memory that
   * contradicts it. Softer than supersede: the row stays listed (annotated
   * and de-ranked), so the contradiction remains visible. Only sets it when
   * currently null, so a second contradiction does not silently repoint.
   *
   * @param slug - Slug of the memory being contradicted
   * @param bySlug - Slug of the memory that contradicts it
   * @returns `true` when a row transitioned to obsolete
   */
  markObsolete(slug: string, bySlug: string): boolean {
    const result = this.adapter
      .getDatabase()
      .prepare('UPDATE memories SET obsoleted_by = ? WHERE slug = ? AND obsoleted_by IS NULL')
      .run(bySlug, slug);
    return result.changes > 0;
  }

  /**
   * Inserts or replaces a memory row by slug.
   *
   * @param input - Memory fields
   * @returns The upserted memory
   */
  upsert(input: MemoryUpsertInput): Memory {
    const existing = this.findBySlug(input.slug);
    const now = isoNow();
    if (existing === null) {
      const id = generateUuid();
      this.adapter
        .getDatabase()
        .prepare(
          `INSERT INTO memories (
             id, slug, title, content, topics, scope, created_by, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.slug,
          input.title,
          input.content,
          JSON.stringify(input.topics),
          input.scope ?? null,
          input.createdBy,
          now,
          now,
        );
    } else {
      // Re-recording a slug reactivates it: clear any archived_at so an
      // archived memory brought back with fresh content is active again.
      // Scope is only overwritten when the caller supplies one, so a plain
      // content refresh keeps the existing scope.
      this.adapter
        .getDatabase()
        .prepare(
          `UPDATE memories
              SET title = ?, content = ?, topics = ?, scope = ?, updated_at = ?, archived_at = NULL
            WHERE slug = ?`,
        )
        .run(
          input.title,
          input.content,
          JSON.stringify(input.topics),
          input.scope ?? existing.scope,
          now,
          input.slug,
        );
    }

    const upserted = this.findBySlug(input.slug);
    if (upserted === null) {
      throw new Error('memory upsert succeeded but row not found');
    }
    return upserted;
  }

  /**
   * Inserts a memory rebuilt from its `.md` mirror, preserving the on-disk
   * timestamps. Idempotent by slug: a row that already exists is left
   * untouched (the cache wins once present), so a rebuild over a populated
   * database is a no-op and does not churn `updated_at`. Only live memories
   * have a mirror (archived/superseded ones are deleted on write), so a
   * rebuilt row is always active. Returns `true` when a row was inserted.
   *
   * @param input - Mirror-sourced memory fields
   * @returns `true` when a new row was inserted, `false` when the slug existed
   */
  insertFromMirror(input: MemoryMirrorInput): boolean {
    const result = this.adapter
      .getDatabase()
      .prepare(
        `INSERT OR IGNORE INTO memories (
           id, slug, title, content, topics, scope, created_by, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        generateUuid(),
        input.slug,
        input.title,
        input.content,
        JSON.stringify(input.topics),
        input.scope,
        input.createdBy,
        input.createdAt,
        input.updatedAt,
      );
    return result.changes > 0;
  }

  /**
   * Deletes a memory by slug.
   *
   * @param slug - Memory slug
   * @returns `true` if a row was deleted, `false` otherwise
   */
  delete(slug: string): boolean {
    const result = this.adapter
      .getDatabase()
      .prepare('DELETE FROM memories WHERE slug = ?')
      .run(slug);
    return result.changes > 0;
  }
}

function rowToMemory(row: MemoryRow): Memory {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    content: row.content,
    topics: JSON.parse(row.topics) as string[],
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at ?? null,
    supersededBy: row.superseded_by ?? null,
    obsoletedBy: row.obsoleted_by ?? null,
    scope: row.scope ?? null,
  };
}
