import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Database as DatabaseType } from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

const migrationsDir = path.resolve('packages/core/src/storage/sqlite/migrations');

/** Reads the CREATE sql of a schema object, or null when absent. */
function schemaSql(db: DatabaseType, name: string): string | null {
  const row = db.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(name) as
    | { sql: string }
    | undefined;
  return row?.sql ?? null;
}

describe('MigrationRunner (001 baseline)', () => {
  let tempRoot: string;
  let dbPath: string;
  let adapter: SqliteAdapter;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-mig-'));
    dbPath = path.join(tempRoot, 'state.db');
    adapter = new SqliteAdapter(dbPath);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('applies every pending migration on an empty database', () => {
    const applied = new MigrationRunner().run(adapter, migrationsDir);
    expect(applied.map((a) => a.version)).toEqual([1, 2]);

    const versions = adapter
      .getDatabase()
      .prepare('SELECT version FROM schema_migrations ORDER BY version')
      .all() as Array<{ version: number }>;
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
  });

  it('is idempotent — running twice does not duplicate', () => {
    const runner = new MigrationRunner();
    runner.run(adapter, migrationsDir);
    const second = runner.run(adapter, migrationsDir);
    expect(second).toEqual([]);
  });

  it('seeds the audit_state singleton row', () => {
    new MigrationRunner().run(adapter, migrationsDir);
    const row = adapter.getDatabase().prepare('SELECT id, event_count FROM audit_state').get() as {
      id: number;
      event_count: number;
    };
    expect(row).toEqual({ id: 1, event_count: 0 });
  });

  it('creates the expected tables, the FTS virtual tables and the upgrade ledger', () => {
    new MigrationRunner().run(adapter, migrationsDir);
    const names = (
      adapter
        .getDatabase()
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all() as Array<{ name: string }>
    ).map((r) => r.name);

    for (const expected of [
      'actors',
      'agent_plans',
      'agent_runs',
      'anchors',
      'applied_upgrades',
      'audit_state',
      'decisions',
      'dependencies',
      'epics',
      'memories',
      'observations',
      'projects',
      'skills',
      'sprints',
      'tasks',
      'tasks_fts',
      'skills_fts',
      'transitions',
    ]) {
      expect(names, `missing table ${expected}`).toContain(expected);
    }
    // Retired by the squash: the dead workspace_config and the old
    // remediation ledger (its successor is applied_upgrades).
    expect(names).not.toContain('workspace_config');
    expect(names).not.toContain('applied_remediations');
  });

  it('bakes the final CHECK vocabularies into the baseline (no re-widening migrations)', () => {
    new MigrationRunner().run(adapter, migrationsDir);
    const db = adapter.getDatabase();
    // provenance_links accepts the 'skill' kind (formerly migration 028).
    expect(schemaSql(db, 'provenance_links')).toContain("'skill'");
    // sprints accept the CANCELED state (formerly migration 034).
    expect(schemaSql(db, 'sprints')).toContain("'CANCELED'");
    // tasks carry NO state CHECK — the state machine is the only validator
    // (formerly migration 004).
    expect(schemaSql(db, 'tasks')).not.toMatch(/state\s+TEXT[^,]*CHECK/i);
  });

  it('keeps the append-only transitions trigger and the title index', () => {
    new MigrationRunner().run(adapter, migrationsDir);
    const db = adapter.getDatabase();
    const triggers = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all() as Array<{
        name: string;
      }>
    ).map((r) => r.name);
    expect(triggers.some((n) => n.includes('transitions'))).toBe(true);
    expect(schemaSql(db, 'idx_tasks_title')).not.toBeNull();
  });

  describe('the disable-foreign-keys header mechanism (kept for future rewrites)', () => {
    /** Stages a writable migrations dir seeded with the bundled baseline. */
    function stageDir(): string {
      const staged = path.join(tempRoot, 'staged-migrations');
      mkdirSync(staged, { recursive: true });
      for (const file of readdirSync(migrationsDir)) {
        copyFileSync(path.join(migrationsDir, file), path.join(staged, file));
      }
      return staged;
    }

    it('applies a self-transacting rewrite migration with FKs temporarily off', () => {
      const staged = stageDir();
      const runner = new MigrationRunner();
      runner.run(adapter, staged);

      // A synthetic table-rewrite in the exact shape historical rewrites
      // used: FK toggle via the header, its own BEGIN/COMMIT. Uses the next
      // free version above the bundled set.
      writeFileSync(
        path.join(staged, '003_synthetic_rewrite.sql'),
        [
          '-- mnema:disable-foreign-keys',
          'BEGIN;',
          'CREATE TABLE anchors_new AS SELECT * FROM anchors;',
          'DROP TABLE anchors;',
          'ALTER TABLE anchors_new RENAME TO anchors;',
          'INSERT INTO schema_migrations (version) VALUES (3);',
          'COMMIT;',
          '',
        ].join('\n'),
      );

      const applied = runner.run(adapter, staged);
      expect(applied.map((a) => a.version)).toEqual([3]);
      // FK enforcement is restored afterwards.
      const fk = adapter.getDatabase().pragma('foreign_keys', { simple: true });
      expect(fk).toBe(1);
    });

    it('rolls back a failing self-transacting migration atomically (no partial schema, no stamp)', () => {
      const staged = stageDir();
      const runner = new MigrationRunner();
      runner.run(adapter, staged);

      writeFileSync(
        path.join(staged, '003_synthetic_failure.sql'),
        [
          '-- mnema:disable-foreign-keys',
          'BEGIN;',
          'CREATE TABLE half_done (id INTEGER PRIMARY KEY);',
          'CREATE TABLE half_done (id INTEGER PRIMARY KEY); -- duplicate: throws',
          'INSERT INTO schema_migrations (version) VALUES (3);',
          'COMMIT;',
          '',
        ].join('\n'),
      );

      expect(() => runner.run(adapter, staged)).toThrow();
      const db = adapter.getDatabase();
      expect(schemaSql(db, 'half_done')).toBeNull(); // rolled back
      expect(db.inTransaction).toBe(false); // no dangling transaction
      const versions = (
        db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>
      ).map((v) => v.version);
      expect(versions).toEqual([1, 2]); // the synthetic 003 never stamped
    });
  });

  describe('detectDrift', () => {
    it('returns empty when nothing has been applied yet (virgin DB)', () => {
      const pending = new MigrationRunner().detectDrift(adapter, migrationsDir);
      expect(pending).toEqual([]);
    });

    it('returns empty when the applied set matches the directory', () => {
      const runner = new MigrationRunner();
      runner.run(adapter, migrationsDir);
      expect(runner.detectDrift(adapter, migrationsDir)).toEqual([]);
    });

    it('reports migrations that exist on disk but are not yet applied', () => {
      const staged = path.join(tempRoot, 'staged-migrations');
      mkdirSync(staged, { recursive: true });
      for (const file of readdirSync(migrationsDir)) {
        copyFileSync(path.join(migrationsDir, file), path.join(staged, file));
      }
      const runner = new MigrationRunner();
      runner.run(adapter, staged);
      writeFileSync(
        path.join(staged, '099_future.sql'),
        'CREATE TABLE future_probe (id INTEGER PRIMARY KEY);\nINSERT INTO schema_migrations (version) VALUES (99);\n',
      );
      const pending = runner.detectDrift(adapter, staged);
      expect(pending.map((m) => m.file)).toEqual(['099_future.sql']);
    });
  });

  describe('sibling version collisions (branch hazard, guard retained post-squash)', () => {
    it('rejects two distinct UNAPPLIED files that share a version prefix', () => {
      const staged = path.join(tempRoot, 'staged-migrations');
      mkdirSync(staged, { recursive: true });
      copyFileSync(
        path.join(migrationsDir, '001_baseline.sql'),
        path.join(staged, '001_baseline.sql'),
      );
      writeFileSync(
        path.join(staged, '002_alice.sql'),
        'CREATE TABLE a (id INTEGER PRIMARY KEY);\nINSERT INTO schema_migrations (version) VALUES (2);\n',
      );
      writeFileSync(
        path.join(staged, '002_bob.sql'),
        'CREATE TABLE b (id INTEGER PRIMARY KEY);\nINSERT INTO schema_migrations (version) VALUES (2);\n',
      );
      expect(() => new MigrationRunner().run(adapter, staged)).toThrow(
        /duplicate migration version 2/,
      );
    });

    it('no-ops (does not throw) when the duplicated version is already applied', () => {
      const staged = path.join(tempRoot, 'staged-migrations');
      mkdirSync(staged, { recursive: true });
      copyFileSync(
        path.join(migrationsDir, '001_baseline.sql'),
        path.join(staged, '001_baseline.sql'),
      );
      const runner = new MigrationRunner();
      runner.run(adapter, staged);
      // A stray sibling for an ALREADY-APPLIED version must not brick an
      // otherwise up-to-date run.
      writeFileSync(path.join(staged, '001_stray.sql'), '-- never runs\n');
      expect(() => runner.run(adapter, staged)).not.toThrow();
    });
  });
});
