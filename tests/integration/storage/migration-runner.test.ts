import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Database as DatabaseType } from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

/** True when a trigger of the given name exists in the schema. */
function triggerExists(db: DatabaseType, name: string): boolean {
  const row = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = ?")
    .get(name);
  return row !== undefined;
}

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
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
    ]);

    const versions = adapter
      .getDatabase()
      .prepare('SELECT version FROM schema_migrations ORDER BY version')
      .all() as Array<{ version: number }>;
    expect(versions.map((v) => v.version)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
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
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
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
    expect(names).toContain('labels');
    expect(names).toContain('task_labels');
    expect(names).toContain('provenance_links');
    expect(names).toContain('tasks_fts');
    expect(names).toContain('notes_fts');
    expect(names).toContain('decisions_fts');
    expect(names).toContain('workspace_config');
  });

  it('creates idx_tasks_title and uses it for the findByTitle lookup', () => {
    new MigrationRunner().run(adapter, migrationsDir);
    const db = adapter.getDatabase();

    // The partial index exists…
    const index = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_tasks_title'")
      .get() as { name: string } | undefined;
    expect(index?.name).toBe('idx_tasks_title');

    // …and the planner uses it for the importer's dedupe query rather than
    // scanning the table. EXPLAIN QUERY PLAN names the index it picks.
    const plan = db
      .prepare(
        'EXPLAIN QUERY PLAN SELECT * FROM tasks WHERE project_id = ? AND title = ? AND deleted_at IS NULL',
      )
      .all('p1', 'Some title') as Array<{ detail: string }>;
    const detail = plan.map((r) => r.detail).join(' | ');
    expect(detail).toContain('idx_tasks_title');
    expect(detail).not.toMatch(/SCAN TABLE tasks\b(?!.*USING INDEX)/);
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

  it('migration 005 is wrapped in a transaction (atomicity guard)', () => {
    // 005 drops and recreates the transitions append-only trigger. If it
    // is not atomic, a crash between the two leaves the guard gone. Pin
    // the wrapping so it cannot be silently removed.
    const sql = readFileSync(path.join(migrationsDir, '005_iso8601_timestamps.sql'), 'utf-8');
    expect(sql).toMatch(/^\s*BEGIN\s*;/m);
    expect(sql).toMatch(/^\s*COMMIT\s*;/m);
  });

  it('rolls back the whole of 005 on a mid-migration failure (append-only guard survives)', () => {
    // Build a migrations dir with the real 001..004 plus a 005 that fails
    // partway through — right after the trigger drop. The runner must roll
    // the whole 005 back (BEGIN/COMMIT wrapping + the runner's rollback on
    // error), leaving the append-only trigger from 001 intact rather than
    // dropped-and-not-recreated.
    const brokenDir = mkdtempSync(path.join(tmpdir(), 'mnema-mig-broken-'));
    for (const file of readdirSync(migrationsDir).filter((f) => /^00[1-4]_.*\.sql$/.test(f))) {
      copyFileSync(path.join(migrationsDir, file), path.join(brokenDir, file));
    }
    const real005 = readFileSync(path.join(migrationsDir, '005_iso8601_timestamps.sql'), 'utf-8');
    const broken005 = real005.replace(
      'DROP TRIGGER IF EXISTS trg_transitions_no_update;',
      'DROP TRIGGER IF EXISTS trg_transitions_no_update;\nINSERT INTO no_such_table VALUES (1);',
    );
    writeFileSync(path.join(brokenDir, '005_iso8601_timestamps.sql'), broken005, 'utf-8');

    const runner = new MigrationRunner();
    // The failing migration surfaces as a thrown error.
    expect(() => runner.run(adapter, brokenDir)).toThrow();

    const db = adapter.getDatabase();
    // The DROP was rolled back with the rest of 005: the guard is intact.
    expect(triggerExists(db, 'trg_transitions_no_update')).toBe(true);
    // And no transaction is left dangling for whatever runs next.
    expect(db.inTransaction).toBe(false);

    rmSync(brokenDir, { recursive: true, force: true });
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
