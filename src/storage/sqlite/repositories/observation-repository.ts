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
 * Filter set for {@link ObservationRepository.list}.
 */
export interface ObservationListFilters {
  readonly topic?: string;
  readonly relatedTaskId?: string;
  readonly since?: string;
  readonly limit?: number;
}

/**
 * Persistence for {@link Observation}. Append-only — no update or delete.
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

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const limit = filters.limit !== undefined ? `LIMIT ${filters.limit}` : '';

    const rows = this.adapter
      .getDatabase()
      .prepare(`SELECT * FROM observations ${whereClause} ORDER BY at DESC ${limit}`)
      .all(...params) as ObservationRow[];

    const observations = rows.map(rowToObservation);
    if (filters.topic === undefined) return observations;
    return observations.filter((o) => o.topics.includes(filters.topic as string));
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
  };
}
