import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ActorKind } from '@/domain/enums/actor-kind.js';
import { ErrorCode } from '@/errors/error-codes.js';
import { AuditService } from '@/services/audit-service.js';
import { IdentityService } from '@/services/identity-service.js';
import { ObservationService } from '@/services/observation-service.js';
import { AuditWriter } from '@/storage/audit/audit-writer.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { ActorRepository } from '@/storage/sqlite/repositories/actor-repository.js';
import { ObservationRepository } from '@/storage/sqlite/repositories/observation-repository.js';
import { ProjectRepository } from '@/storage/sqlite/repositories/project-repository.js';
import { TaskRepository } from '@/storage/sqlite/repositories/task-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

const migrationsDir = path.resolve('src/storage/sqlite/migrations');

describe('ObservationService', () => {
  let tempRoot: string;
  let adapter: SqliteAdapter;
  let service: ObservationService;
  let tasks: TaskRepository;
  let actorId: string;
  let projectId: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-obs-svc-'));
    adapter = new SqliteAdapter(path.join(tempRoot, 'state.db'));
    new MigrationRunner().run(adapter, migrationsDir);

    const audit = new AuditService(new AuditWriter(path.join(tempRoot, '.audit')));
    const repo = new ObservationRepository(adapter);
    tasks = new TaskRepository(adapter);
    const identity = new IdentityService(new ActorRepository(adapter));
    actorId = identity.ensureActor('daniel', ActorKind.Human);

    const projects = new ProjectRepository(adapter);
    const project = projects.insert({ key: 'TEST', name: 'Test' });
    projectId = project.id;

    service = new ObservationService(repo, tasks, identity, audit);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('records an observation without related task', () => {
    const result = service.record({
      content: 'Build is flaky on Fridays',
      topics: ['ci'],
      actor: 'daniel',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.content).toBe('Build is flaky on Fridays');
    expect(result.value.relatedTaskId).toBeNull();
  });

  it('records an observation linked to a task', () => {
    const task = tasks.insert({
      key: 'TEST-1',
      projectId,
      title: 'something',
      reporterId: actorId,
      state: 'DRAFT',
    });
    const result = service.record({
      content: 'noticed flakiness',
      relatedTaskKey: 'TEST-1',
      actor: 'daniel',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.relatedTaskId).toBe(task.id);
  });

  it('errors out when related task is unknown', () => {
    const result = service.record({
      content: 'x',
      relatedTaskKey: 'TEST-999',
      actor: 'daniel',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe(ErrorCode.TaskNotFound);
  });

  it('list filters by topic and respects limit', () => {
    service.record({ content: 'a', topics: ['x'], actor: 'daniel' });
    service.record({ content: 'b', topics: ['y'], actor: 'daniel' });
    service.record({ content: 'c', topics: ['x'], actor: 'daniel' });

    expect(service.list({ topic: 'x' })).toHaveLength(2);
    expect(service.list({ limit: 2 })).toHaveLength(2);
  });
});
