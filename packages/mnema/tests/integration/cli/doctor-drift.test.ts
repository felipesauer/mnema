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
import { MigrationRunner } from '@mnema/core/storage/sqlite/migration-runner.js';
import { SqliteAdapter } from '@mnema/core/storage/sqlite/sqlite-adapter.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type DoctorCheck,
  inspectMigrationDrift,
  inspectMirrorDrift,
  mirrorHints,
} from '@/cli/commands/doctor-command.js';

const sourceMigrationsDir = path.resolve('packages/core/src/storage/sqlite/migrations');

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
    // Synthetic fixture migrations: drift detection only cares about the
    // NNN version prefixes and the schema_migrations bookkeeping, so tiny
    // self-recording files stand in for real ones (which are baselined).
    const synthetic = (version, name) =>
      [
        `CREATE TABLE IF NOT EXISTS schema_migrations (`,
        `  version INTEGER PRIMARY KEY,`,
        `  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
        `);`,
        `CREATE TABLE fixture_${name} (id INTEGER PRIMARY KEY);`,
        `INSERT INTO schema_migrations (version) VALUES (${version});`,
        '',
      ].join('\n');
    writeFileSync(path.join(migrationsCopy, '001_alpha.sql'), synthetic(1, 'alpha'));
    writeFileSync(path.join(migrationsCopy, '002_beta.sql'), synthetic(2, 'beta'));
    writeFileSync(path.join(migrationsCopy, '003_gamma.sql'), synthetic(3, 'gamma'));
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
    copyFileSync(path.join(migrationsCopy, '003_gamma.sql'), newFile);

    const checks = inspectMigrationDrift(adapter, migrationsCopy);
    const applied = checks.find((c) => c.name === 'migrations applied');
    expect(applied?.ok).toBe(false);
    expect(applied?.detail).toContain('004_drift_demo.sql');
  });

  it('flags an orphan version when the file disappears after being applied', () => {
    new MigrationRunner().run(adapter, migrationsCopy);
    // Simulate someone deleting an applied migration from the tree.
    unlinkSync(path.join(migrationsCopy, '003_gamma.sql'));

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
  let backlogDir: string;
  let observationsDir: string;
  let adapter: SqliteAdapter;

  // Injects every mirror dir so each test only passes the adapter.
  const drift = () =>
    inspectMirrorDrift(adapter, {
      skillsDir,
      memoryDir,
      roadmapDir,
      sprintsDir,
      backlogDir,
      observationsDir,
    });

  beforeEach(() => {
    work = mkdtempSync(path.join(tmpdir(), 'mnema-doctor-mirror-'));
    skillsDir = path.join(work, 'skills');
    memoryDir = path.join(work, 'memory');
    roadmapDir = path.join(work, 'roadmap');
    sprintsDir = path.join(work, 'sprints');
    backlogDir = path.join(work, 'backlog');
    observationsDir = path.join(work, 'observations');
    mkdirSync(skillsDir, { recursive: true });
    mkdirSync(memoryDir, { recursive: true });
    mkdirSync(roadmapDir, { recursive: true });
    mkdirSync(sprintsDir, { recursive: true });
    mkdirSync(backlogDir, { recursive: true });
    mkdirSync(observationsDir, { recursive: true });
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
    // ADR-51: an authored skill's canonical mirror lives under authored/.
    mkdirSync(path.join(skillsDir, 'authored'), { recursive: true });
    writeFileSync(path.join(skillsDir, 'authored', 'foo.md'), '---\nname: Foo\n---\nc', 'utf-8');

    const checks = drift();
    const skills = checks.find((c) => c.name === 'skills mirrored');
    expect(skills?.ok).toBe(true);
    expect(skills?.severity).toBe('warning');
  });

  it('ADR-51: flags a FLAT (mislocated) mirror as needing rebuild, so upgrade migrates it', () => {
    adapter
      .getDatabase()
      .prepare(
        `INSERT INTO skills (id, slug, name, version, description, content, tools_used, created_by)
         VALUES ('s1', 'foo', 'Foo', 1, 'd', 'c', '[]', 'a1')`,
      )
      .run();
    // A pre-layout flat file: present, but NOT at its canonical authored/ path.
    writeFileSync(path.join(skillsDir, 'foo.md'), '---\nname: Foo\n---\nc', 'utf-8');

    const skills = drift().find((c) => c.name === 'skills mirrored');
    expect(skills?.ok).toBe(false);
    // The "missing files" wording is the exact signal `mnema upgrade` gates on.
    expect(skills?.detail).toContain('missing files');
    expect(skills?.detail).toContain('foo');
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

    const checks = drift();
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

    const checks = drift();
    const mem = checks.find((c) => c.name === 'memories mirrored');
    expect(mem?.ok).toBe(false);
    expect(mem?.severity).toBe('warning');
  });

  it('detects a missing observation mirror (keyed by id) and clears once the .md exists', () => {
    // Observation mirrors are named `<id>.md`, not `<slug>.md`.
    adapter
      .getDatabase()
      .prepare(
        `INSERT INTO observations (id, content, topics, created_by)
         VALUES ('o1', 'a signal', '["ci"]', 'a1')`,
      )
      .run();

    // No mirror on disk → doctor flags the row as missing.
    const missing = drift().find((c) => c.name === 'observations mirrored');
    expect(missing?.ok).toBe(false);
    expect(missing?.severity).toBe('warning');
    expect(missing?.detail).toContain('missing files: o1');

    // Once the mirror exists (as the rebuild path writes it), it clears.
    writeFileSync(path.join(observationsDir, 'o1.md'), '---\nid: o1\n---\na signal', 'utf-8');
    const healed = drift().find((c) => c.name === 'observations mirrored');
    expect(healed?.ok).toBe(true);
  });

  it('an archived observation is neither missing nor an orphan (its mirror is intentionally gone)', () => {
    adapter
      .getDatabase()
      .prepare(
        `INSERT INTO observations (id, content, topics, created_by, archived_at)
         VALUES ('o-archived', 'stale', '[]', 'a1', '2026-01-01T00:00:00.000Z')`,
      )
      .run();
    // No mirror on disk for the archived row — and that is correct.
    const obs = drift().find((c) => c.name === 'observations mirrored');
    expect(obs?.ok).toBe(true);
  });

  it('detects an orphan observation mirror (FS→DB drift)', () => {
    // One LIVE row (mirrored) so the table is not cold — with zero rows the
    // cold-DB guard deliberately reports nothing (see the clone test below).
    adapter
      .getDatabase()
      .prepare(
        `INSERT INTO observations (id, content, topics, created_by)
         VALUES ('o-live', 'a signal', '[]', 'a1')`,
      )
      .run();
    writeFileSync(
      path.join(observationsDir, 'o-live.md'),
      '---\nid: o-live\n---\na signal',
      'utf-8',
    );
    writeFileSync(path.join(observationsDir, 'ghost-id.md'), '---\n---\nstray', 'utf-8');
    const obs = drift().find((c) => c.name === 'observations mirrored');
    expect(obs?.ok).toBe(false);
    expect(obs?.detail).toContain('orphan files: ghost-id');
  });

  it('does not flag a free-form roadmap file (e.g. 2026-Q2.md) as an orphan', () => {
    // The scaffold README invites human roadmap files. Their stems are not
    // key-shaped, so the orphan scan must ignore them entirely.
    writeFileSync(path.join(roadmapDir, '2026-Q2.md'), '# Q2 themes\n', 'utf-8');
    writeFileSync(path.join(roadmapDir, 'north-star.md'), '# vision\n', 'utf-8');
    const decisions = drift().find((c) => c.name === 'decisions mirrored');
    expect(decisions?.ok).toBe(true);
    expect(decisions?.detail).not.toContain('2026-Q2');
    expect(decisions?.detail).not.toContain('north-star');
  });

  it('still flags a key-shaped roadmap mirror with no row as an orphan', () => {
    // A file that LOOKS like an entity key (<PROJECT>-EPIC-N) but has no
    // matching row is a genuine orphan — the restriction must not hide it.
    writeFileSync(path.join(roadmapDir, 'TEST-EPIC-9.md'), '# gone\n', 'utf-8');
    const decisions = drift().find((c) => c.name === 'decisions mirrored');
    expect(decisions?.ok).toBe(false);
    expect(decisions?.detail).toContain('TEST-EPIC-9');
  });

  // readdirSync used implicitly to confirm the suite compiles when the
  // import is touched — harmless.
  it('respects empty state without errors', () => {
    expect(readdirSync(skillsDir)).toEqual([]);
    const checks = drift();
    // skills, memories, observations, epics, decisions, sprints, tasks,
    // task mirror uniqueness
    expect(checks).toHaveLength(8);
    expect(checks.every((c) => c.ok)).toBe(true);
  });

  it('detects orphan mirror files (FS→DB drift)', () => {
    // One LIVE row (mirrored) so the table is not cold, plus a stray `.md`
    // with no row — the stray is the orphan.
    adapter
      .getDatabase()
      .prepare(
        `INSERT INTO skills (id, slug, name, version, description, content, tools_used, created_by)
         VALUES ('s-live', 'live', 'Live', 1, 'd', 'c', '[]', 'a1')`,
      )
      .run();
    mkdirSync(path.join(skillsDir, 'authored'), { recursive: true });
    writeFileSync(path.join(skillsDir, 'authored', 'live.md'), '---\nname: Live\n---\nc', 'utf-8');
    writeFileSync(path.join(skillsDir, 'ghost.md'), '---\nname: ghost\n---\nstray', 'utf-8');

    const checks = drift();
    const skills = checks.find((c) => c.name === 'skills mirrored');
    expect(skills?.ok).toBe(false);
    expect(skills?.severity).toBe('warning');
    expect(skills?.detail).toContain('orphan files: ghost');
  });

  it('cold-DB guard: a stray mirror with ZERO rows of that kind is NOT flagged (fresh-clone safety)', () => {
    // A fresh clone carries every versioned mirror while the local DB has no
    // memory/skill rows yet — flagging (and then pruning) them would wipe the
    // knowledge base. Zero rows → the orphan scan reports nothing.
    writeFileSync(path.join(skillsDir, 'ghost.md'), '---\nname: ghost\n---\nstray', 'utf-8');
    const skills = drift().find((c) => c.name === 'skills mirrored');
    expect(skills?.ok).toBe(true);
  });

  it('INDEX.md and dotfiles are not flagged as orphans', () => {
    writeFileSync(path.join(skillsDir, 'INDEX.md'), '# Skills index', 'utf-8');
    writeFileSync(path.join(skillsDir, '.gitkeep'), '', 'utf-8');
    const checks = drift();
    const skills = checks.find((c) => c.name === 'skills mirrored');
    expect(skills?.ok).toBe(true);
  });

  it('a scaffolded roadmap/README.md is NOT flagged as an orphan (the tool wrote it)', () => {
    // The roadmap scaffolder plants README.md with no DB row. It must not read
    // as an orphan — the documented prune remedy would otherwise delete it.
    // One live decision (mirrored) so the roadmap dir is not empty.
    adapter
      .getDatabase()
      .prepare(`INSERT OR IGNORE INTO projects (id, key, name) VALUES ('p1', 'PRJ', 'Project')`)
      .run();
    adapter
      .getDatabase()
      .prepare(
        `INSERT INTO decisions (id, key, project_id, title, decision, status, authored_by)
         VALUES ('d1', 'PRJ-ADR-1', 'p1', 'D', 'we decided', 'accepted', 'a1')`,
      )
      .run();
    writeFileSync(path.join(roadmapDir, 'PRJ-ADR-1.md'), '---\nkey: PRJ-ADR-1\n---\nd', 'utf-8');
    writeFileSync(
      path.join(roadmapDir, 'README.md'),
      '# Roadmap\n\nDrop a file per quarter.',
      'utf-8',
    );

    const decisions = drift().find((c) => c.name === 'decisions mirrored');
    expect(decisions?.ok).toBe(true);
    expect(decisions?.detail).not.toContain('README');
  });

  // Seeds a project + one task so the per-state backlog layout can be
  // exercised. Returns the task key.
  const seedTask = (key: string, state: string) => {
    adapter
      .getDatabase()
      .prepare(`INSERT OR IGNORE INTO projects (id, key, name) VALUES ('p1', 'PRJ', 'Project')`)
      .run();
    adapter
      .getDatabase()
      .prepare(
        `INSERT INTO tasks (id, key, project_id, title, reporter_id, state)
         VALUES (?, ?, 'p1', 'T', 'a1', ?)`,
      )
      .run(`t-${key}`, key, state);
  };

  it('reports a missing task mirror under "tasks mirrored" (nested layout)', () => {
    seedTask('PRJ-1', 'DRAFT');
    // No backlog/DRAFT/PRJ-1.md written — drift.

    const checks = drift();
    const tasks = checks.find((c) => c.name === 'tasks mirrored');
    expect(tasks?.ok).toBe(false);
    expect(tasks?.severity).toBe('warning');
    expect(tasks?.detail).toContain('missing files: PRJ-1');
  });

  it('reports a green task mirror when the nested .md exists', () => {
    seedTask('PRJ-1', 'DRAFT');
    mkdirSync(path.join(backlogDir, 'DRAFT'), { recursive: true });
    writeFileSync(path.join(backlogDir, 'DRAFT', 'PRJ-1.md'), '---\n---\n# T', 'utf-8');

    const checks = drift();
    const tasks = checks.find((c) => c.name === 'tasks mirrored');
    expect(tasks?.ok).toBe(true);
  });

  it('detects an orphan task mirror in a state subfolder', () => {
    // A stray .md under a state folder with no matching SQLite row.
    mkdirSync(path.join(backlogDir, 'DONE'), { recursive: true });
    writeFileSync(path.join(backlogDir, 'DONE', 'PRJ-999.md'), '---\n---\nstray', 'utf-8');

    const checks = drift();
    const tasks = checks.find((c) => c.name === 'tasks mirrored');
    expect(tasks?.ok).toBe(false);
    expect(tasks?.detail).toContain('orphan files: PRJ-999');
  });

  it('flags a task mirrored in two state dirs under "task mirror uniqueness"', () => {
    // The task is DONE in the DB, but a stale READY copy lingers alongside the
    // canonical DONE one — the squash-merge shape. Neither missing nor orphan
    // (canonical file present, row live), so only the uniqueness check sees it.
    seedTask('PRJ-1', 'DONE');
    for (const state of ['DONE', 'READY']) {
      mkdirSync(path.join(backlogDir, state), { recursive: true });
      writeFileSync(path.join(backlogDir, state, 'PRJ-1.md'), '---\n---\n# T', 'utf-8');
    }

    const checks = drift();
    const tasksMirrored = checks.find((c) => c.name === 'tasks mirrored');
    // The canonical DONE file exists and the row is live, so the classic check is green.
    expect(tasksMirrored?.ok).toBe(true);

    const uniqueness = checks.find((c) => c.name === 'task mirror uniqueness');
    expect(uniqueness?.ok).toBe(false);
    expect(uniqueness?.severity).toBe('error');
    expect(uniqueness?.detail).toContain('PRJ-1');
    expect(uniqueness?.detail).toContain('DONE, READY');
    expect(uniqueness?.detail).toContain('canonical DONE/');
  });

  it('flags a task whose single mirror sits in the WRONG state dir', () => {
    // Row says DONE, but the only mirror is under READY/ — a mirror that drifted
    // to a non-canonical dir. Not missing (a file exists for the key) via the
    // uniqueness lens; the classic check flags it missing at the DONE path.
    seedTask('PRJ-2', 'DONE');
    mkdirSync(path.join(backlogDir, 'READY'), { recursive: true });
    writeFileSync(path.join(backlogDir, 'READY', 'PRJ-2.md'), '---\n---\n# T', 'utf-8');

    const uniqueness = drift().find((c) => c.name === 'task mirror uniqueness');
    expect(uniqueness?.ok).toBe(false);
    expect(uniqueness?.detail).toContain('PRJ-2 in [READY]');
    expect(uniqueness?.detail).toContain('canonical DONE/');
  });

  it('task mirror uniqueness is green when each task has exactly one mirror at its state dir', () => {
    seedTask('PRJ-1', 'DONE');
    mkdirSync(path.join(backlogDir, 'DONE'), { recursive: true });
    writeFileSync(path.join(backlogDir, 'DONE', 'PRJ-1.md'), '---\n---\n# T', 'utf-8');

    const uniqueness = drift().find((c) => c.name === 'task mirror uniqueness');
    expect(uniqueness?.ok).toBe(true);
  });

  it('a stray mirror whose key has no live row is an orphan, not a uniqueness violation', () => {
    // PRJ-999 has no row → the uniqueness check ignores it (orphan scan owns it).
    mkdirSync(path.join(backlogDir, 'DONE'), { recursive: true });
    writeFileSync(path.join(backlogDir, 'DONE', 'PRJ-999.md'), '---\n---\nstray', 'utf-8');

    const uniqueness = drift().find((c) => c.name === 'task mirror uniqueness');
    expect(uniqueness?.ok).toBe(true);
  });
});

describe('mirrorHints', () => {
  const ok = (name: string): DoctorCheck => ({ name, ok: true, detail: '5 mirrored' });
  const missing = (name: string): DoctorCheck => ({
    name,
    ok: false,
    detail: '5 rows, missing files: A, B',
    severity: 'warning',
  });
  const orphan = (name: string): DoctorCheck => ({
    name,
    ok: false,
    detail: '5 rows, orphan files: ghost',
    severity: 'warning',
  });

  it('returns no hints when every mirror check is clean', () => {
    expect(mirrorHints([ok('epics mirrored'), ok('skills mirrored')])).toEqual([]);
  });

  it('suggests --rebuild-mirrors when rows are missing files', () => {
    const hints = mirrorHints([missing('decisions mirrored')]);
    expect(hints).toHaveLength(1);
    expect(hints[0]).toContain('--rebuild-mirrors');
    expect(hints[0]).not.toContain('--prune-orphans');
  });

  it('suggests --prune-orphans (conditionally) when files have no row', () => {
    const hints = mirrorHints([orphan('skills mirrored')]);
    expect(hints).toHaveLength(1);
    expect(hints[0]).toContain('--prune-orphans');
    expect(hints[0]).toContain('register them');
  });

  it('emits both hints when both drifts are present', () => {
    const hints = mirrorHints([missing('epics mirrored'), orphan('memories mirrored')]);
    expect(hints).toHaveLength(2);
  });

  it('ignores non-mirror checks and passing checks', () => {
    const auditFail: DoctorCheck = {
      name: 'audit event count',
      ok: false,
      detail: 'disk has 1 events',
      severity: 'error',
    };
    expect(mirrorHints([auditFail, ok('epics mirrored')])).toEqual([]);
  });
});
