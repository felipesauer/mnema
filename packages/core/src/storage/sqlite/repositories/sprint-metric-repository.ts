import type { SprintMetric } from '../../../domain/entities/sprint-metric.js';
import { generateUuid } from '../../../domain/id-generator.js';
import { isoNow } from '../../../utils/iso-now.js';
import type { SqliteAdapter } from '../sqlite-adapter.js';

interface SprintMetricRow {
  readonly id: string;
  readonly sprint_id: string;
  readonly name: string;
  readonly baseline: number | null;
  readonly target: number;
  readonly unit: string | null;
  readonly due_date: string | null;
  readonly created_at: string;
}

/**
 * Input for {@link SprintMetricRepository.insert}.
 */
export interface SprintMetricInsertInput {
  readonly sprintId: string;
  readonly name: string;
  readonly baseline?: number | null;
  readonly target: number;
  readonly unit?: string | null;
  readonly dueDate?: string | null;
}

/**
 * Persistence for {@link SprintMetric} (migration 014). `created_at` is
 * written with {@link isoNow} rather than relying on the SQL default.
 */
export class SprintMetricRepository {
  constructor(private readonly adapter: SqliteAdapter) {}

  /**
   * Returns a metric by id.
   *
   * @param id - Metric id
   * @returns The metric or `null`
   */
  findById(id: string): SprintMetric | null {
    const row = this.adapter
      .getDatabase()
      .prepare('SELECT * FROM sprint_metrics WHERE id = ?')
      .get(id) as SprintMetricRow | undefined;
    return row === undefined ? null : rowToMetric(row);
  }

  /**
   * Lists every metric of a sprint, ordered by name.
   *
   * @param sprintId - Internal sprint id
   * @returns Metrics ordered by name
   */
  findBySprint(sprintId: string): SprintMetric[] {
    const rows = this.adapter
      .getDatabase()
      .prepare('SELECT * FROM sprint_metrics WHERE sprint_id = ? ORDER BY name')
      .all(sprintId) as SprintMetricRow[];
    return rows.map(rowToMetric);
  }

  /**
   * Checks whether a metric with that name already exists on the sprint.
   *
   * @param sprintId - Sprint id
   * @param name - Metric name
   * @returns `true` when present
   */
  exists(sprintId: string, name: string): boolean {
    const row = this.adapter
      .getDatabase()
      .prepare('SELECT 1 FROM sprint_metrics WHERE sprint_id = ? AND name = ?')
      .get(sprintId, name);
    return row !== undefined;
  }

  /**
   * Inserts a new metric row.
   *
   * @param input - Metric fields
   * @returns The created metric
   */
  insert(input: SprintMetricInsertInput): SprintMetric {
    const id = generateUuid();
    this.adapter
      .getDatabase()
      .prepare(
        `INSERT INTO sprint_metrics (id, sprint_id, name, baseline, target, unit, due_date, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.sprintId,
        input.name,
        input.baseline ?? null,
        input.target,
        input.unit ?? null,
        input.dueDate ?? null,
        isoNow(),
      );

    const created = this.findById(id);
    if (created === null) {
      throw new Error('sprint_metric insert succeeded but row not found');
    }
    return created;
  }
}

function rowToMetric(row: SprintMetricRow): SprintMetric {
  return {
    id: row.id,
    sprintId: row.sprint_id,
    name: row.name,
    baseline: row.baseline,
    target: row.target,
    unit: row.unit,
    dueDate: row.due_date,
    createdAt: row.created_at,
  };
}
