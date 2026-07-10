import type { Observation } from '../../../domain/entities/observation.js';
import { generateUuid } from '../../../domain/id-generator.js';
import { isoNow } from '../../../utils/iso-now.js';
import type { SqliteAdapter } from '../sqlite-adapter.js';

interface ObservationRow {
  readonly id: string;
  readonly content: string;
  readonly topics: string;
  readonly related_task_id: string | null;
  readonly created_by: string;
  readonly at: string;
  readonly archived_at: string | null;
}

/**
 * Input for {@link ObservationRepository.insert}.
 */
export interface ObservationInsertInput {
  readonly content: string;
  readonly topics: readonly string[];
  readonly relatedTaskId: string | null;
  readonly createdBy: string;
}

/**
 * Input for {@link ObservationRepository.insertFromMirror} — a row rebuilt
 * from its `.md` mirror, so the on-disk id / timestamps are preserved rather
 * than regenerated.
 */
export interface ObservationMirrorInput {
  readonly id: string;
  readonly content: string;
  readonly topics: readonly string[];
  readonly relatedTaskId: string | null;
  readonly createdBy: string;
  readonly at: string;
  readonly archivedAt: string | null;
}

/**
 * Filter set for {@link ObservationRepository.list}.
 */
export interface ObservationListFilters {
  readonly topic?: string;
  readonly relatedTaskId?: string;
  readonly since?: string;
  readonly limit?: number;
  /** Include archived observations (default false). */
  readonly includeArchived?: boolean;
}

/**
 * Persistence for {@link Observation}. Append-only for content — the only
 * mutation is a soft archive that sets `archived_at`.
 */
export class ObservationRepository {
  constructor(private readonly adapter: SqliteAdapter) {}

  /**
   * Inserts an observation row.
   *
   * @param input - Observation fields
   * @returns The newly created observation
   */
  insert(input: ObservationInsertInput): Observation {
    const id = generateUuid();
    const at = isoNow();
    this.adapter
      .getDatabase()
      .prepare(
        `INSERT INTO observations (
           id, content, topics, related_task_id, created_by, at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.content,
        JSON.stringify(input.topics),
        input.relatedTaskId,
        input.createdBy,
        at,
      );

    const row = this.adapter
      .getDatabase()
      .prepare('SELECT * FROM observations WHERE id = ?')
      .get(id) as ObservationRow | undefined;
    if (row === undefined) {
      throw new Error('observation insert succeeded but row not found');
    }
    return rowToObservation(row);
  }

  /**
   * Inserts an observation rebuilt from its `.md` mirror, preserving the
   * on-disk id, timestamps and archived state. Idempotent by id: a row that
   * already exists is left untouched (the cache is the winner once present),
   * so a rebuild over a populated database is a no-op. Returns `true` when a
   * row was actually inserted.
   *
   * @param input - Mirror-sourced observation fields
   * @returns `true` when a new row was inserted, `false` when the id existed
   */
  insertFromMirror(input: ObservationMirrorInput): boolean {
    const result = this.adapter
      .getDatabase()
      .prepare(
        `INSERT OR IGNORE INTO observations (
           id, content, topics, related_task_id, created_by, at, archived_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.content,
        JSON.stringify(input.topics),
        input.relatedTaskId,
        input.createdBy,
        input.at,
        input.archivedAt,
      );
    return result.changes > 0;
  }

  /**
   * Finds an observation by id.
   *
   * @param id - Observation id
   * @returns The observation or `null`
   */
  findById(id: string): Observation | null {
    const row = this.adapter
      .getDatabase()
      .prepare('SELECT * FROM observations WHERE id = ?')
      .get(id) as ObservationRow | undefined;
    return row === undefined ? null : rowToObservation(row);
  }

  /**
   * Lists observations, newest first, with optional filters.
   *
   * @param filters - Optional filter set
   * @returns Observation rows
   */
  list(filters: ObservationListFilters = {}): Observation[] {
    const where: string[] = [];
    const params: unknown[] = [];

    if (filters.relatedTaskId !== undefined) {
      where.push('related_task_id = ?');
      params.push(filters.relatedTaskId);
    }
    if (filters.since !== undefined) {
      where.push('at >= ?');
      params.push(filters.since);
    }
    // Topic is matched in SQL against the JSON `topics` array (not in JS after
    // the fact) so `limit` bounds the rows that actually match. Filtering in JS
    // post-LIMIT under-reported: a query for topic X with limit N could return
    // fewer than N X-rows because non-X rows consumed the LIMIT budget first.
    if (filters.topic !== undefined) {
      where.push('EXISTS (SELECT 1 FROM json_each(topics) WHERE value = ?)');
      params.push(filters.topic);
    }
    // Archived observations drop out of the default listing. Filtered in
    // SQL (not JS like memories) so `limit` counts active rows, not rows
    // that would be discarded afterwards.
    if (filters.includeArchived !== true) {
      where.push('archived_at IS NULL');
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    let limitClause = '';
    if (filters.limit !== undefined) {
      limitClause = 'LIMIT ?';
      params.push(filters.limit);
    }

    const rows = this.adapter
      .getDatabase()
      .prepare(`SELECT * FROM observations ${whereClause} ORDER BY at DESC ${limitClause}`)
      .all(...params) as ObservationRow[];

    return rows.map(rowToObservation);
  }

  /**
   * Archives an observation by id (soft, one-way). Sets `archived_at`; the
   * row and its audit trail survive. No-op returns `false` for an unknown
   * or already-archived id.
   *
   * @param id - Observation id
   * @returns `true` when a row transitioned to archived
   */
  archive(id: string): boolean {
    const result = this.adapter
      .getDatabase()
      .prepare('UPDATE observations SET archived_at = ? WHERE id = ? AND archived_at IS NULL')
      .run(isoNow(), id);
    return result.changes > 0;
  }
}

function rowToObservation(row: ObservationRow): Observation {
  return {
    id: row.id,
    content: row.content,
    topics: JSON.parse(row.topics) as string[],
    relatedTaskId: row.related_task_id,
    createdBy: row.created_by,
    at: row.at,
    archivedAt: row.archived_at ?? null,
  };
}
