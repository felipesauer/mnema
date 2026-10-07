/**
 * The SQLite handle behind the projection cache, with the pragmas a
 * concurrent-reader, single-writer local cache wants.
 *
 * This database is a PURE CACHE: every row in it is derived from the chain and
 * can be thrown away and rebuilt at any time. It is never the source of truth
 * and is never committed. So there are no data migrations here — when the shape
 * changes, the tables are dropped and replayed, not migrated. The pragmas below
 * are about safe, fast local access, nothing more.
 */

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database, { type Database as SqliteDatabase } from 'better-sqlite3';

/** How long a blocked writer waits on a busy database before giving up. */
export const BUSY_TIMEOUT_MS = 5000;

/** An in-memory database path — a cache that lives only for the process. */
export const IN_MEMORY = ':memory:';

/**
 * Opens the cache database at `path` (or `:memory:`) with the standard pragmas:
 *   - `journal_mode = WAL`: concurrent readers alongside one writer.
 *   - `synchronous = NORMAL`: safe under WAL, faster than FULL. A crash can lose
 *     the last transaction — acceptable, because the cache is rebuilt from the
 *     chain, which is the durable record.
 *   - `foreign_keys = ON`: enforce referential integrity between cache tables.
 *   - `busy_timeout`: tolerate brief writer contention instead of erroring.
 *
 * Creates the parent directory first: the cache lives under a git-ignored state
 * directory that may not exist yet on a fresh checkout, and better-sqlite3
 * throws a bare error when the folder is missing.
 */
export function openDatabase(path: string): SqliteDatabase {
  if (path !== IN_MEMORY) {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
  return rememberingStatements(db);
}

/** How many distinct statements a handle remembers before it starts over. */
const REMEMBERED_STATEMENTS = 256;

/**
 * Makes `prepare` hand back the statement it already compiled for the same text.
 *
 * Every keyed read of a projection (`getTask`, `getDecision`, …) prepared its SQL on each call, and
 * preparing is most of what a keyed lookup costs: a census that resolves every rule of a record
 * through up to five of them paid it per address, measured in the order of 100 µs each
 *. A statement is a compiled plan and holds no result, so
 * running it again is what running it once was; one that was prepared over a table a rebuild then
 * dropped is recompiled by SQLite itself on its next run.
 *
 * The memory is bounded: the statements this package builds are a fixed set plus the search's
 * combinations of conditions, and a handle that somehow saw more than the bound starts again.
 */
function rememberingStatements(db: SqliteDatabase): SqliteDatabase {
  const prepare = db.prepare.bind(db) as (sql: string) => ReturnType<SqliteDatabase['prepare']>;
  const known = new Map<string, ReturnType<SqliteDatabase['prepare']>>();
  db.prepare = ((sql: string) => {
    const remembered = known.get(sql);
    if (remembered !== undefined) return remembered;
    const statement = prepare(sql);
    if (known.size >= REMEMBERED_STATEMENTS) known.clear();
    known.set(sql, statement);
    return statement;
  }) as SqliteDatabase['prepare'];
  return db;
}

/** Re-exported so callers type against the driver without importing it directly. */
export type { SqliteDatabase };
