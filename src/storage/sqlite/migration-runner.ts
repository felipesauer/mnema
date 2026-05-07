import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { SqliteAdapter } from './sqlite-adapter.js';

/**
 * Information about a single migration applied to the database.
 */
export interface AppliedMigration {
  readonly version: number;
  readonly file: string;
}

/**
 * Applies SQL migrations in order, idempotently.
 *
 * Files in the migrations directory must be named `NNN_description.sql`,
 * where the leading digits are the version number. Each migration is
 * responsible for inserting its own row into `schema_migrations`.
 */
export class MigrationRunner {
  /**
   * Runs all pending migrations from the given directory.
   *
   * Migrations already recorded in `schema_migrations` are skipped, so
   * the runner is safe to invoke repeatedly. Each migration is applied
   * inside its own implicit transaction provided by `Database.exec`.
   *
   * @param adapter - SQLite adapter to apply migrations against
   * @param migrationsDir - Absolute path to the directory containing .sql files
   * @returns List of migrations applied during this run, in order
   */
  run(adapter: SqliteAdapter, migrationsDir: string): readonly AppliedMigration[] {
    const database = adapter.getDatabase();
    const applied = new Set(this.loadAppliedVersions(adapter));

    const files = readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    const newlyApplied: AppliedMigration[] = [];
    for (const file of files) {
      const version = parseVersion(file);
      if (applied.has(version)) continue;

      const sql = readFileSync(path.join(migrationsDir, file), 'utf-8');
      database.exec(sql);
      newlyApplied.push({ version, file });
    }

    return newlyApplied;
  }

  /**
   * Lists every `NNN_*.sql` file in the directory, parsed and sorted
   * by version. Used by drift-detection in `mnema doctor`.
   *
   * @param migrationsDir - Absolute path to the migrations directory
   * @returns Migrations parsed from filenames, sorted by version
   */
  listAvailable(migrationsDir: string): readonly AppliedMigration[] {
    return readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .sort()
      .map((file) => ({ version: parseVersion(file), file }));
  }

  /**
   * Returns the sorted list of versions recorded in
   * `schema_migrations`. Empty when the table does not yet exist (the
   * database has not been opened by `run` even once).
   *
   * @param adapter - SQLite adapter to query
   * @returns Sorted list of applied version numbers
   */
  loadApplied(adapter: SqliteAdapter): readonly number[] {
    return this.loadAppliedVersions(adapter);
  }

  /**
   * Reads the list of applied migration versions from the database.
   * Returns an empty array if `schema_migrations` does not yet exist.
   *
   * @param adapter - SQLite adapter to query
   * @returns Sorted list of applied version numbers
   */
  private loadAppliedVersions(adapter: SqliteAdapter): number[] {
    const database = adapter.getDatabase();
    const exists = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
      .get();
    if (exists === undefined) return [];

    const rows = database
      .prepare('SELECT version FROM schema_migrations ORDER BY version')
      .all() as Array<{ version: number }>;
    return rows.map((row) => row.version);
  }
}

function parseVersion(filename: string): number {
  const head = filename.split('_')[0];
  if (head === undefined) {
    throw new Error(`migration filename has no version prefix: ${filename}`);
  }
  const version = Number.parseInt(head, 10);
  if (Number.isNaN(version)) {
    throw new Error(`migration filename does not start with a number: ${filename}`);
  }
  return version;
}
