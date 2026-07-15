import { Err, Ok, type Result } from '../common/result.js';
import { ErrorCode } from '../errors/error-codes.js';
import type { MnemaError } from '../errors/mnema-error.js';
import type { SqliteAdapter } from '../storage/sqlite/sqlite-adapter.js';

/**
 * Entity kinds searchable via the unified FTS5 index.
 */
export type SearchEntity = 'task' | 'note' | 'decision' | 'skill' | 'memory' | 'observation';

/**
 * One hit from a unified FTS5 search.
 *
 * `entity` is the kind of row matched. `id` is the internal UUID.
 * `key` is the human-readable identifier when one exists (tasks and
 * decisions have keys; skills/memories use their slug; notes and
 * observations have no first-class key — for notes, `parentKey` carries
 * the task they belong to).
 */
export interface SearchHit {
  readonly entity: SearchEntity;
  readonly id: string;
  readonly key: string | null;
  readonly title: string | null;
  readonly snippet: string;
  readonly parentKey: string | null;
}

/**
 * Filter for {@link SearchService.search}.
 */
export interface SearchFilter {
  /** Restrict matches to one or more entity kinds. */
  readonly entities?: readonly SearchEntity[];
  /** Maximum number of hits to return per entity. */
  readonly perEntityLimit?: number;
}

/**
 * Unified FTS5 search across all six text-bearing entities: tasks,
 * decisions, notes, skills, memories and observations.
 *
 * Each entity has its own virtual `*_fts` table with `unicode61
 * remove_diacritics 2`, so queries are case- and diacritic-insensitive.
 * The service queries each table in turn and concatenates the hits in a
 * deterministic order: tasks → decisions → notes → skills → memories →
 * observations (matches what the default CLI rendering expects).
 */
export class SearchService {
  constructor(private readonly adapter: SqliteAdapter) {}

  /**
   * Searches every relevant FTS index for the given query.
   *
   * @param query - FTS5 MATCH expression (e.g. `oauth login`)
   * @param filter - Optional restriction to certain entities + limit
   * @returns Array of matching hits across the requested entities
   */
  search(query: string, filter: SearchFilter = {}): Result<SearchHit[], MnemaError> {
    if (query.trim().length === 0) return Ok([]);
    const allow = new Set<SearchEntity>(
      filter.entities ?? ['task', 'decision', 'note', 'skill', 'memory', 'observation'],
    );
    const limit = filter.perEntityLimit ?? 25;

    try {
      const hits: SearchHit[] = [];
      if (allow.has('task')) hits.push(...this.searchTasks(query, limit));
      if (allow.has('decision')) hits.push(...this.searchDecisions(query, limit));
      if (allow.has('note')) hits.push(...this.searchNotes(query, limit));
      if (allow.has('skill')) hits.push(...this.searchSkills(query, limit));
      if (allow.has('memory')) hits.push(...this.searchMemories(query, limit));
      if (allow.has('observation')) hits.push(...this.searchObservations(query, limit));
      return Ok(hits);
    } catch (error) {
      // FTS5 surfaces user-facing query errors (`fts5: syntax error
      // near ";"`, unmatched quote, etc.) as plain `SqliteError`. We
      // map those to a structured `SEARCH_INVALID_QUERY` so the CLI
      // and MCP layers don't leak stack-traces of the SQLite library.
      // Anything else (storage corruption, programmer error) re-throws.
      const message = error instanceof Error ? error.message : String(error);
      if (/fts5\b|MATCH/i.test(message)) {
        return Err({ kind: ErrorCode.SearchInvalidQuery, query, detail: message });
      }
      if (/database is locked|SQLITE_BUSY/i.test(message)) {
        return Err({ kind: ErrorCode.StorageBusy, detail: message });
      }
      throw error;
    }
  }

  private searchTasks(query: string, limit: number): SearchHit[] {
    const rows = this.adapter
      .getDatabase()
      .prepare(
        `SELECT t.id AS id,
                t.key AS key,
                t.title AS title,
                snippet(tasks_fts, -1, '<mark>', '</mark>', '…', 32) AS snippet
           FROM tasks_fts
           JOIN tasks t ON t.id = tasks_fts.task_id
          WHERE tasks_fts MATCH ?
            AND t.deleted_at IS NULL
          ORDER BY rank
          LIMIT ?`,
      )
      .all(query, limit) as Array<{
      id: string;
      key: string;
      title: string;
      snippet: string;
    }>;
    return rows.map((row) => ({
      entity: 'task' as const,
      id: row.id,
      key: row.key,
      title: row.title,
      snippet: row.snippet,
      parentKey: null,
    }));
  }

  private searchDecisions(query: string, limit: number): SearchHit[] {
    const rows = this.adapter
      .getDatabase()
      .prepare(
        `SELECT d.id AS id,
                d.key AS key,
                d.title AS title,
                snippet(decisions_fts, -1, '<mark>', '</mark>', '…', 32) AS snippet
           FROM decisions_fts
           JOIN decisions d ON d.id = decisions_fts.decision_id
          WHERE decisions_fts MATCH ?
            AND d.deleted_at IS NULL
          ORDER BY rank
          LIMIT ?`,
      )
      .all(query, limit) as Array<{
      id: string;
      key: string;
      title: string;
      snippet: string;
    }>;
    return rows.map((row) => ({
      entity: 'decision' as const,
      id: row.id,
      key: row.key,
      title: row.title,
      snippet: row.snippet,
      parentKey: null,
    }));
  }

  private searchSkills(query: string, limit: number): SearchHit[] {
    // Restrict to the latest version per slug — older versions are
    // intentionally not surfaced in casual search (use `skill_show`
    // with explicit version when you need a specific historical row).
    //
    // Skills_fts columns: skill_id(0, UNINDEXED), slug(1, UNINDEXED),
    // version(2, UNINDEXED), name(3), description(4), content_core(5),
    // content_examples(6). The body is split so example-section tokens
    // (which the linter pushes every skill to carry) rank far below the
    // core body: bm25 weights name/description highest, content_core
    // moderate, and content_examples near-zero. A negative bm25 score is
    // "more relevant", so ordering by the weighted score ascending puts
    // name/description hits above example-only hits. Prefer the
    // content_core snippet for display, then description, then name — an
    // examples-only snippet is never the primary.
    const rows = this.adapter
      .getDatabase()
      .prepare(
        `SELECT s.id AS id,
                s.slug AS slug,
                s.name AS name,
                bm25(skills_fts, 0.0, 0.0, 0.0, 8.0, 4.0, 2.0, 0.25) AS score,
                snippet(skills_fts, 5, '<mark>', '</mark>', '…', 32) AS core_snippet,
                snippet(skills_fts, 4, '<mark>', '</mark>', '…', 32) AS description_snippet,
                snippet(skills_fts, 3, '<mark>', '</mark>', '…', 32) AS name_snippet
           FROM skills_fts
           JOIN skills s ON s.id = skills_fts.skill_id
           JOIN (
             SELECT slug, MAX(version) AS max_version FROM skills GROUP BY slug
           ) latest ON latest.slug = s.slug AND latest.max_version = s.version
          WHERE skills_fts MATCH ?
            AND s.superseded_by IS NULL
          ORDER BY score
          LIMIT ?`,
      )
      .all(query, limit) as Array<{
      id: string;
      slug: string;
      name: string;
      score: number;
      core_snippet: string;
      description_snippet: string;
      name_snippet: string;
    }>;
    return rows.map((row) => ({
      entity: 'skill' as const,
      id: row.id,
      key: row.slug,
      title: row.name,
      snippet:
        row.core_snippet.length > 0
          ? row.core_snippet
          : row.description_snippet.length > 0
            ? row.description_snippet
            : row.name_snippet,
      parentKey: null,
    }));
  }

  private searchMemories(query: string, limit: number): SearchHit[] {
    // Prefer the snippet from the `content` column (col 3 of
    // memories_fts) so search hits surface the body, not the slug. If
    // the match was only in slug/title and content has no excerpt,
    // SQLite returns an empty string — we fall back to the title.
    const rows = this.adapter
      .getDatabase()
      .prepare(
        `SELECT m.id AS id,
                m.slug AS slug,
                m.title AS title,
                snippet(memories_fts, 3, '<mark>', '</mark>', '…', 32) AS content_snippet,
                snippet(memories_fts, 2, '<mark>', '</mark>', '…', 32) AS title_snippet
           FROM memories_fts
           JOIN memories m ON m.id = memories_fts.memory_id
          WHERE memories_fts MATCH ?
            AND m.archived_at IS NULL
            AND m.superseded_by IS NULL
          ORDER BY rank
          LIMIT ?`,
      )
      .all(query, limit) as Array<{
      id: string;
      slug: string;
      title: string;
      content_snippet: string;
      title_snippet: string;
    }>;
    return rows.map((row) => ({
      entity: 'memory' as const,
      id: row.id,
      key: row.slug,
      title: row.title,
      snippet: row.content_snippet.length > 0 ? row.content_snippet : row.title_snippet,
      parentKey: null,
    }));
  }

  private searchObservations(query: string, limit: number): SearchHit[] {
    const rows = this.adapter
      .getDatabase()
      .prepare(
        `SELECT o.id AS id,
                snippet(observations_fts, -1, '<mark>', '</mark>', '…', 32) AS snippet
           FROM observations_fts
           JOIN observations o ON o.id = observations_fts.observation_id
          WHERE observations_fts MATCH ?
            AND o.archived_at IS NULL
          ORDER BY rank
          LIMIT ?`,
      )
      .all(query, limit) as Array<{
      id: string;
      snippet: string;
    }>;
    return rows.map((row) => ({
      entity: 'observation' as const,
      id: row.id,
      key: null,
      title: null,
      snippet: row.snippet,
      parentKey: null,
    }));
  }

  private searchNotes(query: string, limit: number): SearchHit[] {
    const rows = this.adapter
      .getDatabase()
      .prepare(
        `SELECT n.id AS id,
                t.key AS task_key,
                snippet(notes_fts, -1, '<mark>', '</mark>', '…', 32) AS snippet
           FROM notes_fts
           JOIN notes n ON n.id = notes_fts.note_id
           JOIN tasks t ON t.id = n.task_id
          WHERE notes_fts MATCH ?
            AND n.deleted_at IS NULL
          ORDER BY rank
          LIMIT ?`,
      )
      .all(query, limit) as Array<{
      id: string;
      task_key: string;
      snippet: string;
    }>;
    return rows.map((row) => ({
      entity: 'note' as const,
      id: row.id,
      key: null,
      title: null,
      snippet: row.snippet,
      parentKey: row.task_key,
    }));
  }
}
