import type { Epic } from '../../../domain/entities/epic.js';
import { type AliasResolution, resolveAlias } from '../../../domain/entity-alias.js';
import { EpicState } from '../../../domain/enums/epic-state.js';
import { generateUuid } from '../../../domain/id-generator.js';
import { isoNow } from '../../../utils/iso-now.js';
import type { SqliteAdapter } from '../sqlite-adapter.js';

interface EpicRow {
  readonly id: string;
  readonly project_id: string;
  readonly title: string;
  readonly description: string | null;
  readonly state: string;
  readonly metadata: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly closed_at: string | null;
  readonly deleted_at: string | null;
}

/**
 * Result of {@link EpicRepository.updateState} — mirrors the shape used by
 * tasks/sprints so callers can branch on `kind` consistently.
 */
export type UpdateEpicStateResult =
  | { readonly ok: true; readonly epic: Epic }
  | { readonly ok: false; readonly reason: { readonly kind: 'NOT_FOUND' } }
  | {
      readonly ok: false;
      readonly reason: { readonly kind: 'CONFLICT'; readonly currentUpdatedAt: string };
    };

/**
 * Input for {@link EpicRepository.insert}.
 */
export interface EpicInsertInput {
  /** Committed identity, preserved on a clone rebuild; minted when omitted. */
  readonly id?: string;
  readonly projectId: string;
  readonly title: string;
  readonly description?: string | null;
  readonly metadata?: Readonly<Record<string, unknown>>;
  /**
   * State to create in — defaults to OPEN. A clone rebuild passes the
   * committed state so it lands final in one insert, without an updateState
   * that would stamp a fresh closed_at.
   */
  readonly state?: string;
  /** Committed timestamps, preserved on a clone rebuild; default to now/null. */
  readonly createdAt?: string;
  readonly closedAt?: string | null;
}

/** Content columns of an epic that sync rebuild can reconcile from markdown. */
export interface EpicFieldUpdates {
  readonly title?: string;
  readonly description?: string | null;
  readonly metadata?: Readonly<Record<string, unknown>>;
  /**
   * Committed close timestamp, reconciled from the mirror on rebuild — the
   * `.md` is authoritative for it. Distinct from the fresh `now` that
   * {@link EpicRepository.updateState} stamps on a live close: a realign must
   * carry the ORIGINAL close time, not the rebuild's clock.
   */
  readonly closedAt?: string | null;
}

/**
 * Persistence for {@link Epic}.
 */
export class EpicRepository {
  constructor(private readonly adapter: SqliteAdapter) {}

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
   * Resolves a user-typed handle — full id, full or partial alias, or a bare
   * hash prefix — to a single live epic id, or reports ambiguity/absence.
   *
   * @param query - The handle to resolve (id, alias, or hash prefix)
   */
  resolve(query: string): AliasResolution {
    const rows = this.adapter
      .getDatabase()
      .prepare('SELECT id FROM epics WHERE deleted_at IS NULL')
      .all() as Array<{ id: string }>;
    return resolveAlias(
      query,
      rows.map((r) => ({ kind: 'epic', id: r.id })),
    );
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
    const id = input.id ?? generateUuid();
    const metadata = JSON.stringify(input.metadata ?? {});
    // A new epic is last-touched at creation; seed updated_at from created_at
    // (a clone rebuild passes the committed created_at, so both stay aligned).
    const createdAt = input.createdAt ?? isoNow();

    this.adapter
      .getDatabase()
      .prepare(
        `INSERT INTO epics (id, project_id, title, description, state, metadata, created_at, updated_at, closed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.projectId,
        input.title,
        input.description ?? null,
        input.state ?? 'OPEN',
        metadata,
        createdAt,
        createdAt,
        input.closedAt ?? null,
      );

    const created = this.findById(id);
    if (created === null) {
      throw new Error('epic insert succeeded but row not found');
    }
    return created;
  }

  /**
   * Transitions an epic to a new state, stamping `updated_at`. Closing
   * stamps `closed_at`; reopening (back to `OPEN`) clears it. Supports
   * optimistic concurrency via `expectedUpdatedAt` — when supplied, the
   * update only proceeds if the current `updated_at` matches.
   *
   * @param epicId - Internal epic id
   * @param state - Target state
   * @param expectedUpdatedAt - Optional optimistic-concurrency token
   * @returns Result describing success or the reason it failed
   */
  updateState(
    epicId: string,
    state: EpicState,
    expectedUpdatedAt: string | null = null,
  ): UpdateEpicStateResult {
    const db = this.adapter.getDatabase();
    const current = db
      .prepare('SELECT updated_at FROM epics WHERE id = ? AND deleted_at IS NULL')
      .get(epicId) as { updated_at: string } | undefined;
    if (current === undefined) {
      return { ok: false, reason: { kind: 'NOT_FOUND' } };
    }
    if (expectedUpdatedAt !== null && current.updated_at !== expectedUpdatedAt) {
      return {
        ok: false,
        reason: { kind: 'CONFLICT', currentUpdatedAt: current.updated_at },
      };
    }

    const now = isoNow();
    if (state === EpicState.Closed) {
      db.prepare(`UPDATE epics SET state = ?, closed_at = ?, updated_at = ? WHERE id = ?`).run(
        state,
        now,
        now,
        epicId,
      );
    } else {
      // Reopening (or any non-closing transition) clears closed_at so a
      // reopened epic is not left with a stale close timestamp.
      db.prepare(`UPDATE epics SET state = ?, closed_at = NULL, updated_at = ? WHERE id = ?`).run(
        state,
        now,
        epicId,
      );
    }
    const reloaded = this.findById(epicId);
    if (reloaded === null) {
      throw new Error('epic disappeared after updateState');
    }
    return { ok: true, epic: reloaded };
  }

  /**
   * Overwrites an epic's content columns from the given fields, skipping
   * any left `undefined`, and stamps `updated_at`. Used by sync rebuild to
   * fold content drift from the committed markdown back onto an existing row.
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
    if (fields.closedAt !== undefined) {
      sets.push('closed_at = ?');
      values.push(fields.closedAt);
    }

    if (sets.length > 0) {
      sets.push('updated_at = ?');
      values.push(isoNow());
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
   * up front so a read-then-write create path cannot race a second process
   * sharing the same `state.db`.
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
   * Lists the ids of every active task currently assigned to an epic.
   *
   * @param epicId - Internal epic id
   * @returns Task ids ordered by creation
   */
  listTaskIds(epicId: string): string[] {
    const rows = this.adapter
      .getDatabase()
      .prepare(
        `SELECT id FROM tasks
          WHERE epic_id = ? AND deleted_at IS NULL
          ORDER BY created_at`,
      )
      .all(epicId) as { id: string }[];
    return rows.map((r) => r.id);
  }
}

function rowToEpic(row: EpicRow): Epic {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    description: row.description,
    state: row.state as EpicState,
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at,
    deletedAt: row.deleted_at,
  };
}
