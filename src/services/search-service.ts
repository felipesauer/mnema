import type { SqliteAdapter } from '../storage/sqlite/sqlite-adapter.js';

/**
 * One hit from a unified FTS5 search.
 *
 * `entity` is the kind of row matched (`task`, `note`, `decision`),
 * `id` is the internal UUID, and `key` is the human-readable identifier
 * when one exists (tasks and decisions have keys; notes do not — the
 * task they belong to is exposed via `parentKey` in that case).
 */
export interface SearchHit {
  readonly entity: 'task' | 'note' | 'decision';
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
  readonly entities?: readonly ('task' | 'note' | 'decision')[];
  /** Maximum number of hits to return per entity. */
  readonly perEntityLimit?: number;
}

/**
 * Unified FTS5 search across tasks, notes and decisions.
 *
 * Each entity has its own virtual `*_fts` table with `unicode61
 * remove_diacritics 2`, so queries are case- and diacritic-insensitive.
 * The service queries each table in turn and concatenates the hits in
 * a deterministic order: tasks → decisions → notes (matches what the
 * default CLI rendering expects).
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
  search(query: string, filter: SearchFilter = {}): SearchHit[] {
    if (query.trim().length === 0) return [];
    const allow = new Set(filter.entities ?? ['task', 'decision', 'note']);
    const limit = filter.perEntityLimit ?? 25;

    const hits: SearchHit[] = [];
    if (allow.has('task')) hits.push(...this.searchTasks(query, limit));
    if (allow.has('decision')) hits.push(...this.searchDecisions(query, limit));
    if (allow.has('note')) hits.push(...this.searchNotes(query, limit));
    return hits;
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
