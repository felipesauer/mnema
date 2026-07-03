import type { Task } from '../../../domain/entities/task.js';
import type { TaskState } from '../../../domain/enums/task-state.js';
import { generateUuid } from '../../../domain/id-generator.js';
import { isoNow } from '../../../utils/iso-now.js';
import type { SqliteAdapter } from '../sqlite-adapter.js';

interface TaskRow {
  readonly id: string;
  readonly key: string;
  readonly project_id: string;
  readonly epic_id: string | null;
  readonly sprint_id: string | null;
  readonly title: string;
  readonly description: string | null;
  readonly acceptance_criteria: string;
  readonly state: string;
  readonly estimate: number | null;
  readonly context_budget: number | null;
  readonly priority: number;
  readonly assignee_id: string | null;
  readonly reporter_id: string;
  readonly reopen_count: number;
  readonly metadata: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly closed_at: string | null;
  readonly deleted_at: string | null;
}

/**
 * A lean projection of a task row for aggregate reads (portfolio, inbox)
 * that need only these columns and never touch `acceptance_criteria` or
 * `metadata`. Deliberately skips the two JSON blobs — do NOT substitute
 * this where a full {@link Task} (with acceptanceCriteria/metadata) is
 * required. `state` is `string` (not `TaskState`) to match how the
 * aggregate services compare it.
 */
export interface LeanTask {
  readonly id: string;
  readonly key: string;
  readonly title: string;
  readonly description: string | null;
  readonly state: string;
  readonly priority: number;
  readonly assigneeId: string | null;
  readonly epicId: string | null;
  readonly sprintId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Optional equality filters pushed into SQL by {@link TaskRepository.findActiveLean}.
 * Values must be non-null — this method matches by equality and does not
 * support `IS NULL` filtering (a null here would match no rows and bypass
 * the partial indexes).
 */
export interface LeanTaskFilter {
  readonly state?: string;
  readonly epicId?: string;
  readonly sprintId?: string;
}

/**
 * Input shape for {@link TaskRepository.insert}.
 */
export interface TaskInsertInput {
  readonly key: string;
  readonly projectId: string;
  readonly title: string;
  readonly reporterId: string;
  readonly description?: string | null;
  readonly acceptanceCriteria?: readonly string[];
  readonly state?: string;
  readonly estimate?: number | null;
  readonly contextBudget?: number | null;
  readonly priority?: number;
  readonly assigneeId?: string | null;
  readonly epicId?: string | null;
  readonly sprintId?: string | null;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Fields {@link TaskRepository.updateFields} is allowed to overwrite.
 *
 * Whitelist by design: only attributes that map to first-class columns
 * on the `tasks` table appear here. Annotation-only payload bits
 * (`reason`, `approval_note`, `pr_url`, …) stay in `transitions.payload`
 * and never touch the task record.
 */
export interface TaskFieldUpdates {
  readonly title?: string;
  readonly description?: string | null;
  readonly acceptanceCriteria?: readonly string[];
  readonly estimate?: number | null;
  readonly priority?: number;
  readonly assigneeId?: string | null;
}

/**
 * Reason an `updateState` call failed.
 */
export type UpdateStateFailure =
  | { readonly kind: 'NOT_FOUND' }
  | { readonly kind: 'CONFLICT'; readonly currentUpdatedAt: string };

/**
 * Outcome of a state update attempt.
 */
export type UpdateStateResult =
  | { readonly ok: true; readonly task: Task }
  | { readonly ok: false; readonly reason: UpdateStateFailure };

/**
 * Persistence for {@link Task}. Read/write only — no business rules.
 */
export class TaskRepository {
  constructor(private readonly adapter: SqliteAdapter) {}

  /**
   * Finds a task by its human-readable key, excluding soft-deleted rows.
   *
   * @param key - Task key (e.g., `"WEBAPP-42"`)
   * @returns The task if found, `null` otherwise
   */
  findByKey(key: string): Task | null {
    const row = this.adapter
      .getDatabase()
      .prepare('SELECT * FROM tasks WHERE key = ? AND deleted_at IS NULL')
      .get(key) as TaskRow | undefined;
    return row === undefined ? null : rowToTask(row);
  }

  /**
   * Lists tasks in the given state, ordered by key.
   *
   * @param state - State to filter by
   * @returns Array of matching tasks (possibly empty)
   */
  findByState(state: string): Task[] {
    const rows = this.adapter
      .getDatabase()
      .prepare(
        `SELECT * FROM tasks
          WHERE state = ? AND deleted_at IS NULL
          ORDER BY key`,
      )
      .all(state) as TaskRow[];
    return rows.map(rowToTask);
  }

  /**
   * Lists every active task assigned to an epic, ordered by key.
   *
   * @param epicId - Internal epic id
   * @returns Array of matching tasks (possibly empty)
   */
  findByEpic(epicId: string): Task[] {
    const rows = this.adapter
      .getDatabase()
      .prepare(
        `SELECT * FROM tasks
          WHERE epic_id = ? AND deleted_at IS NULL
          ORDER BY key`,
      )
      .all(epicId) as TaskRow[];
    return rows.map(rowToTask);
  }

  /**
   * Lists every active (non-deleted) task ordered by key.
   *
   * @returns All active tasks
   */
  findAllActive(): Task[] {
    const rows = this.adapter
      .getDatabase()
      .prepare(
        `SELECT * FROM tasks
          WHERE deleted_at IS NULL
          ORDER BY key`,
      )
      .all() as TaskRow[];
    return rows.map(rowToTask);
  }

  /**
   * Lean projection of active tasks for aggregate reads (portfolio,
   * inbox). Selects only the columns those features use and skips the two
   * JSON blobs, so it does NOT `JSON.parse` acceptance_criteria/metadata —
   * unlike {@link findAllActive}. Optional equality filters are pushed
   * into the WHERE so the partial `idx_tasks_state/_epic/_sprint` indexes
   * are eligible (each equality value must be non-null; `deleted_at IS
   * NULL` is always present, matching the indexes' partial predicates).
   *
   * @param filter - Optional non-null equality filters (state/epic/sprint)
   * @returns Lean task rows ordered by key
   */
  findActiveLean(filter: LeanTaskFilter = {}): LeanTask[] {
    const clauses = ['deleted_at IS NULL'];
    const values: string[] = [];
    if (filter.state !== undefined) {
      clauses.push('state = ?');
      values.push(filter.state);
    }
    if (filter.epicId !== undefined) {
      clauses.push('epic_id = ?');
      values.push(filter.epicId);
    }
    if (filter.sprintId !== undefined) {
      clauses.push('sprint_id = ?');
      values.push(filter.sprintId);
    }
    const rows = this.adapter
      .getDatabase()
      .prepare(
        `SELECT id, key, title, description, state, priority,
                assignee_id, epic_id, sprint_id, created_at, updated_at
           FROM tasks
          WHERE ${clauses.join(' AND ')}
          ORDER BY key`,
      )
      .all(...values) as LeanRow[];
    return rows.map(rowToLeanTask);
  }

  /**
   * Returns active tasks whose title matches exactly (case-sensitive)
   * in the given project. Used by importers to skip rows already
   * present without bumping a unique constraint on `title`.
   *
   * @param projectId - Internal project id
   * @param title - Exact title to match
   * @returns Matching active tasks (usually 0 or 1)
   */
  findByTitle(projectId: string, title: string): Task[] {
    const rows = this.adapter
      .getDatabase()
      .prepare(
        `SELECT * FROM tasks
          WHERE project_id = ? AND title = ? AND deleted_at IS NULL
          ORDER BY key`,
      )
      .all(projectId, title) as TaskRow[];
    return rows.map(rowToTask);
  }

  /**
   * Returns the next sequential number to use for a task key in the
   * given project.
   *
   * @param projectId - Internal project id
   * @returns The next available sequence number (starts at 1)
   */
  nextSequence(projectId: string): number {
    const row = this.adapter
      .getDatabase()
      .prepare(`SELECT COUNT(*) AS n FROM tasks WHERE project_id = ?`)
      .get(projectId) as { n: number };
    return row.n + 1;
  }

  /**
   * Inserts a new task. Returns the persisted entity.
   *
   * @param input - Fields required to create a task
   * @returns The newly created task
   */
  insert(input: TaskInsertInput): Task {
    const id = generateUuid();
    const acceptance = JSON.stringify(input.acceptanceCriteria ?? []);
    const metadata = JSON.stringify(input.metadata ?? {});

    const now = isoNow();
    this.adapter
      .getDatabase()
      .prepare(
        `INSERT INTO tasks (
           id, key, project_id, epic_id, sprint_id,
           title, description, acceptance_criteria, state,
           estimate, context_budget, priority, assignee_id, reporter_id, metadata,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.key,
        input.projectId,
        input.epicId ?? null,
        input.sprintId ?? null,
        input.title,
        input.description ?? null,
        acceptance,
        input.state ?? 'DRAFT',
        input.estimate ?? null,
        input.contextBudget ?? null,
        input.priority ?? 3,
        input.assigneeId ?? null,
        input.reporterId,
        metadata,
        now,
        now,
      );

    const created = this.findByKey(input.key);
    if (created === null) {
      throw new Error('task insert succeeded but row not found');
    }
    return created;
  }

  /**
   * Updates the state of a task, optionally enforcing optimistic
   * concurrency via `expected_updated_at`.
   *
   * @param taskId - Internal id of the task
   * @param newState - State to transition into
   * @param expectedUpdatedAt - When provided, only updates the row if
   *   the current `updated_at` matches; otherwise reports a conflict
   * @returns Result describing success or the reason it failed
   */
  updateState(
    taskId: string,
    newState: string,
    expectedUpdatedAt: string | null = null,
  ): UpdateStateResult {
    const db = this.adapter.getDatabase();
    const current = db
      .prepare('SELECT updated_at FROM tasks WHERE id = ? AND deleted_at IS NULL')
      .get(taskId) as { updated_at: string } | undefined;
    if (current === undefined) {
      return { ok: false, reason: { kind: 'NOT_FOUND' } };
    }
    if (expectedUpdatedAt !== null && current.updated_at !== expectedUpdatedAt) {
      return {
        ok: false,
        reason: { kind: 'CONFLICT', currentUpdatedAt: current.updated_at },
      };
    }

    db.prepare(
      `UPDATE tasks
          SET state = ?, updated_at = ?
        WHERE id = ?`,
    ).run(newState, isoNow(), taskId);

    const reloaded = this.findById(taskId);
    if (reloaded === null) {
      throw new Error('task disappeared after updateState');
    }
    return { ok: true, task: reloaded };
  }

  /**
   * Increments `reopen_count` on the given task by 1. Used by
   * `TaskService.transition` when the action name signals a reopen
   * (the workflow's `reopen` action by convention). Idempotent at the
   * SQL level — every call adds 1.
   *
   * @param taskId - Internal task id
   * @returns The reloaded task with the bumped counter
   */
  incrementReopenCount(taskId: string): Task | null {
    this.adapter
      .getDatabase()
      .prepare('UPDATE tasks SET reopen_count = reopen_count + 1 WHERE id = ?')
      .run(taskId);
    return this.findById(taskId);
  }

  /**
   * Applies a partial update to a task's persisted fields. Only the
   * keys present in `fields` are touched; missing keys leave the
   * existing column value alone. Always bumps `updated_at`.
   *
   * Used by {@link TaskService.transition} to fold the validated
   * payload of a transition (e.g. `submit` carries title / description
   * / acceptance_criteria / estimate) back onto the task itself, so a
   * later `task show` reflects what the user actually declared. The
   * full original payload still lives in `transitions.payload` for
   * audit purposes.
   *
   * @param taskId - Internal id of the task
   * @param fields - Subset of fields to overwrite
   * @returns The reloaded task
   */
  updateFields(taskId: string, fields: TaskFieldUpdates): Task {
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
    if (fields.acceptanceCriteria !== undefined) {
      sets.push('acceptance_criteria = ?');
      values.push(JSON.stringify(fields.acceptanceCriteria));
    }
    if (fields.estimate !== undefined) {
      sets.push('estimate = ?');
      values.push(fields.estimate);
    }
    if (fields.priority !== undefined) {
      sets.push('priority = ?');
      values.push(fields.priority);
    }
    if (fields.assigneeId !== undefined) {
      sets.push('assignee_id = ?');
      values.push(fields.assigneeId);
    }

    if (sets.length === 0) {
      const reloaded = this.findById(taskId);
      if (reloaded === null) {
        throw new Error(`updateFields: task ${taskId} not found`);
      }
      return reloaded;
    }

    sets.push('updated_at = ?');
    values.push(isoNow());
    values.push(taskId);

    this.adapter
      .getDatabase()
      .prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`)
      .run(...values);

    const reloaded = this.findById(taskId);
    if (reloaded === null) {
      throw new Error(`updateFields: task ${taskId} disappeared after update`);
    }
    return reloaded;
  }

  /**
   * Counts the number of tasks visible (not soft-deleted).
   *
   * @returns Total number of active tasks
   */
  countActive(): number {
    const row = this.adapter
      .getDatabase()
      .prepare('SELECT COUNT(*) AS n FROM tasks WHERE deleted_at IS NULL')
      .get() as { n: number };
    return row.n;
  }

  /**
   * Looks up a task by key including soft-deleted rows.
   *
   * Used by the restore path so a deleted task can still be located by
   * its human key. Active reads keep using {@link findByKey}.
   *
   * @param key - Task key (e.g. `WEBAPP-42`)
   * @returns The task (active or soft-deleted) or `null`
   */
  findByKeyIncludingDeleted(key: string): Task | null {
    const row = this.adapter.getDatabase().prepare('SELECT * FROM tasks WHERE key = ?').get(key) as
      | TaskRow
      | undefined;
    return row === undefined ? null : rowToTask(row);
  }

  /**
   * Soft-deletes a task by stamping `deleted_at`. The row stays in
   * SQLite so it can still be restored or audited.
   *
   * @param taskId - Internal task id
   * @returns `true` when a row was updated, `false` when the id was
   *   either unknown or already deleted
   */
  softDelete(taskId: string): boolean {
    const result = this.adapter
      .getDatabase()
      .prepare(
        `UPDATE tasks
            SET deleted_at = ?
          WHERE id = ? AND deleted_at IS NULL`,
      )
      .run(isoNow(), taskId);
    return result.changes > 0;
  }

  /**
   * Restores a previously soft-deleted task by clearing `deleted_at`.
   *
   * @param taskId - Internal task id
   * @returns `true` when a row was updated, `false` when the id was
   *   unknown or already active
   */
  restore(taskId: string): boolean {
    const result = this.adapter
      .getDatabase()
      .prepare('UPDATE tasks SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL')
      .run(taskId);
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
   * Returns a task by its internal id, or `null` if absent.
   *
   * @param id - Internal UUID of the task
   * @returns The task or `null`
   */
  findById(id: string): Task | null {
    const row = this.adapter
      .getDatabase()
      .prepare('SELECT * FROM tasks WHERE id = ? AND deleted_at IS NULL')
      .get(id) as TaskRow | undefined;
    return row === undefined ? null : rowToTask(row);
  }
}

function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    key: row.key,
    projectId: row.project_id,
    epicId: row.epic_id,
    sprintId: row.sprint_id,
    title: row.title,
    description: row.description,
    acceptanceCriteria: JSON.parse(row.acceptance_criteria) as string[],
    state: row.state as TaskState,
    estimate: row.estimate,
    contextBudget: row.context_budget,
    priority: row.priority,
    assigneeId: row.assignee_id,
    reporterId: row.reporter_id,
    reopenCount: row.reopen_count,
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at,
    deletedAt: row.deleted_at,
  };
}

/** The columns {@link TaskRepository.findActiveLean} projects. */
interface LeanRow {
  readonly id: string;
  readonly key: string;
  readonly title: string;
  readonly description: string | null;
  readonly state: string;
  readonly priority: number;
  readonly assignee_id: string | null;
  readonly epic_id: string | null;
  readonly sprint_id: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

/** Maps a projected row to {@link LeanTask} — no JSON.parse (that's the point). */
function rowToLeanTask(row: LeanRow): LeanTask {
  return {
    id: row.id,
    key: row.key,
    title: row.title,
    description: row.description,
    state: row.state,
    priority: row.priority,
    assigneeId: row.assignee_id,
    epicId: row.epic_id,
    sprintId: row.sprint_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
