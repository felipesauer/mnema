/**
 * Persisting and querying the task projection in SQLite.
 *
 * The pure fold ({@link projectTasks}) produces task state; this module writes
 * that state into the `tasks` table and reads it back. Keeping persistence
 * separate from the fold means the projection logic is testable without a
 * database, and the SQL lives in one place.
 */

import type { SqliteDatabase } from '../db/sqlite.js';
import type { TaskProjection } from './task.js';

/** The `tasks` row shape as stored. */
interface TaskRow {
  readonly id: string;
  readonly title: string;
  readonly state: string;
  readonly created_at: string;
  readonly updated_at: string;
}

/**
 * Inserts the given task projections. Called during a rebuild after the table
 * has been recreated empty, so every task is a fresh insert. The caller owns
 * the surrounding transaction.
 */
export function materializeTasks(db: SqliteDatabase, tasks: Iterable<TaskProjection>): void {
  const insert = db.prepare(
    `INSERT INTO tasks (id, title, state, created_at, updated_at)
     VALUES (@id, @title, @state, @createdAt, @updatedAt)`,
  );
  for (const task of tasks) {
    insert.run(task);
  }
}

/** Reads one task by id, or null if it is not projected. */
export function getTask(db: SqliteDatabase, id: string): TaskProjection | null {
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined;
  return row === undefined ? null : toProjection(row);
}

/** Lists all projected tasks, ordered by id for a stable result. */
export function listTasks(db: SqliteDatabase): TaskProjection[] {
  const rows = db.prepare('SELECT * FROM tasks ORDER BY id').all() as TaskRow[];
  return rows.map(toProjection);
}

/** Lists tasks currently in the given state. */
export function listTasksByState(db: SqliteDatabase, state: string): TaskProjection[] {
  const rows = db
    .prepare('SELECT * FROM tasks WHERE state = ? ORDER BY id')
    .all(state) as TaskRow[];
  return rows.map(toProjection);
}

function toProjection(row: TaskRow): TaskProjection {
  return {
    id: row.id,
    title: row.title,
    state: row.state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
