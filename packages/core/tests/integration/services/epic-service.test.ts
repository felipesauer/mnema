import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { deriveAlias } from '@/domain/entity-alias.js';
import { EpicState } from '@/domain/enums/epic-state.js';
import { StateMachine } from '@/domain/state-machine/state-machine.js';
import { ErrorCode } from '@/errors/error-codes.js';
import { EpicService } from '@/services/backlog/epic-service.js';
import { AuditService } from '@/services/integrity/audit-service.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { EpicRepository } from '@/storage/sqlite/repositories/epic-repository.js';
import { ProjectRepository } from '@/storage/sqlite/repositories/project-repository.js';
import { TaskRepository } from '@/storage/sqlite/repositories/task-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';
import { loadWorkflowFile } from '@/storage/workflow-file.js';
import { chainedAuditWriter } from '../../setup/audit-writer.js';

const migrationsDir = path.resolve('packages/core/src/storage/sqlite/migrations');

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

    const audit = new AuditService(chainedAuditWriter(adapter, path.join(tempRoot, '.audit')));
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
      loadWorkflowFile(path.resolve('packages/core/workflows/default.json')),
    );
    epics = new EpicService(new EpicRepository(adapter), tasks, projects, audit, stateMachine);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('creates an epic in OPEN state', () => {
    const result = epics.create({
      projectKey: 'TEST',
      title: 'Cart redesign',
      description: 'Q3 effort',
      actor: 'daniel',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.id).toBeTruthy();
    expect(result.value.state).toBe(EpicState.Open);
    expect(result.value.title).toBe('Cart redesign');
  });

  it('closes an OPEN epic and stamps closedAt', () => {
    const created = epics.create({ projectKey: 'TEST', title: 'Title A', actor: 'daniel' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const closed = epics.close({ epicKey: created.value.id, actor: 'daniel' });
    expect(closed.ok).toBe(true);
    if (!closed.ok) return;
    expect(closed.value.state).toBe(EpicState.Closed);
    expect(closed.value.closedAt).not.toBeNull();
  });

  it('rejects close on a CLOSED epic', () => {
    const created = epics.create({ projectKey: 'TEST', title: 'Title A', actor: 'daniel' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    epics.close({ epicKey: created.value.id, actor: 'daniel' });

    const second = epics.close({ epicKey: created.value.id, actor: 'daniel' });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.kind).toBe(ErrorCode.EpicInvalidState);
  });

  it('attaches and removes tasks from an epic', () => {
    const task = tasks.insert({ projectId, title: 'A', reporterId: actorId });
    const created = epics.create({ projectKey: 'TEST', title: 'Cart', actor: 'daniel' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const added = epics.addTask({
      epicKey: created.value.id,
      taskKey: task.id,
      actor: 'daniel',
    });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.value.epicId).not.toBeNull();

    const view = epics.show(created.value.id);
    expect(view.ok).toBe(true);
    if (!view.ok) return;
    expect([...view.value.taskKeys]).toEqual([deriveAlias('task', task.id)]);

    const removed = epics.removeTask({
      epicKey: created.value.id,
      taskKey: task.id,
      actor: 'daniel',
    });
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.value.epicId).toBeNull();
  });

  it('show returns EPIC_NOT_FOUND when the handle is unknown', () => {
    const result = epics.show('e-ffff');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe(ErrorCode.EpicNotFound);
  });

  it('list filters by state when provided', () => {
    const first = epics.create({ projectKey: 'TEST', title: 'Title A', actor: 'daniel' });
    const second = epics.create({ projectKey: 'TEST', title: 'Title B', actor: 'daniel' });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    epics.close({ epicKey: first.value.id, actor: 'daniel' });

    const open = epics.list('TEST', EpicState.Open);
    expect(open.map((e) => e.id)).toEqual([second.value.id]);

    const closed = epics.list('TEST', EpicState.Closed);
    expect(closed.map((e) => e.id)).toEqual([first.value.id]);
  });

  it('refuses to create an epic on a workflow with features.epics=false', () => {
    const audit = new AuditService(chainedAuditWriter(adapter, path.join(tempRoot, '.audit-lean')));
    const leanMachine = new StateMachine(
      loadWorkflowFile(path.resolve('packages/core/tests/fixtures/workflows/lean.json')),
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

  it('refuses an over-long title via the service (CLI/MCP parity)', () => {
    const result = epics.create({
      projectKey: 'TEST',
      title: 'x'.repeat(201),
      actor: 'daniel',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe(ErrorCode.ValidationFailed);
    if (result.error.kind !== ErrorCode.ValidationFailed) return;
    expect(result.error.issues[0]?.path).toEqual(['title']);
    // Nothing persisted — the guard precedes the insert.
    expect(epics.list('TEST')).toHaveLength(0);
  });
});
