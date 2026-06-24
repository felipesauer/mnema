import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

const migrationsDir = path.resolve('src/storage/sqlite/migrations');

describe('MigrationRunner', () => {
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

  it('applies all migrations in order on an empty database', () => {
    const applied = new MigrationRunner().run(adapter, migrationsDir);

    expect(applied.map((a) => a.version)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
    ]);

    const versions = adapter
      .getDatabase()
      .prepare('SELECT version FROM schema_migrations ORDER BY version')
      .all() as Array<{ version: number }>;
    expect(versions.map((v) => v.version)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
    ]);
  });

  it('is idempotent — running twice does not duplicate', () => {
    const runner = new MigrationRunner();
    runner.run(adapter, migrationsDir);

    const second = runner.run(adapter, migrationsDir);
    expect(second).toEqual([]);

    const versions = adapter
      .getDatabase()
      .prepare('SELECT version FROM schema_migrations ORDER BY version')
      .all() as Array<{ version: number }>;
    expect(versions.map((v) => v.version)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
    ]);
  });

  it('creates expected tables and FTS virtual tables', () => {
    new MigrationRunner().run(adapter, migrationsDir);

    const tables = adapter
      .getDatabase()
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);

    expect(names).toContain('projects');
    expect(names).toContain('actors');
    expect(names).toContain('tasks');
    expect(names).toContain('transitions');
    expect(names).toContain('agent_runs');
    expect(names).toContain('agent_plans');
    expect(names).toContain('attachments');
    expect(names).toContain('tasks_fts');
    expect(names).toContain('notes_fts');
    expect(names).toContain('decisions_fts');
    expect(names).toContain('workspace_config');
  });

  it('enforces append-only on transitions via trigger', () => {
    new MigrationRunner().run(adapter, migrationsDir);
    const db = adapter.getDatabase();

    db.prepare("INSERT INTO projects (id, key, name) VALUES ('p1', 'WEBAPP', 'Test')").run();
    db.prepare(`INSERT INTO actors (id, handle, kind) VALUES ('a1', 'daniel', 'human')`).run();
    db.prepare(
      `INSERT INTO tasks (id, key, project_id, title, reporter_id)
       VALUES ('t1', 'WEBAPP-1', 'p1', 'Task one', 'a1')`,
    ).run();
    db.prepare(
      `INSERT INTO transitions (id, task_id, from_state, to_state, action, actor_id)
       VALUES ('tr1', 't1', NULL, 'DRAFT', 'create', 'a1')`,
    ).run();

    expect(() =>
      db.prepare("UPDATE transitions SET to_state = 'READY' WHERE id = 'tr1'").run(),
    ).toThrow(/append-only/);

    expect(() => db.prepare("DELETE FROM transitions WHERE id = 'tr1'").run()).toThrow(
      /cannot be deleted/,
    );
  });

  describe('detectDrift', () => {
    it('returns empty when nothing has been applied yet (virgin DB)', () => {
      const drift = new MigrationRunner().detectDrift(adapter, migrationsDir);
      expect(drift).toEqual([]);
    });

    it('returns empty when applied set matches the directory', () => {
      const runner = new MigrationRunner();
      runner.run(adapter, migrationsDir);

      expect(runner.detectDrift(adapter, migrationsDir)).toEqual([]);
    });

    it('reports migrations that exist on disk but are not yet applied', () => {
      const runner = new MigrationRunner();
      runner.run(adapter, migrationsDir);

      // Build a temp migrations dir with the real ones plus a fake unmigrated one.
      const tempDir = mkdtempSync(path.join(tmpdir(), 'mnema-mig-drift-'));
      mkdirSync(tempDir, { recursive: true });
      for (const file of readdirSync(migrationsDir)) {
        copyFileSync(path.join(migrationsDir, file), path.join(tempDir, file));
      }
      writeFileSync(
        path.join(tempDir, '099_test_drift.sql'),
        "INSERT INTO schema_migrations (version, applied_at) VALUES (99, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));\n",
        'utf-8',
      );

      try {
        const drift = runner.detectDrift(adapter, tempDir);
        expect(drift.map((m) => m.version)).toEqual([99]);
        expect(drift[0]?.file).toBe('099_test_drift.sql');
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('merges multiple directories: bundled + project-local', () => {
      const runner = new MigrationRunner();
      runner.run(adapter, migrationsDir);

      // Simulate a project-local dir holding a custom migration that
      // sits next to the bundled set. `detectDrift` must walk both
      // directories and surface the project-local file as pending.
      const projectDir = mkdtempSync(path.join(tmpdir(), 'mnema-mig-proj-'));
      writeFileSync(
        path.join(projectDir, '099_custom_local.sql'),
        "INSERT INTO schema_migrations (version, applied_at) VALUES (99, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));\n",
        'utf-8',
      );

      try {
        const drift = runner.detectDrift(adapter, [migrationsDir, projectDir]);
        expect(drift.map((m) => m.version)).toEqual([99]);
        expect(drift[0]?.file).toBe('099_custom_local.sql');
      } finally {
        rmSync(projectDir, { recursive: true, force: true });
      }
    });

    it('silently skips a missing directory in the array', () => {
      const runner = new MigrationRunner();
      runner.run(adapter, migrationsDir);

      // Non-existent dir should not throw, just contribute zero files.
      const drift = runner.detectDrift(adapter, [
        migrationsDir,
        '/tmp/this-path-does-not-exist-on-purpose',
      ]);
      expect(drift).toEqual([]);
    });
  });

  it('archives agent plans automatically when an agent_run ends', () => {
    new MigrationRunner().run(adapter, migrationsDir);
    const db = adapter.getDatabase();

    db.prepare(
      `INSERT INTO actors (id, handle, kind) VALUES
         ('h1', 'daniel', 'human'),
         ('a1', 'agent:claude', 'agent')`,
    ).run();
    db.prepare(
      `INSERT INTO agent_runs (id, agent_actor_id, invoked_by, goal, status)
       VALUES ('r1', 'a1', 'h1', 'do work', 'running')`,
    ).run();
    db.prepare(
      `INSERT INTO agent_plans (id, agent_run_id, content, state)
       VALUES ('p1', 'r1', 'step 1', 'pending'),
              ('p2', 'r1', 'step 2', 'in_progress')`,
    ).run();

    db.prepare("UPDATE agent_runs SET status = 'completed' WHERE id = 'r1'").run();

    const plans = db
      .prepare('SELECT id, archived_at FROM agent_plans WHERE agent_run_id = ?')
      .all('r1') as Array<{ id: string; archived_at: string | null }>;
    for (const p of plans) {
      expect(p.archived_at).not.toBeNull();
    }
  });

  it('rejects two distinct UNAPPLIED files that share a version prefix', () => {
    // Sibling branches each claim the next free slot → two `017_*.sql` files
    // (above the bundled max, so they are genuinely unapplied collisions).
    const extra = mkdtempSync(path.join(tmpdir(), 'mnema-mig-dup-'));
    writeFileSync(
      path.join(extra, '017_alice.sql'),
      'INSERT INTO schema_migrations (version) VALUES (17);',
    );
    writeFileSync(
      path.join(extra, '017_bob.sql'),
      'INSERT INTO schema_migrations (version) VALUES (17);',
    );

    expect(() => new MigrationRunner().run(adapter, [migrationsDir, extra])).toThrow(
      /duplicate migration version 17/,
    );

    rmSync(extra, { recursive: true, force: true });
  });

  it('no-ops (does not throw) when the duplicated version is already applied', () => {
    // First bring the DB fully up to date with the bundled set.
    new MigrationRunner().run(adapter, migrationsDir);

    // A stray project-local file collides with the bundled 016, but version 16
    // is already applied — both are no-ops, so migrate must stay idempotent.
    const extra = mkdtempSync(path.join(tmpdir(), 'mnema-mig-applied-'));
    writeFileSync(
      path.join(extra, '016_stray_local.sql'),
      'INSERT INTO schema_migrations (version) VALUES (16);',
    );

    const second = new MigrationRunner().run(adapter, [migrationsDir, extra]);
    expect(second).toEqual([]);

    rmSync(extra, { recursive: true, force: true });
  });
});
