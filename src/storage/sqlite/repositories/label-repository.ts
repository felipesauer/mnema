import type { Label, LabelCount } from '../../../domain/entities/label.js';
import { generateUuid } from '../../../domain/id-generator.js';
import { isoNow } from '../../../utils/iso-now.js';
import type { SqliteAdapter } from '../sqlite-adapter.js';

interface LabelRow {
  readonly id: string;
  readonly name: string;
  readonly created_at: string;
}

/**
 * Persistence for {@link Label} and the task↔label join.
 *
 * Uses the `labels` catalogue and the `task_labels` join table from
 * migration 017. Normalized on purpose: a label is a row, so per-label
 * counts are a `GROUP BY` ({@link countsByLabel}) rather than a scan,
 * and the join carries `ON DELETE CASCADE` so removing a task or a label
 * leaves no dangling pair.
 *
 * Timestamps are written with {@link isoNow}, matching every other
 * repository, rather than the SQL `strftime` default.
 */
export class LabelRepository {
  constructor(private readonly adapter: SqliteAdapter) {}

  /**
   * Returns the catalogue label by exact name, or `null`.
   *
   * @param name - Label name (case-sensitive)
   */
  findByName(name: string): Label | null {
    const row = this.adapter
      .getDatabase()
      .prepare('SELECT * FROM labels WHERE name = ?')
      .get(name) as LabelRow | undefined;
    return row === undefined ? null : rowToLabel(row);
  }

  /**
   * Returns the catalogue label by name, creating it if absent.
   *
   * The `UNIQUE (name)` constraint makes this safe under a race: the
   * insert is `OR IGNORE`, then we re-read.
   *
   * @param name - Label name (case-sensitive)
   * @returns The existing or newly created label
   */
  findOrCreate(name: string): Label {
    const existing = this.findByName(name);
    if (existing !== null) return existing;
    this.adapter
      .getDatabase()
      .prepare('INSERT OR IGNORE INTO labels (id, name, created_at) VALUES (?, ?, ?)')
      .run(generateUuid(), name, isoNow());
    const created = this.findByName(name);
    if (created === null) {
      throw new Error(`label insert succeeded but row not found: ${name}`);
    }
    return created;
  }

  /**
   * The full catalogue, ordered by name.
   */
  listAll(): Label[] {
    const rows = this.adapter
      .getDatabase()
      .prepare('SELECT * FROM labels ORDER BY name')
      .all() as LabelRow[];
    return rows.map(rowToLabel);
  }

  /**
   * Label names attached to a task, ordered by name.
   *
   * @param taskId - Internal task id
   */
  findNamesByTask(taskId: string): string[] {
    const rows = this.adapter
      .getDatabase()
      .prepare(
        `SELECT l.name AS name
           FROM task_labels tl
           JOIN labels l ON l.id = tl.label_id
          WHERE tl.task_id = ?
          ORDER BY l.name`,
      )
      .all(taskId) as { name: string }[];
    return rows.map((r) => r.name);
  }

  /**
   * Internal task ids that carry a given label.
   *
   * @param name - Label name (case-sensitive)
   */
  findTaskIdsByLabel(name: string): string[] {
    const rows = this.adapter
      .getDatabase()
      .prepare(
        `SELECT tl.task_id AS task_id
           FROM task_labels tl
           JOIN labels l ON l.id = tl.label_id
          WHERE l.name = ?`,
      )
      .all(name) as { task_id: string }[];
    return rows.map((r) => r.task_id);
  }

  /**
   * Replaces the full set of labels on a task with `names` (deduplicated,
   * order-insensitive). Catalogue rows are created on demand; passing
   * `[]` clears every label on the task. Runs in a single transaction so
   * a task never observes a partially-applied set.
   *
   * @param taskId - Internal task id
   * @param names - Desired label names; empty clears all
   * @returns The labels now on the task, ordered by name
   */
  setForTask(taskId: string, names: readonly string[]): string[] {
    const unique = [...new Set(names)];
    const db = this.adapter.getDatabase();
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM task_labels WHERE task_id = ?').run(taskId);
      const link = db.prepare(
        'INSERT OR IGNORE INTO task_labels (task_id, label_id, created_at) VALUES (?, ?, ?)',
      );
      for (const name of unique) {
        const label = this.findOrCreate(name);
        link.run(taskId, label.id, isoNow());
      }
    });
    tx();
    return this.findNamesByTask(taskId);
  }

  /**
   * Per-label counts over the join, restricted to non-deleted tasks.
   * The payoff of the normalized model: a single `GROUP BY` instead of
   * scanning every task's label set.
   *
   * @returns Labels with at least one active task, most-used first then
   *   by name
   */
  countsByLabel(): LabelCount[] {
    const rows = this.adapter
      .getDatabase()
      .prepare(
        `SELECT l.name AS name, COUNT(*) AS count
           FROM task_labels tl
           JOIN labels l ON l.id = tl.label_id
           JOIN tasks t ON t.id = tl.task_id
          WHERE t.deleted_at IS NULL
          GROUP BY l.name
          ORDER BY count DESC, l.name`,
      )
      .all() as { name: string; count: number }[];
    return rows.map((r) => ({ name: r.name, count: r.count }));
  }
}

function rowToLabel(row: LabelRow): Label {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
  };
}
