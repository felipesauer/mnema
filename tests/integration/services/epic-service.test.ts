import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { EpicState } from '@/domain/enums/epic-state.js';
import { StateMachine } from '@/domain/state-machine/state-machine.js';
import { WorkflowLoader } from '@/domain/state-machine/workflow-loader.js';
import { ErrorCode } from '@/errors/error-codes.js';
import { AuditService } from '@/services/audit-service.js';
import { EpicService } from '@/services/epic-service.js';
import { AuditWriter } from '@/storage/audit/audit-writer.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { EpicRepository } from '@/storage/sqlite/repositories/epic-repository.js';
import { ProjectRepository } from '@/storage/sqlite/repositories/project-repository.js';
import { TaskRepository } from '@/storage/sqlite/repositories/task-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

const migrationsDir = path.resolve('src/storage/sqlite/migrations');

describe('EpicService', () => {
  let tempRoot: string;
  let adapter: SqliteAdapter;
  let epics: EpicService;
  let tasks: TaskRepository;
  let projectId: string;
  let actorId: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-epic-svc-'));
    adapter = new SqliteAdapter(path.join(tempRoot, 'state.db'));
    new MigrationRunner().run(adapter, migrationsDir);

    const audit = new AuditService(new AuditWriter(path.join(tempRoot, '.audit')));
    const projects = new ProjectRepository(adapter);
    const project = projects.insert({ key: 'TEST', name: 'Test' });
    projectId = project.id;

    actorId = 'a1';
    adapter
      .getDatabase()
      .prepare("INSERT INTO actors (id, handle, kind) VALUES (?, 'daniel', 'human')")
      .run(actorId);

    tasks = new TaskRepository(adapter);
    const stateMachine = new StateMachine(
      new WorkflowLoader().load(path.resolve('workflows/default.json')),
    );
    epics = new EpicService(new EpicRepository(adapter), tasks, projects, audit, stateMachine);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('creates an epic in OPEN state with key derived from project', () => {
    const result = epics.create({
      projectKey: 'TEST',
      title: 'Cart redesign',
      description: 'Q3 effort',
      actor: 'daniel',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.key).toBe('TEST-EPIC-1');
    expect(result.value.state).toBe(EpicState.Open);
    expect(result.value.title).toBe('Cart redesign');
  });

  it('closes an OPEN epic and stamps closedAt', () => {
    epics.create({ projectKey: 'TEST', title: 'A', actor: 'daniel' });

    const closed = epics.close({ epicKey: 'TEST-EPIC-1', actor: 'daniel' });
    expect(closed.ok).toBe(true);
    if (!closed.ok) return;
    expect(closed.value.state).toBe(EpicState.Closed);
    expect(closed.value.closedAt).not.toBeNull();
  });

  it('rejects close on a CLOSED epic', () => {
    epics.create({ projectKey: 'TEST', title: 'A', actor: 'daniel' });
    epics.close({ epicKey: 'TEST-EPIC-1', actor: 'daniel' });

    const second = epics.close({ epicKey: 'TEST-EPIC-1', actor: 'daniel' });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.kind).toBe(ErrorCode.EpicInvalidState);
  });

  it('attaches and removes tasks from an epic', () => {
    tasks.insert({ key: 'TEST-1', projectId, title: 'A', reporterId: actorId });
    epics.create({ projectKey: 'TEST', title: 'Cart', actor: 'daniel' });

    const added = epics.addTask({
      epicKey: 'TEST-EPIC-1',
      taskKey: 'TEST-1',
      actor: 'daniel',
    });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.value.epicId).not.toBeNull();

    const view = epics.show('TEST-EPIC-1');
    expect(view.ok).toBe(true);
    if (!view.ok) return;
    expect([...view.value.taskKeys]).toEqual(['TEST-1']);

    const removed = epics.removeTask({
      epicKey: 'TEST-EPIC-1',
      taskKey: 'TEST-1',
      actor: 'daniel',
    });
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.value.epicId).toBeNull();
  });

  it('show returns EPIC_NOT_FOUND when the key is unknown', () => {
    const result = epics.show('TEST-EPIC-99');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe(ErrorCode.EpicNotFound);
  });

  it('list filters by state when provided', () => {
    epics.create({ projectKey: 'TEST', title: 'A', actor: 'daniel' });
    epics.create({ projectKey: 'TEST', title: 'B', actor: 'daniel' });
    epics.close({ epicKey: 'TEST-EPIC-1', actor: 'daniel' });

    const open = epics.list('TEST', EpicState.Open);
    expect(open.map((e) => e.key)).toEqual(['TEST-EPIC-2']);

    const closed = epics.list('TEST', EpicState.Closed);
    expect(closed.map((e) => e.key)).toEqual(['TEST-EPIC-1']);
  });

  it('F-E5: refuses to create an epic on a workflow with features.epics=false', () => {
    const audit = new AuditService(new AuditWriter(path.join(tempRoot, '.audit-lean')));
    const leanMachine = new StateMachine(
      new WorkflowLoader().load(path.resolve('workflows/lean.json')),
    );
    const projects = new ProjectRepository(adapter);
    const epicsLean = new EpicService(
      new EpicRepository(adapter),
      tasks,
      projects,
      audit,
      leanMachine,
    );
    const result = epicsLean.create({
      projectKey: 'TEST',
      title: 'should-fail',
      actor: 'daniel',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe(ErrorCode.FeatureNotAvailable);
    if (result.error.kind !== ErrorCode.FeatureNotAvailable) return;
    expect(result.error.feature).toBe('epics');
    expect(result.error.workflow).toBe('lean');
  });
});
