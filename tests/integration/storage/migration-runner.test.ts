import { mkdtempSync, rmSync } from 'node:fs';
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

    expect(applied.map((a) => a.version)).toEqual([1, 2, 3, 4, 5]);

    const versions = adapter
      .getDatabase()
      .prepare('SELECT version FROM schema_migrations ORDER BY version')
      .all() as Array<{ version: number }>;
    expect(versions.map((v) => v.version)).toEqual([1, 2, 3, 4, 5]);
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
    expect(versions.map((v) => v.version)).toEqual([1, 2, 3, 4, 5]);
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
});
