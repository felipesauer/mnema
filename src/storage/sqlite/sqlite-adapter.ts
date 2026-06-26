import { mkdirSync } from 'node:fs';
import path from 'node:path';

import Database, { type Database as DatabaseType } from 'better-sqlite3';

/**
 * Wrapper around `better-sqlite3` with the project's standard configuration.
 *
 * Applies mandatory pragmas on construction:
 * - `journal_mode = WAL`: concurrent readers, single writer
 * - `synchronous = NORMAL`: safe with WAL, faster than FULL
 * - `foreign_keys = ON`: enforce referential integrity
 * - `busy_timeout = 5000`: tolerate brief writer contention
 * - `wal_autocheckpoint = 1000`: keep WAL bounded
 */
export class SqliteAdapter {
  private readonly database: DatabaseType;

  /**
   * Opens the SQLite database at the given path and applies required pragmas.
   *
   * @param databasePath - Absolute path to the SQLite file (or ':memory:')
   */
  constructor(databasePath: string) {
    // `better-sqlite3` throws a raw `Cannot open database because the
    // directory does not exist` when the parent folder is missing. That
    // happens on a fresh clone: the state directory is git-ignored, so a
    // contributor who runs `mnema sync`/`doctor` before `mnema init` hits
    // the bare error. Create the parent up front so any entry point that
    // opens the database — not just `init` — works on a clean checkout.
    if (databasePath !== ':memory:') {
      mkdirSync(path.dirname(databasePath), { recursive: true });
    }
    this.database = new Database(databasePath);
    this.database.pragma('journal_mode = WAL');
    this.database.pragma('synchronous = NORMAL');
    this.database.pragma('foreign_keys = ON');
    this.database.pragma('busy_timeout = 5000');
    this.database.pragma('wal_autocheckpoint = 1000');
  }

  /**
   * Returns the underlying `better-sqlite3` Database instance.
   * Repositories use this to prepare and execute statements.
   *
   * @returns The native Database instance
   */
  getDatabase(): DatabaseType {
    return this.database;
  }

  /**
   * Closes the database connection. Should be called on graceful shutdown.
   */
  close(): void {
    this.database.close();
  }
}
