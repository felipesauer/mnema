import type { Task } from '../../../domain/entities/task.js';
import type { TaskState } from '../../../domain/enums/task-state.js';
import { generateUuid } from '../../../domain/id-generator.js';
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
 * Input shape for {@link TaskRepository.insert}.
 */
export interface TaskInsertInput {
  readonly key: string;
  readonly projectId: string;
  readonly title: string;
  readonly reporterId: string;
  readonly description?: string | null;
  readonly acceptanceCriteria?: readonly string[];
  readonly state?: TaskState;
  readonly estimate?: number | null;
  readonly priority?: number;
  readonly assigneeId?: string | null;
  readonly epicId?: string | null;
  readonly sprintId?: string | null;
  readonly metadata?: Readonly<Record<string, unknown>>;
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
  findByState(state: TaskState): Task[] {
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

    this.adapter
      .getDatabase()
      .prepare(
        `INSERT INTO tasks (
           id, key, project_id, epic_id, sprint_id,
           title, description, acceptance_criteria, state,
           estimate, priority, assignee_id, reporter_id, metadata
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        input.priority ?? 3,
        input.assigneeId ?? null,
        input.reporterId,
        metadata,
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
    newState: TaskState,
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
          SET state = ?, updated_at = datetime('now', 'subsec')
        WHERE id = ?`,
    ).run(newState, taskId);

    const reloaded = this.findById(taskId);
    if (reloaded === null) {
      throw new Error('task disappeared after updateState');
    }
    return { ok: true, task: reloaded };
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
