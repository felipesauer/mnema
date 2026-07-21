/**
 * The projection cache schema — one flat baseline, never a chain of migrations.
 *
 * Because the cache is derived from the chain and thrown away when its shape
 * changes, the schema is an implementation detail, not a durable contract.
 * There is no version table and no upgrade path: the tables are created if
 * absent, and a shape change is a drop-and-replay, not a migration. Adding a
 * column means editing the CREATE below and rebuilding.
 *
 * Every table here is a PROJECTION of events. It holds current state for fast
 * relational queries; the events remain the source of truth in the chain.
 */

import type { SqliteDatabase } from './sqlite.js';

/**
 * The projection tables, in the order they are created and the reverse order
 * they are dropped. Listing them here is what lets a rebuild wipe the cache
 * without dropping anything the chain did not put there.
 */
export const PROJECTION_TABLES = ['tasks'] as const;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tasks (
  -- The task's id (the event subject). One row per task.
  id         TEXT PRIMARY KEY NOT NULL,
  -- The title from task.created.
  title      TEXT NOT NULL,
  -- Current state: the 'to' of the task's last transition.
  state      TEXT NOT NULL,
  -- 'at' of the birth (task.created), and of the last transition.
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_tasks_state ON tasks (state);
`;

/** Creates the projection tables if they are absent. Idempotent. */
export function ensureSchema(db: SqliteDatabase): void {
  db.exec(SCHEMA);
}

/**
 * Drops every projection table. The counterpart to {@link ensureSchema}: a
 * rebuild drops, recreates, and replays. Dropping only the listed tables keeps
 * the operation scoped to the cache's own projections.
 */
export function dropProjections(db: SqliteDatabase): void {
  for (let i = PROJECTION_TABLES.length - 1; i >= 0; i -= 1) {
    db.exec(`DROP TABLE IF EXISTS ${PROJECTION_TABLES[i]};`);
  }
}
