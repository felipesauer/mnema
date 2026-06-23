import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { StateMachine } from '@/domain/state-machine/state-machine.js';
import { WorkflowLoader } from '@/domain/state-machine/workflow-loader.js';
import { ErrorCode } from '@/errors/error-codes.js';
import { CoverageService } from '@/services/coverage-service.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { EpicRepository } from '@/storage/sqlite/repositories/epic-repository.js';
import { ProjectRepository } from '@/storage/sqlite/repositories/project-repository.js';
import { SprintRepository } from '@/storage/sqlite/repositories/sprint-repository.js';
import { TaskRepository } from '@/storage/sqlite/repositories/task-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

const migrationsDir = path.resolve('src/storage/sqlite/migrations');

describe('CoverageService', () => {
  let tempRoot: string;
  let adapter: SqliteAdapter;
  let coverage: CoverageService;
  let epics: EpicRepository;
  let sprints: SprintRepository;
  let tasks: TaskRepository;
  let projectId: string;
  let actorId: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-cov-'));
    adapter = new SqliteAdapter(path.join(tempRoot, 'state.db'));
    new MigrationRunner().run(adapter, migrationsDir);

    const projects = new ProjectRepository(adapter);
    projectId = projects.insert({ key: 'TEST', name: 'Test' }).id;

    actorId = 'a1';
    adapter
      .getDatabase()
      .prepare("INSERT INTO actors (id, handle, kind) VALUES (?, 'daniel', 'human')")
      .run(actorId);

    epics = new EpicRepository(adapter);
    sprints = new SprintRepository(adapter);
    tasks = new TaskRepository(adapter);
    const stateMachine = new StateMachine(
      new WorkflowLoader().load(path.resolve('workflows/default.json')),
    );
    coverage = new CoverageService(epics, sprints, tasks, stateMachine);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  function makeTask(key: string, state = 'DRAFT'): string {
    const task = tasks.insert({ key, projectId, title: key, reporterId: actorId });
    if (state !== 'DRAFT') tasks.updateState(task.id, state);
    return task.id;
  }

  it('reports 0% for an empty epic', () => {
    const epic = epics.insert({ key: 'TEST-EPIC-1', projectId, title: 'E1' });
    const result = coverage.forEpic('TEST-EPIC-1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.total).toBe(0);
    expect(result.value.percent).toBe(0);
    expect(result.value.open).toEqual([]);
    void epic;
  });

  it('computes terminal count, percent, breakdown and open list for an epic', () => {
    const epic = epics.insert({ key: 'TEST-EPIC-1', projectId, title: 'E1' });
    const done1 = makeTask('TEST-1', 'DONE');
    const done2 = makeTask('TEST-2', 'DONE');
    const inProgress = makeTask('TEST-3', 'IN_PROGRESS');
    const ready = makeTask('TEST-4', 'READY');
    epics.addTask(epic.id, done1);
    epics.addTask(epic.id, done2);
    epics.addTask(epic.id, inProgress);
    epics.addTask(epic.id, ready);

    const result = coverage.forEpic('TEST-EPIC-1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.total).toBe(4);
    expect(result.value.terminal).toBe(2); // two DONE
    expect(result.value.percent).toBe(50);
    expect(result.value.byState.DONE).toBe(2);
    expect(result.value.byState.IN_PROGRESS).toBe(1);
    expect(result.value.byState.READY).toBe(1);
    expect(result.value.open.sort()).toEqual(['TEST-3', 'TEST-4']);
  });

  it('counts CANCELED as terminal (workflow-driven)', () => {
    const epic = epics.insert({ key: 'TEST-EPIC-1', projectId, title: 'E1' });
    const canceled = makeTask('TEST-1', 'CANCELED');
    const done = makeTask('TEST-2', 'DONE');
    epics.addTask(epic.id, canceled);
    epics.addTask(epic.id, done);

    const result = coverage.forEpic('TEST-EPIC-1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.terminal).toBe(2);
    expect(result.value.percent).toBe(100);
    expect(result.value.open).toEqual([]);
  });

  it('counts BLOCKED tasks in the blocked field and keeps them open', () => {
    const epic = epics.insert({ key: 'TEST-EPIC-1', projectId, title: 'E1' });
    epics.addTask(epic.id, makeTask('TEST-1', 'BLOCKED'));
    epics.addTask(epic.id, makeTask('TEST-2', 'DONE'));

    const result = coverage.forEpic('TEST-EPIC-1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.blocked).toBe(1);
    expect(result.value.open).toEqual(['TEST-1']);
    expect(result.value.percent).toBe(50);
  });

  it('scopes coverage to a sprint', () => {
    const sprint = sprints.insert({ projectId, key: 'TEST-SPRINT-1', name: 'S1' });
    const inSprint = makeTask('TEST-1', 'DONE');
    makeTask('TEST-2', 'READY'); // not in sprint
    sprints.addTask(sprint.id, inSprint);

    const result = coverage.forSprint('TEST-SPRINT-1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.total).toBe(1);
    expect(result.value.percent).toBe(100);
  });

  it('returns EpicNotFound for an unknown epic', () => {
    const result = coverage.forEpic('NOPE-EPIC-9');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe(ErrorCode.EpicNotFound);
  });

  it('returns SprintNotFound for an unknown sprint', () => {
    const result = coverage.forSprint('NOPE-SPRINT-9');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe(ErrorCode.SprintNotFound);
  });
});
