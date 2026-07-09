import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ActorKind } from '@/domain/enums/actor-kind.js';
import { ErrorCode } from '@/errors/error-codes.js';
import { AuditService } from '@/services/audit-service.js';
import { IdentityService } from '@/services/identity-service.js';
import { OBSERVATION_CONTENT_MAX, ObservationService } from '@/services/observation-service.js';
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

  it('rejects content over the length cap in the service (CLI/MCP parity)', () => {
    const over = 'x'.repeat(OBSERVATION_CONTENT_MAX + 1);
    const result = service.record({ content: over, actor: 'daniel' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe(ErrorCode.ValidationFailed);
    // The message names the exact overflow and points at the fix.
    if (result.error.kind !== ErrorCode.ValidationFailed) return;
    expect(result.error.issues[0]?.message).toMatch(/1 over the 2000 limit/);
    // Nothing was persisted (validation precedes the insert + audit write).
    expect(service.list()).toHaveLength(0);
  });

  it('accepts content exactly at the cap', () => {
    const atCap = 'x'.repeat(OBSERVATION_CONTENT_MAX);
    const result = service.record({ content: atCap, actor: 'daniel' });
    expect(result.ok).toBe(true);
  });

  it('list filters by topic and respects limit', () => {
    service.record({ content: 'a', topics: ['x'], actor: 'daniel' });
    service.record({ content: 'b', topics: ['y'], actor: 'daniel' });
    service.record({ content: 'c', topics: ['x'], actor: 'daniel' });

    expect(service.list({ topic: 'x' })).toHaveLength(2);
    expect(service.list({ limit: 2 })).toHaveLength(2);
  });

  it('archive hides an observation from the default listing but keeps it', () => {
    const stale = service.record({ content: 'stale signal', actor: 'daniel' });
    service.record({ content: 'live signal', actor: 'daniel' });
    expect(stale.ok).toBe(true);
    if (!stale.ok) return;

    expect(service.archive(stale.value.id, 'daniel')).toBe(true);

    // Default list excludes the archived one…
    expect(service.list().map((o) => o.content)).toEqual(['live signal']);
    // …but include_archived brings it back, marked archived.
    const withArchived = service.list({ includeArchived: true });
    expect(withArchived.map((o) => o.content).sort()).toEqual(['live signal', 'stale signal']);
    const archived = withArchived.find((o) => o.id === stale.value.id);
    expect(archived?.archivedAt).not.toBeNull();

    // The archival was recorded in the audit log.
    const events = readFileSync(path.join(tempRoot, '.audit', 'current.jsonl'), 'utf-8');
    expect(events).toContain('"kind":"observation_archived"');
  });

  it('archive respects the limit against active rows only', () => {
    const first = service.record({ content: 'first', actor: 'daniel' });
    service.record({ content: 'second', actor: 'daniel' });
    service.record({ content: 'third', actor: 'daniel' });
    if (!first.ok) return;
    service.archive(first.value.id, 'daniel');

    // limit 2 must return two ACTIVE rows, not one active + a filtered-out
    // archived row (the filter is applied in SQL, before the limit).
    expect(service.list({ limit: 2 })).toHaveLength(2);
  });

  it('archive is a no-op (false) for an unknown or already-archived id', () => {
    expect(service.archive('nope', 'daniel')).toBe(false);
    const rec = service.record({ content: 'x', actor: 'daniel' });
    if (!rec.ok) return;
    expect(service.archive(rec.value.id, 'daniel')).toBe(true);
    expect(service.archive(rec.value.id, 'daniel')).toBe(false); // already archived
  });
});
