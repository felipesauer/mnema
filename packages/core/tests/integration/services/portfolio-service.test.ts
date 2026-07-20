import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { deriveAlias } from '@/domain/entity-alias.js';
import { TaskState } from '@/domain/enums/task-state.js';
import { PortfolioService } from '@/services/knowledge/portfolio-service.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { EpicRepository } from '@/storage/sqlite/repositories/epic-repository.js';
import { LabelRepository } from '@/storage/sqlite/repositories/label-repository.js';
import { ProjectRepository } from '@/storage/sqlite/repositories/project-repository.js';
import { SprintRepository } from '@/storage/sqlite/repositories/sprint-repository.js';
import { TaskRepository } from '@/storage/sqlite/repositories/task-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

const migrationsDir = path.resolve('packages/core/src/storage/sqlite/migrations');

describe('PortfolioService', () => {
  let tempRoot: string;
  let adapter: SqliteAdapter;
  let portfolio: PortfolioService;
  let tasks: TaskRepository;
  let epics: EpicRepository;
  let sprints: SprintRepository;
  let labels: LabelRepository;
  let projectId: string;
  let actorId: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-portfolio-'));
    adapter = new SqliteAdapter(path.join(tempRoot, 'state.db'));
    new MigrationRunner().run(adapter, migrationsDir);
    const projects = new ProjectRepository(adapter);
    projectId = projects.insert({ key: 'TEST', name: 'Test' }).id;
    adapter
      .getDatabase()
      .prepare("INSERT INTO actors (id, handle, kind) VALUES ('act-1', 'daniel', 'human')")
      .run();
    actorId = 'act-1';
    tasks = new TaskRepository(adapter);
    epics = new EpicRepository(adapter);
    sprints = new SprintRepository(adapter);
    labels = new LabelRepository(adapter);
    portfolio = new PortfolioService(tasks, epics, sprints, labels);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  /** The alias the portfolio surfaces for a task seeded under `id-${label}`. */
  function alias(label: string): string {
    return deriveAlias('task', `id-${label}`);
  }

  /** Insert a task with a controllable state / epic / sprint / createdAt. */
  function seed(
    label: string,
    opts: {
      state?: TaskState;
      epicId?: string;
      sprintId?: string;
      createdAt?: string;
      title?: string;
      description?: string;
    } = {},
  ): void {
    const at = opts.createdAt ?? new Date().toISOString();
    adapter
      .getDatabase()
      .prepare(
        `INSERT INTO tasks (id, project_id, epic_id, sprint_id, title, description,
           acceptance_criteria, state, priority, reporter_id, reopen_count, metadata,
           created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, '[]', ?, 3, ?, 0, '{}', ?, ?)`,
      )
      .run(
        `id-${label}`,
        projectId,
        opts.epicId ?? null,
        opts.sprintId ?? null,
        opts.title ?? `Task ${label}`,
        opts.description ?? null,
        opts.state ?? TaskState.Draft,
        actorId,
        at,
        at,
      );
  }

  it('returns the whole backlog with per-state counts when unfiltered', () => {
    seed('TEST-1', { state: TaskState.Draft });
    seed('TEST-2', { state: TaskState.InReview });
    seed('TEST-3', { state: TaskState.InReview });
    const r = portfolio.run();
    expect(r.total).toBe(3);
    expect(r.by_state).toEqual({ DRAFT: 1, IN_REVIEW: 2 });
    expect(r.tasks.map((t) => t.key).sort()).toEqual(
      [alias('TEST-1'), alias('TEST-2'), alias('TEST-3')].sort(),
    );
  });

  it('filters by state', () => {
    seed('TEST-1', { state: TaskState.Draft });
    seed('TEST-2', { state: TaskState.InReview });
    const r = portfolio.run({ state: 'IN_REVIEW' });
    expect(r.total).toBe(1);
    expect(r.tasks[0]?.key).toBe(alias('TEST-2'));
  });

  it('filters by epic handle (and an unknown epic yields empty, not unfiltered)', () => {
    const epic = epics.insert({ projectId, title: 'Epic A' });
    seed('TEST-1', { epicId: epic.id });
    seed('TEST-2', {});
    expect(portfolio.run({ epicKey: epic.id }).total).toBe(1);
    // Unknown handle must NOT silently return everything.
    expect(portfolio.run({ epicKey: 'e-ffffffff' }).total).toBe(0);
  });

  it('filters by a creation window', () => {
    seed('OLD-1', { createdAt: '2026-01-01T00:00:00.000Z' });
    seed('NEW-1', { createdAt: '2026-06-01T00:00:00.000Z' });
    const r = portfolio.run({ createdSince: '2026-03-01T00:00:00.000Z' });
    expect(r.tasks.map((t) => t.key)).toEqual([alias('NEW-1')]);
  });

  it('excludes a task with an unparseable createdAt from a window query', () => {
    seed('GOOD-1', { createdAt: '2026-06-01T00:00:00.000Z' });
    seed('BAD-1', { createdAt: 'not-a-date' });
    // With a window active, a row of unknown date cannot be shown to fall
    // inside it, so it is excluded (not silently kept).
    const r = portfolio.run({ createdSince: '2026-03-01T00:00:00.000Z' });
    expect(r.tasks.map((t) => t.key)).toEqual([alias('GOOD-1')]);
    // Without a window, the same row is returned normally.
    expect(
      portfolio
        .run()
        .tasks.map((t) => t.key)
        .sort(),
    ).toEqual([alias('BAD-1'), alias('GOOD-1')].sort());
  });

  it('filters by free text over title and description', () => {
    seed('TEST-1', { title: 'Wire the OAuth flow' });
    seed('TEST-2', { title: 'Unrelated', description: 'touches the oauth token cache' });
    seed('TEST-3', { title: 'Nothing here' });
    const r = portfolio.run({ text: 'oauth' });
    expect(r.tasks.map((t) => t.key).sort()).toEqual([alias('TEST-1'), alias('TEST-2')].sort());
  });

  it('combines filters with AND', () => {
    const epic = epics.insert({ projectId, title: 'Epic A' });
    seed('TEST-1', { state: TaskState.InReview, epicId: epic.id });
    seed('TEST-2', { state: TaskState.Draft, epicId: epic.id });
    seed('TEST-3', { state: TaskState.InReview });
    const r = portfolio.run({ state: 'IN_REVIEW', epicKey: epic.id });
    expect(r.tasks.map((t) => t.key)).toEqual([alias('TEST-1')]);
  });

  it('filters by a single label and surfaces labels on each row', () => {
    seed('TEST-1');
    seed('TEST-2');
    labels.setForTask('id-TEST-1', ['area:api']);
    const r = portfolio.run({ labels: ['area:api'] });
    expect(r.tasks.map((t) => t.key)).toEqual([alias('TEST-1')]);
    expect(r.tasks[0]?.labels).toEqual(['area:api']);
  });

  it('AND-combines multiple labels (task must carry all of them)', () => {
    seed('TEST-1');
    seed('TEST-2');
    labels.setForTask('id-TEST-1', ['area:api', 'tipo:bug']);
    labels.setForTask('id-TEST-2', ['area:api']);
    // Only TEST-1 carries both.
    expect(portfolio.run({ labels: ['area:api', 'tipo:bug'] }).tasks.map((t) => t.key)).toEqual([
      alias('TEST-1'),
    ]);
    // area:api alone matches both.
    expect(
      portfolio
        .run({ labels: ['area:api'] })
        .tasks.map((t) => t.key)
        .sort(),
    ).toEqual([alias('TEST-1'), alias('TEST-2')].sort());
  });

  it('an unknown label yields empty, not unfiltered', () => {
    seed('TEST-1');
    labels.setForTask('id-TEST-1', ['area:api']);
    expect(portfolio.run({ labels: ['area:nope'] }).total).toBe(0);
  });

  it('filters by sprint handle (and an unknown sprint yields empty)', () => {
    const sprint = sprints.insert({ projectId, name: 'S1' });
    seed('TEST-1', { sprintId: sprint.id });
    seed('TEST-2', {});
    expect(portfolio.run({ sprintKey: sprint.id }).total).toBe(1);
    // Unknown handle resolves to the NO_MATCH sentinel → empty, not everything.
    expect(portfolio.run({ sprintKey: 's-ffffffff' }).total).toBe(0);
  });

  it('pushes state/epic/sprint equality into the repository query', () => {
    const epic = epics.insert({ projectId, title: 'E' });
    const sprint = sprints.insert({ projectId, name: 'S1' });
    seed('TEST-1', { state: TaskState.InReview, epicId: epic.id, sprintId: sprint.id });

    const spy = vi.spyOn(tasks, 'findActiveLean');
    portfolio.run({ state: 'IN_REVIEW', epicKey: epic.id, sprintKey: sprint.id });

    // The equality filters are handed to SQL, not applied in JS afterward.
    expect(spy).toHaveBeenCalledWith({
      state: 'IN_REVIEW',
      epicId: epic.id,
      sprintId: sprint.id,
    });
    spy.mockRestore();
  });
});
