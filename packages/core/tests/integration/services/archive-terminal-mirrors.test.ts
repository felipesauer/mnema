import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConfigSchema } from '@/config/config-schema.js';
import { deriveAlias } from '@/domain/entity-alias.js';
import { ARCHIVE_DIRNAME } from '@/services/backlog/archive-service.js';
import { createServiceContainer, type ServiceContainer } from '@/services/service-container.js';
import { MarkdownIo } from '@/storage/markdown/markdown-io.js';

/**
 * Opt-in terminal-mirror archival. DONE/CANCELED tasks keep a live SQLite row
 * (the source of truth) and their `.md` mirror is never deleted, so a committed
 * backlog accrues finished tasks forever. `ArchiveService.archiveTerminalMirrors`
 * MOVES — never deletes — the mirrors of terminal tasks older than the cutoff
 * into `backlog/.archive/<STATE>/`. The dot-prefixed folder is inert to every
 * backlog scanner, so an archived mirror survives a `syncRebuild.run()` and the
 * row is untouched.
 *
 * The fixture seeds task ROWS directly with controlled timestamps — the age
 * signal is `closed_at`, falling back to `updated_at` when it is null —
 * because `task.create` always stamps the current instant, so a row old enough
 * to archive cannot be minted through it. Each mirror is written via
 * `MarkdownIo` so it is real, parseable frontmatter.
 */
const migrationsDir = path.resolve('packages/core/src/storage/sqlite/migrations');
const workflowsSrc = path.resolve('packages/core/workflows');
const MONTH = 31 * 86_400_000; // coarse upper bound on a calendar month, in ms

function makeConfig() {
  return ConfigSchema.parse({
    version: '2.0',
    mnema_version: '^0.1.0',
    project: { key: 'TEST', name: 'Test' },
    workflow: 'default',
  });
}

describe('ArchiveService terminal-mirror archival', () => {
  let projectRoot: string;
  let container: ServiceContainer;
  const markdownIo = new MarkdownIo();
  const backlogDir = () => path.join(projectRoot, '.mnema/backlog');
  // Mirrors are filed by the committed id; the fixture seeds a task under
  // `id-${label}`, so a mirror path is keyed off that id.
  const taskId = (label: string) => `id-${label}`;
  const stateMirror = (state: string, label: string) =>
    path.join(backlogDir(), state, `${taskId(label)}.md`);
  const archiveMirror = (state: string, label: string) =>
    path.join(backlogDir(), ARCHIVE_DIRNAME, state, `${taskId(label)}.md`);
  // The short alias the archive reports for a seeded task.
  const taskAlias = (label: string) => deriveAlias('task', taskId(label));

  beforeEach(() => {
    projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-archive-'));
    for (const dir of ['.mnema/state', '.mnema/audit', '.mnema/backlog', '.mnema/workflows']) {
      mkdirSync(path.join(projectRoot, dir), { recursive: true });
    }
    copyFileSync(
      path.join(workflowsSrc, 'default.json'),
      path.join(projectRoot, '.mnema/workflows', 'default.json'),
    );
    container = createServiceContainer(makeConfig(), projectRoot, { migrationsDir });
  });

  afterEach(() => {
    container.close();
    rmSync(projectRoot, { recursive: true, force: true });
  });

  /**
   * Inserts a task row in `state` whose `updated_at` is `ageMs` before `now`,
   * and writes its mirror at `backlog/<STATE>/<KEY>.md`. Bypasses the service
   * layer so the timestamp is exactly controllable (the `updated_at` trigger
   * only fires on UPDATE, so an explicit value on INSERT survives).
   */
  function seedTaskWithMirror(label: string, state: string, ageMs: number, now: number): void {
    const db = container.adapter.getDatabase();
    const project = db.prepare('SELECT id FROM projects LIMIT 1').get() as { id: string };
    let actor = db.prepare('SELECT id FROM actors LIMIT 1').get() as { id: string } | undefined;
    if (actor === undefined) {
      db.prepare("INSERT INTO actors (id, handle, kind) VALUES ('act-1', 'daniel', 'human')").run();
      actor = { id: 'act-1' };
    }
    const id = taskId(label);
    const at = new Date(now - ageMs).toISOString();
    db.prepare(
      `INSERT INTO tasks (id, project_id, title, description, acceptance_criteria, state,
         priority, reporter_id, assignee_id, reopen_count, metadata, created_at, updated_at)
       VALUES (?, ?, ?, '', '[]', ?, 3, ?, ?, 0, '{}', ?, ?)`,
    ).run(id, project.id, `Task ${label}`, state, actor.id, actor.id, at, at);

    mkdirSync(path.dirname(stateMirror(state, label)), { recursive: true });
    markdownIo.write(stateMirror(state, label), {
      mnemaData: { id, state, title: `Task ${label}`, updated_at: at },
      otherFrontmatter: {},
      content: `# Task ${label}\n`,
    });
  }

  it('moves an old DONE mirror into .archive/DONE/<KEY>.md and leaves the row', () => {
    const now = Date.now();
    seedTaskWithMirror('TEST-1', 'DONE', 8 * MONTH, now);

    const result = container.archive.archiveTerminalMirrors({
      months: 6,
      dryRun: false,
      now: new Date(now),
    });

    expect(result.movedCount).toBe(1);
    expect(result.dryRun).toBe(false);
    expect(result.archived).toEqual([
      {
        key: taskAlias('TEST-1'),
        state: 'DONE',
        fromPath: stateMirror('DONE', 'TEST-1'),
        toPath: archiveMirror('DONE', 'TEST-1'),
      },
    ]);
    // Mirror moved: gone from the state folder, present under .archive/DONE/.
    expect(existsSync(stateMirror('DONE', 'TEST-1'))).toBe(false);
    expect(existsSync(archiveMirror('DONE', 'TEST-1'))).toBe(true);
    // The SQLite row (source of truth) is never touched.
    expect(
      container.adapter
        .getDatabase()
        .prepare('SELECT id FROM tasks WHERE id = ?')
        .get(taskId('TEST-1')),
    ).toEqual({
      id: taskId('TEST-1'),
    });
  });

  it('archives an old CANCELED mirror under .archive/CANCELED/ too', () => {
    const now = Date.now();
    seedTaskWithMirror('TEST-2', 'CANCELED', 12 * MONTH, now);

    const result = container.archive.archiveTerminalMirrors({
      months: 6,
      dryRun: false,
      now: new Date(now),
    });

    expect(result.movedCount).toBe(1);
    expect(existsSync(archiveMirror('CANCELED', 'TEST-2'))).toBe(true);
    expect(existsSync(stateMirror('CANCELED', 'TEST-2'))).toBe(false);
  });

  it('leaves a DONE mirror newer than the cutoff in place', () => {
    const now = Date.now();
    // 2 months old, cutoff is 6 months → newer than cutoff, must NOT move.
    seedTaskWithMirror('TEST-3', 'DONE', 2 * MONTH, now);

    const result = container.archive.archiveTerminalMirrors({
      months: 6,
      dryRun: false,
      now: new Date(now),
    });

    expect(result.movedCount).toBe(0);
    expect(result.archived).toEqual([]);
    expect(existsSync(stateMirror('DONE', 'TEST-3'))).toBe(true);
    expect(existsSync(archiveMirror('DONE', 'TEST-3'))).toBe(false);
  });

  it('keys off closed_at: an old close with a recent edit is still archived', () => {
    const now = Date.now();
    // Closed 8 months ago (past the cutoff) but edited 1 month ago (within it).
    // Keying off updated_at would keep it; keying off closed_at archives it.
    const closedAt = new Date(now - 8 * MONTH).toISOString();
    const updatedAt = new Date(now - 1 * MONTH).toISOString();
    const db = container.adapter.getDatabase();
    const project = db.prepare('SELECT id FROM projects LIMIT 1').get() as { id: string };
    let actor = db.prepare('SELECT id FROM actors LIMIT 1').get() as { id: string } | undefined;
    if (actor === undefined) {
      db.prepare("INSERT INTO actors (id, handle, kind) VALUES ('act-1', 'daniel', 'human')").run();
      actor = { id: 'act-1' };
    }
    db.prepare(
      `INSERT INTO tasks (id, project_id, title, description, acceptance_criteria, state,
         priority, reporter_id, assignee_id, reopen_count, metadata, created_at, updated_at, closed_at)
       VALUES (?, ?, ?, '', '[]', 'DONE', 3, ?, ?, 0, '{}', ?, ?, ?)`,
    ).run(
      taskId('TEST-9'),
      project.id,
      'Task TEST-9',
      actor.id,
      actor.id,
      closedAt,
      updatedAt,
      closedAt,
    );
    mkdirSync(path.dirname(stateMirror('DONE', 'TEST-9')), { recursive: true });
    markdownIo.write(stateMirror('DONE', 'TEST-9'), {
      mnemaData: {
        id: taskId('TEST-9'),
        state: 'DONE',
        title: 'Task TEST-9',
        updated_at: updatedAt,
      },
      otherFrontmatter: {},
      content: '# Task TEST-9\n',
    });

    const result = container.archive.archiveTerminalMirrors({
      months: 6,
      dryRun: false,
      now: new Date(now),
    });

    expect(result.movedCount).toBe(1);
    expect(existsSync(stateMirror('DONE', 'TEST-9'))).toBe(false);
    expect(existsSync(archiveMirror('DONE', 'TEST-9'))).toBe(true);
  });

  it('never archives a non-terminal mirror, however old', () => {
    const now = Date.now();
    // 24 months old but IN_REVIEW (not terminal) → never selected.
    seedTaskWithMirror('TEST-4', 'IN_REVIEW', 24 * MONTH, now);

    const result = container.archive.archiveTerminalMirrors({
      months: 6,
      dryRun: false,
      now: new Date(now),
    });

    expect(result.movedCount).toBe(0);
    expect(existsSync(stateMirror('IN_REVIEW', 'TEST-4'))).toBe(true);
    expect(existsSync(archiveMirror('IN_REVIEW', 'TEST-4'))).toBe(false);
  });

  it('dry run (the default) moves nothing but reports the plan', () => {
    const now = Date.now();
    seedTaskWithMirror('TEST-5', 'DONE', 8 * MONTH, now);

    // Omit dryRun entirely to prove the default is dry.
    const result = container.archive.archiveTerminalMirrors({ months: 6, now: new Date(now) });

    expect(result.dryRun).toBe(true);
    expect(result.movedCount).toBe(0);
    // The plan still names what WOULD move, with the destination path.
    expect(result.archived).toEqual([
      {
        key: taskAlias('TEST-5'),
        state: 'DONE',
        fromPath: stateMirror('DONE', 'TEST-5'),
        toPath: archiveMirror('DONE', 'TEST-5'),
      },
    ]);
    // Nothing on disk changed.
    expect(existsSync(stateMirror('DONE', 'TEST-5'))).toBe(true);
    expect(existsSync(archiveMirror('DONE', 'TEST-5'))).toBe(false);
  });

  it('disambiguates a name collision in the archive with a .N suffix', () => {
    const now = Date.now();
    seedTaskWithMirror('TEST-6', 'DONE', 8 * MONTH, now);
    // A prior archive already holds .archive/DONE/<id>.md — force a collision.
    mkdirSync(path.dirname(archiveMirror('DONE', 'TEST-6')), { recursive: true });
    markdownIo.write(archiveMirror('DONE', 'TEST-6'), {
      mnemaData: { id: taskId('TEST-6'), state: 'DONE' },
      otherFrontmatter: {},
      content: '# stale archived copy\n',
    });

    const result = container.archive.archiveTerminalMirrors({
      months: 6,
      dryRun: false,
      now: new Date(now),
    });

    expect(result.movedCount).toBe(1);
    const expectedDest = path.join(
      backlogDir(),
      ARCHIVE_DIRNAME,
      'DONE',
      `${taskId('TEST-6')}.1.md`,
    );
    expect(result.archived[0]?.toPath).toBe(expectedDest);
    expect(existsSync(expectedDest)).toBe(true);
    // The original collided copy is preserved, the state-folder mirror is gone.
    expect(existsSync(archiveMirror('DONE', 'TEST-6'))).toBe(true);
    expect(existsSync(stateMirror('DONE', 'TEST-6'))).toBe(false);
  });

  it('honours the injected clock — the same age flips with a later now', () => {
    const base = Date.now();
    // 4 months old relative to `base`: below a 6-month cutoff → not archived.
    seedTaskWithMirror('TEST-7', 'DONE', 4 * MONTH, base);

    const early = container.archive.archiveTerminalMirrors({
      months: 6,
      dryRun: false,
      now: new Date(base),
    });
    expect(early.movedCount).toBe(0);
    expect(existsSync(stateMirror('DONE', 'TEST-7'))).toBe(true);

    // Advance the injected clock by 3 months: the row's updated_at (unchanged)
    // is now 7 months behind → the SAME task crosses the cutoff and archives.
    const late = container.archive.archiveTerminalMirrors({
      months: 6,
      dryRun: false,
      now: new Date(base + 3 * MONTH),
    });
    expect(late.movedCount).toBe(1);
    expect(existsSync(archiveMirror('DONE', 'TEST-7'))).toBe(true);
    expect(existsSync(stateMirror('DONE', 'TEST-7'))).toBe(false);
  });

  it('leaves the archived file inert across syncRebuild.run(): row kept, no mirror resurrected, archive intact', () => {
    const now = Date.now();
    seedTaskWithMirror('TEST-8', 'DONE', 8 * MONTH, now);

    container.archive.archiveTerminalMirrors({ months: 6, dryRun: false, now: new Date(now) });
    expect(existsSync(archiveMirror('DONE', 'TEST-8'))).toBe(true);
    expect(existsSync(stateMirror('DONE', 'TEST-8'))).toBe(false);

    // A full ingest rebuild (markdown → DB). The dot-prefixed archive folder is
    // not a workflow state, so its contents are never scanned: the archived
    // mirror is neither ingested nor deleted, and no DONE/<KEY>.md is written
    // back (rebuild ingests, it does not materialise mirrors).
    const summary = container.syncRebuild.run('TEST');

    // The archived file still exists and no state-folder mirror reappeared.
    expect(existsSync(archiveMirror('DONE', 'TEST-8'))).toBe(true);
    expect(existsSync(stateMirror('DONE', 'TEST-8'))).toBe(false);
    // The row survived the whole cycle (source of truth, never row-gated away).
    expect(
      container.adapter
        .getDatabase()
        .prepare('SELECT state FROM tasks WHERE id = ?')
        .get(taskId('TEST-8')),
    ).toEqual({
      state: 'DONE',
    });
    // The archived mirror contributed nothing to the ingest and raised no
    // "unknown workflow state" skip (its files live one level below .archive/).
    expect(summary.skipped.some((s) => s.file.includes(ARCHIVE_DIRNAME))).toBe(false);
  });
});
