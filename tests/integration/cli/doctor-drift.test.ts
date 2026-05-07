import { copyFileSync, mkdirSync, mkdtempSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { inspectMigrationDrift } from '@/cli/commands/doctor-command.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

const sourceMigrationsDir = path.resolve('src/storage/sqlite/migrations');

/**
 * `inspectMigrationDrift` is the helper `mnema doctor` uses to flag
 * pending or orphan migrations. We exercise both branches against a
 * fresh SQLite database under `os.tmpdir()` plus a hand-managed copy
 * of the migrations folder so tests can mutate it freely.
 */
describe('inspectMigrationDrift', () => {
  let work: string;
  let migrationsCopy: string;
  let dbPath: string;
  let adapter: SqliteAdapter;

  beforeEach(() => {
    work = mkdtempSync(path.join(tmpdir(), 'mnema-doctor-drift-'));
    migrationsCopy = path.join(work, 'migrations');
    mkdirSync(migrationsCopy, { recursive: true });
    for (const file of [
      '001_initial.sql',
      '002_fts_attachments.sql',
      '003_agent_plans_and_identity.sql',
    ]) {
      copyFileSync(path.join(sourceMigrationsDir, file), path.join(migrationsCopy, file));
    }
    dbPath = path.join(work, 'state.db');
    adapter = new SqliteAdapter(dbPath);
  });

  afterEach(() => {
    adapter.close();
    rmSync(work, { recursive: true, force: true });
  });

  it('reports clean when every file on disk is applied', () => {
    new MigrationRunner().run(adapter, migrationsCopy);
    const checks = inspectMigrationDrift(adapter, migrationsCopy);

    expect(checks).toHaveLength(1);
    expect(checks[0]?.name).toBe('migrations applied');
    expect(checks[0]?.ok).toBe(true);
    expect(checks[0]?.detail).toContain('3 applied, 3 on disk');
  });

  it('flags a pending migration when a new file exists but was not applied', () => {
    new MigrationRunner().run(adapter, migrationsCopy);
    // Drop a fresh migration on disk, but do *not* apply it.
    const newFile = path.join(migrationsCopy, '004_drift_demo.sql');
    copyFileSync(path.join(migrationsCopy, '003_agent_plans_and_identity.sql'), newFile);

    const checks = inspectMigrationDrift(adapter, migrationsCopy);
    const applied = checks.find((c) => c.name === 'migrations applied');
    expect(applied?.ok).toBe(false);
    expect(applied?.detail).toContain('004_drift_demo.sql');
  });

  it('flags an orphan version when the file disappears after being applied', () => {
    new MigrationRunner().run(adapter, migrationsCopy);
    // Simulate someone deleting an applied migration from the tree.
    unlinkSync(path.join(migrationsCopy, '003_agent_plans_and_identity.sql'));

    const checks = inspectMigrationDrift(adapter, migrationsCopy);
    const consistency = checks.find((c) => c.name === 'migrations consistent');
    expect(consistency).toBeDefined();
    expect(consistency?.ok).toBe(false);
    expect(consistency?.detail).toContain('3');
  });
});
