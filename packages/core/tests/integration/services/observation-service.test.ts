import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ActorKind } from '@/domain/enums/actor-kind.js';
import { ErrorCode } from '@/errors/error-codes.js';
import { AuditService } from '@/services/integrity/audit-service.js';
import { IdentityService } from '@/services/integrity/identity-service.js';
import {
  OBSERVATION_CONTENT_MAX,
  ObservationService,
} from '@/services/knowledge/observation-service.js';
import { AuditWriter } from '@/storage/audit/audit-writer.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { ActorRepository } from '@/storage/sqlite/repositories/actor-repository.js';
import { ObservationRepository } from '@/storage/sqlite/repositories/observation-repository.js';
import { ProjectRepository } from '@/storage/sqlite/repositories/project-repository.js';
import { TaskRepository } from '@/storage/sqlite/repositories/task-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

const migrationsDir = path.resolve('packages/core/src/storage/sqlite/migrations');

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

    service = new ObservationService(
      repo,
      tasks,
      identity,
      audit,
      path.join(tempRoot, '.mnema', 'observations'),
    );
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

  it('rejects tool-invocation markup leaking into content (the reported trailer)', () => {
    const result = service.record({
      content: 'body text.</content>\n<topics>["ci","ruleset"]</topics>',
      actor: 'daniel',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe(ErrorCode.ValidationFailed);
    if (result.error.kind !== ErrorCode.ValidationFailed) return;
    expect(result.error.issues[0]?.path).toEqual(['content']);
    expect(result.error.issues[0]?.message).toMatch(/pass each field as its own argument/);
    // Nothing was persisted (the screen precedes the insert + audit write).
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

  it('topic + limit returns all matches when limit >= matching count (limit bounds the filtered set)', () => {
    // 3 rows match topic `x`, mixed among 3 rows that do not. With the topic
    // filter applied in SQL, LIMIT bounds the FILTERED set, so a limit >= the
    // matching count returns every match. The old code applied LIMIT before the
    // in-JS topic filter, so the non-matching rows consumed the budget and the
    // caller under-reported the matches.
    service.record({ content: 'm1', topics: ['x'], actor: 'daniel' });
    service.record({ content: 'n1', topics: ['y'], actor: 'daniel' });
    service.record({ content: 'm2', topics: ['x'], actor: 'daniel' });
    service.record({ content: 'n2', topics: ['z'], actor: 'daniel' });
    service.record({ content: 'm3', topics: ['x'], actor: 'daniel' });
    service.record({ content: 'n3', topics: ['y'], actor: 'daniel' });

    const matches = service.list({ topic: 'x', limit: 3 });
    expect(matches).toHaveLength(3);
    expect(matches.map((o) => o.content).sort()).toEqual(['m1', 'm2', 'm3']);
  });

  it('archive hides an observation from the default listing but keeps it', () => {
    const stale = service.record({ content: 'stale signal', actor: 'daniel' });
    service.record({ content: 'live signal', actor: 'daniel' });
    expect(stale.ok).toBe(true);
    if (!stale.ok) return;

    expect(service.archive(stale.value.id, 'daniel')).toBe('archived');

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

  it('archive distinguishes an unknown id from an already-archived one', () => {
    // The audited friction: both cases collapsed to `false` and the CLI told
    // the user a real (archived) id was "not found".
    expect(service.archive('nope', 'daniel')).toBe('not_found');
    const rec = service.record({ content: 'x', actor: 'daniel' });
    if (!rec.ok) return;
    expect(service.archive(rec.value.id, 'daniel')).toBe('archived');
    expect(service.archive(rec.value.id, 'daniel')).toBe('already_archived');
  });
});
