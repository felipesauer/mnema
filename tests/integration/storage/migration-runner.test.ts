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

import { SearchService } from '@/services/search-service.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

/** True when a trigger of the given name exists in the schema. */
function triggerExists(db: DatabaseType, name: string): boolean {
  const row = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = ?")
    .get(name);
  return row !== undefined;
}

/** Runs a search and returns the matched ids (empty on an error result). */
function searchIds(search: SearchService, query: string): string[] {
  const result = search.search(query);
  return result.ok ? result.value.map((h) => h.id) : [];
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
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
      27, 28, 29,
    ]);

    const versions = adapter
      .getDatabase()
      .prepare('SELECT version FROM schema_migrations ORDER BY version')
      .all() as Array<{ version: number }>;
    expect(versions.map((v) => v.version)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
      27, 28, 29,
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
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
      27, 28, 29,
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

  it('migration 029 backfills FTS for skills/memories/observations left un-indexed before 009', () => {
    // A DB upgraded across the 008 → 009 boundary has base rows the 009 FTS
    // triggers never saw (they only fire on writes made after 009). Simulate
    // that: apply everything, insert rows (triggers index them), then delete the
    // FTS side to recreate the pre-009 un-indexed state. Re-running 029 must
    // re-index them so search finds them again.
    const runner = new MigrationRunner();
    runner.run(adapter, migrationsDir);
    const db = adapter.getDatabase();

    db.prepare(`INSERT INTO actors (id, handle, kind) VALUES ('a1', 'daniel', 'human')`).run();
    db.prepare(
      `INSERT INTO skills (id, slug, name, description, content, created_by)
       VALUES ('s1', 'deploy', 'Deploy', 'How to deploy', 'run the zephyr pipeline', 'a1')`,
    ).run();
    db.prepare(
      `INSERT INTO memories (id, slug, title, content, created_by)
       VALUES ('m1', 'arch', 'Architecture', 'the zephyr module owns storage', 'a1')`,
    ).run();
    db.prepare(
      `INSERT INTO observations (id, content, created_by)
       VALUES ('o1', 'noticed the zephyr flag was off', 'a1')`,
    ).run();

    // Drop the FTS rows to emulate a DB that carried these across 008 → 009.
    db.prepare(`DELETE FROM skills_fts WHERE skill_id = 's1'`).run();
    db.prepare(`DELETE FROM memories_fts WHERE memory_id = 'm1'`).run();
    db.prepare(`DELETE FROM observations_fts WHERE observation_id = 'o1'`).run();

    const search = new SearchService(adapter);
    // Pre-backfill: the un-indexed rows are invisible to search.
    expect(searchIds(search, 'zephyr')).toEqual([]);

    // Apply the backfill (029 as a fresh migration against the pre-009 state).
    const backfill = readFileSync(
      path.join(migrationsDir, '029_backfill_fts_skills_memories_observations.sql'),
      'utf-8',
    ).replace(/INSERT INTO schema_migrations[\s\S]*$/m, '');
    db.exec(backfill);

    expect(searchIds(search, 'zephyr').sort()).toEqual(['m1', 'o1', 's1']);
  });

  it('migration 029 backfill is idempotent (re-running does not double-index)', () => {
    // 029 guards each INSERT with `NOT IN (SELECT ... FROM *_fts)`, so running
    // the backfill a second time over an already-indexed DB must be a no-op —
    // never a duplicate FTS row that would surface a hit twice.
    new MigrationRunner().run(adapter, migrationsDir);
    const db = adapter.getDatabase();

    db.prepare(`INSERT INTO actors (id, handle, kind) VALUES ('a1', 'daniel', 'human')`).run();
    db.prepare(
      `INSERT INTO memories (id, slug, title, content, created_by)
       VALUES ('m1', 'arch', 'Architecture', 'the zephyr module owns storage', 'a1')`,
    ).run();

    const backfill = readFileSync(
      path.join(migrationsDir, '029_backfill_fts_skills_memories_observations.sql'),
      'utf-8',
    ).replace(/INSERT INTO schema_migrations[\s\S]*$/m, '');
    db.exec(backfill);
    db.exec(backfill);

    const hits = searchIds(new SearchService(adapter), 'zephyr').filter((id) => id === 'm1');
    expect(hits).toHaveLength(1);
  });

  it("migration 028 widens provenance_links CHECK to accept 'skill' and still rejects unknown kinds", () => {
    new MigrationRunner().run(adapter, migrationsDir);
    const db = adapter.getDatabase();

    // A skill → skill edge is now accepted (was rejected before 028).
    expect(() =>
      db
        .prepare(
          `INSERT INTO provenance_links (id, source_kind, source_ref, target_kind, target_ref)
           VALUES ('p-skill', 'skill', 'old-id', 'skill', 'new-id')`,
        )
        .run(),
    ).not.toThrow();

    // An unknown kind is still refused by the recreated CHECK.
    expect(() =>
      db
        .prepare(
          `INSERT INTO provenance_links (id, source_kind, source_ref, target_kind, target_ref)
           VALUES ('p-bad', 'sprint', 'x', 'memory', 'y')`,
        )
        .run(),
    ).toThrow();

    // The unique index survived the recreate (a duplicate edge is rejected).
    expect(() =>
      db
        .prepare(
          `INSERT INTO provenance_links (id, source_kind, source_ref, target_kind, target_ref)
           VALUES ('p-dup', 'skill', 'old-id', 'skill', 'new-id')`,
        )
        .run(),
    ).toThrow();
  });

  it('migration 028 is wrapped in a transaction with FK disabled (atomicity guard)', () => {
    // 028 rebuilds provenance_links (CREATE_new / INSERT / DROP / RENAME). If it
    // is not atomic, a crash between the DROP and the version stamp leaves a
    // recreated-but-unstamped table that bricks every future migrate. Pin the
    // wrapping and the FK-disable header so they cannot be silently removed.
    const sql = readFileSync(path.join(migrationsDir, '028_provenance_skill_kind.sql'), 'utf-8');
    expect(sql).toMatch(/^\s*--\s*mnema:disable-foreign-keys/m);
    expect(sql).toMatch(/^\s*BEGIN\s*;/m);
    expect(sql).toMatch(/^\s*COMMIT\s*;/m);
  });

  it('rolls back the whole of 028 on a mid-migration failure (no recreated-but-unstamped brick)', () => {
    // Build a migrations dir with the real 001..027 plus a 028 that fails right
    // after it drops the old provenance_links. Without the transaction the DROP
    // auto-commits and the table is gone while v28 is never stamped — the next
    // migrate re-runs 028 and dies on the existing _new table. With the wrapping
    // (BEGIN/COMMIT + the runner's rollback on error) the whole 028 rolls back:
    // provenance_links survives and v28 is not recorded, so the DB is cleanly at
    // v27 and a retry succeeds.
    const brokenDir = mkdtempSync(path.join(tmpdir(), 'mnema-mig-broken-028-'));
    for (const file of readdirSync(migrationsDir).filter((f) =>
      /^0(0\d|1\d|2[0-7])_.*\.sql$/.test(f),
    )) {
      copyFileSync(path.join(migrationsDir, file), path.join(brokenDir, file));
    }
    const real028 = readFileSync(
      path.join(migrationsDir, '028_provenance_skill_kind.sql'),
      'utf-8',
    );
    const broken028 = real028.replace(
      'DROP TABLE provenance_links;',
      'DROP TABLE provenance_links;\nINSERT INTO no_such_table VALUES (1);',
    );
    // Guard: the marker we edit must actually be present, or the test is a no-op.
    expect(broken028).not.toBe(real028);
    writeFileSync(path.join(brokenDir, '028_provenance_skill_kind.sql'), broken028, 'utf-8');

    const runner = new MigrationRunner();
    // The failing migration surfaces as a thrown error.
    expect(() => runner.run(adapter, brokenDir)).toThrow();

    const db = adapter.getDatabase();
    // The DROP was rolled back with the rest of 028: the table still exists.
    const table = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'provenance_links'")
      .get();
    expect(table).not.toBeUndefined();
    // v28 was never stamped — the DB is cleanly at v27, not a half-migrated brick.
    const has28 = db.prepare('SELECT 1 FROM schema_migrations WHERE version = 28').get();
    expect(has28).toBeUndefined();
    // No transaction is left dangling for whatever runs next.
    expect(db.inTransaction).toBe(false);

    rmSync(brokenDir, { recursive: true, force: true });
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
