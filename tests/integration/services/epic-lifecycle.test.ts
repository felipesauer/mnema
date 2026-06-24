import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { StateMachine } from '@/domain/state-machine/state-machine.js';
import { WorkflowLoader } from '@/domain/state-machine/workflow-loader.js';
import { AuditService } from '@/services/audit-service.js';
import { EpicService } from '@/services/epic-service.js';
import { AuditWriter } from '@/storage/audit/audit-writer.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { EpicRepository } from '@/storage/sqlite/repositories/epic-repository.js';
import { ProjectRepository } from '@/storage/sqlite/repositories/project-repository.js';
import { TaskRepository } from '@/storage/sqlite/repositories/task-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

const migrationsDir = path.resolve('src/storage/sqlite/migrations');

describe('EpicService derived lifecycle', () => {
  let tempRoot: string;
  let adapter: SqliteAdapter;
  let epics: EpicService;
  let epicRepo: EpicRepository;
  let tasks: TaskRepository;
  let projectId: string;
  let actorId: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-epiclc-'));
    adapter = new SqliteAdapter(path.join(tempRoot, 'state.db'));
    new MigrationRunner().run(adapter, migrationsDir);

    const audit = new AuditService(new AuditWriter(path.join(tempRoot, '.audit')));
    const projects = new ProjectRepository(adapter);
    projectId = projects.insert({ key: 'TEST', name: 'Test' }).id;
    actorId = 'a1';
    adapter
      .getDatabase()
      .prepare("INSERT INTO actors (id, handle, kind) VALUES (?, 'daniel', 'human')")
      .run(actorId);

    epicRepo = new EpicRepository(adapter);
    tasks = new TaskRepository(adapter);
    const stateMachine = new StateMachine(
      new WorkflowLoader().load(path.resolve('workflows/default.json')),
    );
    epics = new EpicService(epicRepo, tasks, projects, audit, stateMachine);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  function makeTaskInEpic(key: string, epicId: string, state = 'DRAFT'): void {
    const task = tasks.insert({ key, projectId, title: key, reporterId: actorId });
    epicRepo.addTask(epicId, task.id);
    if (state !== 'DRAFT') tasks.updateState(task.id, state);
  }

  function lifecycleOf(epicKey: string): string {
    const result = epics.show(epicKey);
    if (!result.ok) throw new Error('epic not found');
    return result.value.lifecycle;
  }

  it("is 'empty' for an OPEN epic with no tasks", () => {
    epicRepo.insert({ key: 'TEST-EPIC-1', projectId, title: 'E1' });
    expect(lifecycleOf('TEST-EPIC-1')).toBe('empty');
  });

  it("is 'in-progress' when an OPEN epic has a non-terminal task", () => {
    const epic = epicRepo.insert({ key: 'TEST-EPIC-1', projectId, title: 'E1' });
    makeTaskInEpic('TEST-1', epic.id, 'DONE');
    makeTaskInEpic('TEST-2', epic.id, 'IN_PROGRESS');
    expect(lifecycleOf('TEST-EPIC-1')).toBe('in-progress');
  });

  it("is 'developed' when every task of an OPEN epic is terminal", () => {
    const epic = epicRepo.insert({ key: 'TEST-EPIC-1', projectId, title: 'E1' });
    makeTaskInEpic('TEST-1', epic.id, 'DONE');
    makeTaskInEpic('TEST-2', epic.id, 'CANCELED');
    expect(lifecycleOf('TEST-EPIC-1')).toBe('developed');
  });

  it("is 'closed' once the epic is closed, regardless of tasks", () => {
    const epic = epicRepo.insert({ key: 'TEST-EPIC-1', projectId, title: 'E1' });
    makeTaskInEpic('TEST-1', epic.id, 'IN_PROGRESS');
    epics.close({ epicKey: 'TEST-EPIC-1', actor: 'daniel' });
    expect(lifecycleOf('TEST-EPIC-1')).toBe('closed');
  });
});
