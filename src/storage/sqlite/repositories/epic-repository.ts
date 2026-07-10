import type { Epic } from '../../../domain/entities/epic.js';
import { EpicState } from '../../../domain/enums/epic-state.js';
import { generateUuid } from '../../../domain/id-generator.js';
import { isoNow } from '../../../utils/iso-now.js';
import type { SqliteAdapter } from '../sqlite-adapter.js';

interface EpicRow {
  readonly id: string;
  readonly key: string;
  readonly project_id: string;
  readonly title: string;
  readonly description: string | null;
  readonly state: string;
  readonly metadata: string;
  readonly created_at: string;
  readonly closed_at: string | null;
  readonly deleted_at: string | null;
}

/**
 * Input for {@link EpicRepository.insert}.
 */
export interface EpicInsertInput {
  readonly key: string;
  readonly projectId: string;
  readonly title: string;
  readonly description?: string | null;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Content columns of an epic that sync rebuild can reconcile from markdown. */
export interface EpicFieldUpdates {
  readonly title?: string;
  readonly description?: string | null;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Persistence for {@link Epic}.
 */
export class EpicRepository {
  constructor(private readonly adapter: SqliteAdapter) {}

  /**
   * Returns the next sequential number to use for an epic key, scoped
   * to a project.
   *
   * @param projectId - Internal project id
   * @returns The next available sequence (starts at 1)
   */
  nextSequence(projectId: string): number {
    const row = this.adapter
      .getDatabase()
      .prepare('SELECT COUNT(*) AS n FROM epics WHERE project_id = ?')
      .get(projectId) as { n: number };
    return row.n + 1;
  }

  /**
   * Looks up an epic by its human-readable key.
   *
   * @param key - Epic key, e.g. `WEBAPP-EPIC-3`
   * @returns The epic or `null`
   */
  findByKey(key: string): Epic | null {
    const row = this.adapter
      .getDatabase()
      .prepare('SELECT * FROM epics WHERE key = ? AND deleted_at IS NULL')
      .get(key) as EpicRow | undefined;
    return row === undefined ? null : rowToEpic(row);
  }

  /**
   * Looks up an epic by its internal id.
   *
   * @param id - Internal UUID of the epic
   * @returns The epic or `null`
   */
  findById(id: string): Epic | null {
    const row = this.adapter
      .getDatabase()
      .prepare('SELECT * FROM epics WHERE id = ? AND deleted_at IS NULL')
      .get(id) as EpicRow | undefined;
    return row === undefined ? null : rowToEpic(row);
  }

  /**
   * Lists every epic of a project ordered by creation.
   *
   * @param projectId - Internal project id
   * @param state - Optional state filter
   * @returns Epics ordered by `created_at`
   */
  findByProject(projectId: string, state?: EpicState): Epic[] {
    const rows =
      state === undefined
        ? (this.adapter
            .getDatabase()
            .prepare(
              `SELECT * FROM epics
                WHERE project_id = ? AND deleted_at IS NULL
                ORDER BY created_at`,
            )
            .all(projectId) as EpicRow[])
        : (this.adapter
            .getDatabase()
            .prepare(
              `SELECT * FROM epics
                WHERE project_id = ? AND state = ? AND deleted_at IS NULL
                ORDER BY created_at`,
            )
            .all(projectId, state) as EpicRow[]);
    return rows.map(rowToEpic);
  }

  /**
   * Inserts a new epic in `OPEN` state.
   *
   * @param input - Epic fields
   * @returns The newly created epic
   */
  insert(input: EpicInsertInput): Epic {
    const id = generateUuid();
    const metadata = JSON.stringify(input.metadata ?? {});

    this.adapter
      .getDatabase()
      .prepare(
        `INSERT INTO epics (id, key, project_id, title, description, state, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, 'OPEN', ?, ?)`,
      )
      .run(
        id,
        input.key,
        input.projectId,
        input.title,
        input.description ?? null,
        metadata,
        isoNow(),
      );

    const created = this.findById(id);
    if (created === null) {
      throw new Error('epic insert succeeded but row not found');
    }
    return created;
  }

  /**
   * Transitions an epic to a new state. Setting `CLOSED` stamps
   * `closed_at` automatically.
   *
   * @param epicId - Internal epic id
   * @param state - Target state
   * @returns The updated epic, or `null` when the id is unknown
   */
  updateState(epicId: string, state: EpicState): Epic | null {
    const isClosing = state === EpicState.Closed;
    const closedClause = isClosing ? `, closed_at = ?` : '';
    const stmt = this.adapter
      .getDatabase()
      .prepare(`UPDATE epics SET state = ?${closedClause} WHERE id = ?`);
    if (isClosing) {
      stmt.run(state, isoNow(), epicId);
    } else {
      stmt.run(state, epicId);
    }
    return this.findById(epicId);
  }

  /**
   * Overwrites an epic's content columns from the given fields, skipping
   * any left `undefined`. Used by sync rebuild to fold content drift from
   * the committed markdown back onto an existing row. `epics` carries no
   * `updated_at`, so none is stamped.
   *
   * @param epicId - Internal epic id
   * @param fields - Content columns to overwrite
   * @returns The reloaded epic
   */
  updateFields(epicId: string, fields: EpicFieldUpdates): Epic {
    const sets: string[] = [];
    const values: unknown[] = [];
    if (fields.title !== undefined) {
      sets.push('title = ?');
      values.push(fields.title);
    }
    if (fields.description !== undefined) {
      sets.push('description = ?');
      values.push(fields.description);
    }
    if (fields.metadata !== undefined) {
      sets.push('metadata = ?');
      values.push(JSON.stringify(fields.metadata));
    }

    if (sets.length > 0) {
      values.push(epicId);
      this.adapter
        .getDatabase()
        .prepare(`UPDATE epics SET ${sets.join(', ')} WHERE id = ?`)
        .run(...values);
    }

    const reloaded = this.findById(epicId);
    if (reloaded === null) {
      throw new Error(`updateFields: epic ${epicId} not found`);
    }
    return reloaded;
  }

  /**
   * Soft-deletes an epic by stamping `deleted_at`. The row stays in
   * SQLite so it can still be audited; every read filters
   * `deleted_at IS NULL`, so the epic disappears from the API.
   *
   * @param epicId - Internal epic id
   * @returns `true` when a row was updated, `false` when the id was
   *   either unknown or already deleted
   */
  softDelete(epicId: string): boolean {
    const result = this.adapter
      .getDatabase()
      .prepare(
        `UPDATE epics
            SET deleted_at = ?
          WHERE id = ? AND deleted_at IS NULL`,
      )
      .run(isoNow(), epicId);
    return result.changes > 0;
  }

  /**
   * Runs the given function inside a SQLite transaction.
   *
   * Mirrors `Database.transaction()` from better-sqlite3 but exposes
   * a typed signature that propagates the function's return value.
   *
   * @param fn - Synchronous callback executed inside the transaction
   * @returns Whatever `fn` returns
   */
  runInTransaction<T>(fn: () => T): T {
    return this.adapter.getDatabase().transaction(fn)();
  }

  /**
   * Runs `fn` inside a `BEGIN IMMEDIATE` transaction, taking the write lock
   * up front. The create path reads `nextSequence` (a `COUNT(*)`) then
   * inserts the derived key; under the default `BEGIN DEFERRED` two processes
   * sharing one `state.db` can both take the COUNT before either writes and
   * mint the same key. `IMMEDIATE` serialises them.
   *
   * @param fn - Synchronous callback executed inside the transaction
   * @returns Whatever `fn` returns
   */
  runInTransactionImmediate<T>(fn: () => T): T {
    return this.adapter.getDatabase().transaction(fn).immediate();
  }

  /**
   * Attaches a task to an epic by setting `tasks.epic_id`.
   *
   * @param epicId - Internal epic id
   * @param taskId - Internal task id
   */
  addTask(epicId: string, taskId: string): void {
    this.adapter
      .getDatabase()
      .prepare('UPDATE tasks SET epic_id = ? WHERE id = ?')
      .run(epicId, taskId);
  }

  /**
   * Removes a task from its epic (clears `tasks.epic_id`).
   *
   * @param taskId - Internal task id
   */
  removeTask(taskId: string): void {
    this.adapter.getDatabase().prepare('UPDATE tasks SET epic_id = NULL WHERE id = ?').run(taskId);
  }

  /**
   * Lists every active task currently assigned to an epic.
   *
   * @param epicId - Internal epic id
   * @returns Task rows (raw) ordered by key
   */
  listTaskKeys(epicId: string): string[] {
    const rows = this.adapter
      .getDatabase()
      .prepare(
        `SELECT key FROM tasks
          WHERE epic_id = ? AND deleted_at IS NULL
          ORDER BY key`,
      )
      .all(epicId) as { key: string }[];
    return rows.map((r) => r.key);
  }
}

function rowToEpic(row: EpicRow): Epic {
  return {
    id: row.id,
    key: row.key,
    projectId: row.project_id,
    title: row.title,
    description: row.description,
    state: row.state as EpicState,
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
    createdAt: row.created_at,
    closedAt: row.closed_at,
    deletedAt: row.deleted_at,
  };
}
