import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { Database as DatabaseType } from 'better-sqlite3';

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
  run(
    adapter: SqliteAdapter,
    migrationsDir: string | readonly string[],
  ): readonly AppliedMigration[] {
    const database = adapter.getDatabase();
    const applied = new Set(this.loadAppliedVersions(adapter));

    const sources = collectMigrationFiles(migrationsDir);

    // Two distinct filenames sharing a version prefix (e.g. 016_alice.sql and
    // 016_bob.sql — what sibling branches produce when each claims the next
    // slot) would otherwise be applied in turn; the second trips a
    // schema_migrations PRIMARY KEY violation mid-run, aborting init. Detect it
    // up front with a clear diagnostic rather than letting one silently win.
    const seenVersions = new Map<number, string>();
    for (const { file } of sources) {
      const version = parseVersion(file);
      // Only an UNAPPLIED collision is a real hazard (two sibling files racing
      // for the next slot mid-init). A version already in schema_migrations is
      // a no-op for both files — e.g. a stray project-local `016_*.sql` left
      // over after the bundled set advanced past 16 — so it must not brick an
      // otherwise up-to-date `mnema migrate`.
      if (applied.has(version)) continue;
      const prior = seenVersions.get(version);
      if (prior !== undefined && prior !== file) {
        throw new Error(`duplicate migration version ${version}: ${prior} vs ${file}`);
      }
      seenVersions.set(version, file);
    }

    const newlyApplied: AppliedMigration[] = [];
    for (const { dir, file } of sources) {
      const version = parseVersion(file);
      if (applied.has(version)) continue;

      const sql = readFileSync(path.join(dir, file), 'utf-8');
      this.applyOne(database, sql);
      newlyApplied.push({ version, file });
      applied.add(version);
    }

    return newlyApplied;
  }

  /**
   * Applies one migration script. Schema-rewrite migrations that
   * need to drop and recreate tables also need foreign-key
   * enforcement temporarily disabled — the pragma cannot toggle
   * inside a transaction, so they must opt in via a header comment:
   *
   * ```
   * -- mnema:disable-foreign-keys
   * BEGIN;
   * ...
   * COMMIT;
   * ```
   *
   * Migrations without that opt-in keep the simple
   * `database.exec(sql)` path, which is what every additive
   * migration (CREATE TABLE / ALTER TABLE ADD COLUMN / CREATE
   * INDEX) wants — and crucially, the path that the original 001
   * relies on, since it sets PRAGMAs that cannot run inside a
   * transaction.
   */
  private applyOne(database: DatabaseType, sql: string): void {
    const disableForeignKeys = /^\s*--\s*mnema:disable-foreign-keys/m.test(sql);
    if (!disableForeignKeys) {
      database.exec(sql);
      return;
    }

    const previousFk = database.pragma('foreign_keys', { simple: true }) as 0 | 1;
    if (previousFk === 1) database.pragma('foreign_keys = OFF');
    try {
      database.exec(sql);
    } finally {
      if (previousFk === 1) database.pragma('foreign_keys = ON');
    }
  }

  /**
   * Lists every `NNN_*.sql` file in the directory, parsed and sorted
   * by version. Used by drift-detection in `mnema doctor`.
   *
   * @param migrationsDir - Absolute path to the migrations directory
   * @returns Migrations parsed from filenames, sorted by version
   */
  listAvailable(migrationsDir: string | readonly string[]): readonly AppliedMigration[] {
    return collectMigrationFiles(migrationsDir).map(({ file }) => ({
      version: parseVersion(file),
      file,
    }));
  }

  /**
   * Reports migrations that exist on disk but are not yet recorded in
   * `schema_migrations`. Read-only — does not apply anything. Returns
   * empty when the database has never been initialised (no
   * `schema_migrations` table), since there is no drift to compare.
   *
   * @param adapter - SQLite adapter to inspect
   * @param migrationsDir - Absolute path to the migrations directory
   * @returns Sorted list of pending migrations (empty when in sync)
   */
  detectDrift(
    adapter: SqliteAdapter,
    migrationsDir: string | readonly string[],
  ): readonly AppliedMigration[] {
    const applied = new Set(this.loadAppliedVersions(adapter));
    if (applied.size === 0) return [];

    return this.listAvailable(migrationsDir).filter(({ version }) => !applied.has(version));
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

/**
 * Lists every `NNN_*.sql` file under one or more directories, merged
 * by ascending version. Used by the runner so a project's local
 * migrations (under `.mnema/migrations/`) ride alongside the bundled
 * set (under the package's `dist/storage/sqlite/migrations/`).
 *
 * - String input is treated as a single directory (legacy shape;
 *   most tests still call it this way).
 * - Array input is iterated in order; missing directories are
 *   silently skipped so a project that has not generated any custom
 *   migration is a no-op.
 * - Files are de-duplicated by name: if both the bundled and the
 *   project-local directory ship the same filename, the bundled one
 *   wins. The `MigrationRunner` then skips already-applied versions
 *   so duplicates never run twice.
 */
function collectMigrationFiles(
  dirs: string | readonly string[],
): readonly { dir: string; file: string }[] {
  const list = typeof dirs === 'string' ? [dirs] : dirs;
  const seen = new Set<string>();
  const acc: { dir: string; file: string }[] = [];
  for (const dir of list) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.sql')) continue;
      if (seen.has(file)) continue;
      seen.add(file);
      acc.push({ dir, file });
    }
  }
  // Sort by filename (== version prefix) ascending.
  acc.sort((a, b) => a.file.localeCompare(b.file));
  return acc;
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
