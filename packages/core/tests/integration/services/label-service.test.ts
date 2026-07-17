import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ErrorCode } from '@/errors/error-codes.js';
import { LabelService } from '@/services/backlog/label-service.js';
import { AuditService } from '@/services/integrity/audit-service.js';
import type { SyncService } from '@/services/sync/sync-service.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { LabelRepository } from '@/storage/sqlite/repositories/label-repository.js';
import { ProjectRepository } from '@/storage/sqlite/repositories/project-repository.js';
import { TaskRepository } from '@/storage/sqlite/repositories/task-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';
import { chainedAuditWriter } from '../../setup/audit-writer.js';

const migrationsDir = path.resolve('packages/core/src/storage/sqlite/migrations');

describe('LabelService', () => {
  let tempRoot: string;
  let adapter: SqliteAdapter;
  let labels: LabelService;
  let labelRepo: LabelRepository;
  let tasks: TaskRepository;
  let projectId: string;
  let actorId: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-label-svc-'));
    adapter = new SqliteAdapter(path.join(tempRoot, 'state.db'));
    new MigrationRunner().run(adapter, migrationsDir);
    const audit = new AuditService(chainedAuditWriter(adapter, path.join(tempRoot, '.audit')));
    const projects = new ProjectRepository(adapter);
    projectId = projects.insert({ key: 'TEST', name: 'Test' }).id;
    adapter
      .getDatabase()
      .prepare("INSERT INTO actors (id, handle, kind) VALUES ('a1', 'daniel', 'human')")
      .run();
    actorId = 'a1';
    tasks = new TaskRepository(adapter);
    labelRepo = new LabelRepository(adapter);
    // The markdown mirror is exercised by the sync round-trip test (with a
    // real container); here a no-op sync keeps the service unit focused on
    // persistence + validation.
    const syncStub = { syncTask: () => {} } as unknown as SyncService;
    labels = new LabelService(labelRepo, tasks, audit, syncStub);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  function makeTask(key: string): void {
    tasks.insert({ key, projectId, title: key, reporterId: actorId });
  }

  const id = { actor: 'daniel' };

  it('sets labels on a task and returns them sorted', () => {
    makeTask('TEST-1');
    const result = labels.setLabels({ taskKey: 'TEST-1', labels: ['tipo:bug', 'area:api'], ...id });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(['area:api', 'tipo:bug']);
    // Cross-check straight through the repository, by the task's real id.
    const taskId = tasks.findByKey('TEST-1')?.id ?? '';
    expect(labelRepo.findNamesByTask(taskId)).toEqual(['area:api', 'tipo:bug']);
  });

  it('replaces the whole set (set-semantics), not appends', () => {
    makeTask('TEST-1');
    labels.setLabels({ taskKey: 'TEST-1', labels: ['area:api', 'tipo:bug'], ...id });
    const result = labels.setLabels({ taskKey: 'TEST-1', labels: ['area:web'], ...id });
    expect(result.ok && result.value).toEqual(['area:web']);
  });

  it('clears every label when given an empty array', () => {
    makeTask('TEST-1');
    labels.setLabels({ taskKey: 'TEST-1', labels: ['area:api'], ...id });
    const result = labels.setLabels({ taskKey: 'TEST-1', labels: [], ...id });
    expect(result.ok && result.value).toEqual([]);
    expect(labels.listForTask('TEST-1')).toEqual({ ok: true, value: [] });
  });

  it('de-duplicates and trims label names', () => {
    makeTask('TEST-1');
    const result = labels.setLabels({
      taskKey: 'TEST-1',
      labels: ['  area:api  ', 'area:api', 'tipo:bug'],
      ...id,
    });
    expect(result.ok && result.value).toEqual(['area:api', 'tipo:bug']);
  });

  it('rejects an empty label name', () => {
    makeTask('TEST-1');
    const result = labels.setLabels({ taskKey: 'TEST-1', labels: ['   '], ...id });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe(ErrorCode.ValidationFailed);
  });

  it('rejects a label containing a comma', () => {
    makeTask('TEST-1');
    const result = labels.setLabels({ taskKey: 'TEST-1', labels: ['area:api,tipo:bug'], ...id });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe(ErrorCode.ValidationFailed);
  });

  it('returns TASK_NOT_FOUND for an unknown task', () => {
    const result = labels.setLabels({ taskKey: 'NOPE-1', labels: ['area:api'], ...id });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe(ErrorCode.TaskNotFound);
  });

  it('reports per-label active-task counts most-used first', () => {
    makeTask('TEST-1');
    makeTask('TEST-2');
    makeTask('TEST-3');
    labels.setLabels({ taskKey: 'TEST-1', labels: ['area:api'], ...id });
    labels.setLabels({ taskKey: 'TEST-2', labels: ['area:api', 'tipo:bug'], ...id });
    labels.setLabels({ taskKey: 'TEST-3', labels: ['tipo:bug'], ...id });
    expect(labels.counts()).toEqual([
      { name: 'area:api', count: 2 },
      { name: 'tipo:bug', count: 2 },
    ]);
  });
});
