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
import { DatabaseSync } from 'node:sqlite';

/**
 * A prepared statement as the stores use it. Rows come back as what the driver makes of them and
 * each store says what it expects of its own, so `get` and `all` are `unknown` and the one place
 * that reads a row names its shape; parameters are the driver's own (positional or one object of
 * named values) and it is the driver that refuses what it cannot bind.
 */
export interface SqliteStatement {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): {
    readonly changes: number | bigint;
    readonly lastInsertRowid: number | bigint;
  };
}

/**
 * The handle the cache is held in: `node:sqlite`'s, which the runtime ships, with `prepare`
 * typed by {@link SqliteStatement}.
 */
export type SqliteDatabase = Omit<DatabaseSync, 'prepare'> & {
  prepare(sql: string): SqliteStatement;
};

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
 * directory that may not exist yet on a fresh checkout, and SQLite
 * fails with a bare error when the folder is missing.
 */
export function openDatabase(path: string): SqliteDatabase {
  if (path !== IN_MEMORY) {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path, {
    enableForeignKeyConstraints: true,
    timeout: BUSY_TIMEOUT_MS,
  });
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  return rememberingStatements(db);
}

/** How many distinct statements a handle remembers before it starts over. */
const REMEMBERED_STATEMENTS = 256;

/**
 * Makes `prepare` hand back the statement it already compiled for the same text.
 *
 * Every keyed read of a projection (`getTask`, `getDecision`, …) prepared its SQL on each call, and
 * preparing is most of what a keyed lookup costs: a census that resolves every rule of a record
 * through up to five of them paid it per address, measured in the order of 100 µs each. A statement is a compiled plan and holds no result, so
 * running it again is what running it once was; one that was prepared over a table a rebuild then
 * dropped is recompiled by SQLite itself on its next run.
 *
 * The memory is bounded: the statements this package builds are a fixed set plus the search's
 * combinations of conditions, and a handle that somehow saw more than the bound starts again.
 */
function rememberingStatements(db: DatabaseSync): DatabaseSync {
  const prepare = db.prepare.bind(db);
  const known = new Map<string, ReturnType<DatabaseSync['prepare']>>();
  db.prepare = (sql: string) => {
    const remembered = known.get(sql);
    if (remembered !== undefined) return remembered;
    const statement = prepare(sql);
    if (known.size >= REMEMBERED_STATEMENTS) known.clear();
    known.set(sql, statement);
    return statement;
  };
  return db;
}

/**
 * Runs `work` as one transaction and returns what it returns; if it throws, everything it wrote
 * is undone and the error goes up.
 *
 * `node:sqlite` has no transaction helper, so this is the one. Called on a handle that is already
 * inside a transaction (`advance` runs inside the refresh's), it is a savepoint instead — the
 * inner failure rolls back to where it began and the outer transaction decides what to do with
 * the error. `immediate` takes the write lock at `BEGIN`, not at the first write: two processes
 * that mean to write serialize there, rather than one of them finding out mid-way that it
 * cannot.
 */
export function inTransaction<T>(
  db: SqliteDatabase,
  work: () => T,
  options: { readonly immediate?: boolean } = {},
): T {
  if (db.isTransaction) {
    db.exec(`SAVEPOINT ${SAVEPOINT}`);
    try {
      const result = work();
      db.exec(`RELEASE ${SAVEPOINT}`);
      return result;
    } catch (error) {
      db.exec(`ROLLBACK TO ${SAVEPOINT}`);
      db.exec(`RELEASE ${SAVEPOINT}`);
      throw error;
    }
  }
  db.exec(options.immediate === true ? 'BEGIN IMMEDIATE' : 'BEGIN');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    // SQLite rolls some failures back by itself; there is then nothing left to undo.
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}

const SAVEPOINT = 'mnema_nested';
