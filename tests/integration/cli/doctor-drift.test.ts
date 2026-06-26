import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { inspectMigrationDrift, inspectMirrorDrift } from '@/cli/commands/doctor-command.js';
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

describe('inspectMirrorDrift', () => {
  // Run all real migrations so the `skills` / `memories` tables exist.
  const realMigrationsDir = sourceMigrationsDir;
  let work: string;
  let skillsDir: string;
  let memoryDir: string;
  let roadmapDir: string;
  let sprintsDir: string;
  let adapter: SqliteAdapter;

  beforeEach(() => {
    work = mkdtempSync(path.join(tmpdir(), 'mnema-doctor-mirror-'));
    skillsDir = path.join(work, 'skills');
    memoryDir = path.join(work, 'memory');
    roadmapDir = path.join(work, 'roadmap');
    sprintsDir = path.join(work, 'sprints');
    mkdirSync(skillsDir, { recursive: true });
    mkdirSync(memoryDir, { recursive: true });
    mkdirSync(roadmapDir, { recursive: true });
    mkdirSync(sprintsDir, { recursive: true });
    adapter = new SqliteAdapter(path.join(work, 'state.db'));
    new MigrationRunner().run(adapter, realMigrationsDir);
    // Seed one actor for FK constraints.
    adapter
      .getDatabase()
      .prepare(`INSERT INTO actors (id, handle, kind) VALUES ('a1', 'tester', 'human')`)
      .run();
  });

  afterEach(() => {
    adapter.close();
    rmSync(work, { recursive: true, force: true });
  });

  it('reports green ok=true with severity=warning when everything mirrored', () => {
    adapter
      .getDatabase()
      .prepare(
        `INSERT INTO skills (id, slug, name, version, description, content, tools_used, created_by)
         VALUES ('s1', 'foo', 'Foo', 1, 'd', 'c', '[]', 'a1')`,
      )
      .run();
    writeFileSync(path.join(skillsDir, 'foo.md'), '---\nname: Foo\n---\nc', 'utf-8');

    const checks = inspectMirrorDrift(adapter, { skillsDir, memoryDir, roadmapDir, sprintsDir });
    const skills = checks.find((c) => c.name === 'skills mirrored');
    expect(skills?.ok).toBe(true);
    expect(skills?.severity).toBe('warning');
  });

  it('reports ok=false with severity=warning when a mirror is missing', () => {
    adapter
      .getDatabase()
      .prepare(
        `INSERT INTO skills (id, slug, name, version, description, content, tools_used, created_by)
         VALUES ('s1', 'foo', 'Foo', 1, 'd', 'c', '[]', 'a1')`,
      )
      .run();
    // No mirror file written — drift.

    const checks = inspectMirrorDrift(adapter, { skillsDir, memoryDir, roadmapDir, sprintsDir });
    const skills = checks.find((c) => c.name === 'skills mirrored');
    expect(skills?.ok).toBe(false);
    expect(skills?.severity).toBe('warning');
    expect(skills?.detail).toContain('foo');
  });

  it('memories drift is reported with the same shape', () => {
    adapter
      .getDatabase()
      .prepare(
        `INSERT INTO memories (id, slug, title, content, topics, created_by)
         VALUES ('m1', 'bar', 'Bar', 'c', '[]', 'a1')`,
      )
      .run();

    const checks = inspectMirrorDrift(adapter, { skillsDir, memoryDir, roadmapDir, sprintsDir });
    const mem = checks.find((c) => c.name === 'memories mirrored');
    expect(mem?.ok).toBe(false);
    expect(mem?.severity).toBe('warning');
  });

  // readdirSync used implicitly to confirm the suite compiles when the
  // import is touched — harmless.
  it('respects empty state without errors', () => {
    expect(readdirSync(skillsDir)).toEqual([]);
    const checks = inspectMirrorDrift(adapter, { skillsDir, memoryDir, roadmapDir, sprintsDir });
    // skills, memories, epics, decisions, sprints
    expect(checks).toHaveLength(5);
    expect(checks.every((c) => c.ok)).toBe(true);
  });

  it('detects orphan mirror files (FS→DB drift)', () => {
    // No SQLite row, but a stray `.md` lingers in the mirror dir.
    writeFileSync(path.join(skillsDir, 'ghost.md'), '---\nname: ghost\n---\nstray', 'utf-8');

    const checks = inspectMirrorDrift(adapter, { skillsDir, memoryDir, roadmapDir, sprintsDir });
    const skills = checks.find((c) => c.name === 'skills mirrored');
    expect(skills?.ok).toBe(false);
    expect(skills?.severity).toBe('warning');
    expect(skills?.detail).toContain('orphan files: ghost');
  });

  it('INDEX.md and dotfiles are not flagged as orphans', () => {
    writeFileSync(path.join(skillsDir, 'INDEX.md'), '# Skills index', 'utf-8');
    writeFileSync(path.join(skillsDir, '.gitkeep'), '', 'utf-8');
    const checks = inspectMirrorDrift(adapter, { skillsDir, memoryDir, roadmapDir, sprintsDir });
    const skills = checks.find((c) => c.name === 'skills mirrored');
    expect(skills?.ok).toBe(true);
  });
});
