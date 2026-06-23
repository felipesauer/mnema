import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ErrorCode } from '@/errors/error-codes.js';
import { AuditService } from '@/services/audit-service.js';
import { TaskEvidenceService } from '@/services/task-evidence-service.js';
import { AuditWriter } from '@/storage/audit/audit-writer.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { ProjectRepository } from '@/storage/sqlite/repositories/project-repository.js';
import { TaskEvidenceRepository } from '@/storage/sqlite/repositories/task-evidence-repository.js';
import { TaskRepository } from '@/storage/sqlite/repositories/task-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

const migrationsDir = path.resolve('src/storage/sqlite/migrations');

describe('TaskEvidenceService', () => {
  let tempRoot: string;
  let adapter: SqliteAdapter;
  let svc: TaskEvidenceService;
  let tasks: TaskRepository;
  let projectId: string;
  let actorId: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-ev-'));
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

    tasks = new TaskRepository(adapter);
    svc = new TaskEvidenceService(new TaskEvidenceRepository(adapter), tasks, audit);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  function makeTask(key: string, criteria: string[]): void {
    tasks.insert({ key, projectId, title: key, reporterId: actorId, acceptanceCriteria: criteria });
  }

  it('attaches evidence to a valid criterion', () => {
    makeTask('TEST-1', ['logs in', 'logs out']);
    const result = svc.attach({
      taskKey: 'TEST-1',
      criterionIndex: 0,
      kind: 'test',
      ref: 'tests/login.test.ts',
      actor: 'daniel',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.criterionIndex).toBe(0);
    expect(result.value.kind).toBe('test');
  });

  it('rejects an out-of-range criterion index', () => {
    makeTask('TEST-1', ['only one criterion']);
    const result = svc.attach({
      taskKey: 'TEST-1',
      criterionIndex: 3,
      ref: 'x',
      actor: 'daniel',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe(ErrorCode.EvidenceCriterionOutOfRange);
  });

  it('rejects a duplicate evidence edge', () => {
    makeTask('TEST-1', ['c']);
    const input = {
      taskKey: 'TEST-1',
      criterionIndex: 0,
      kind: 'route' as const,
      ref: '/login',
      actor: 'daniel',
    };
    svc.attach(input);
    const dup = svc.attach(input);
    expect(dup.ok).toBe(false);
    if (dup.ok) return;
    expect(dup.error.kind).toBe(ErrorCode.EvidenceDuplicate);
  });

  it('rejects an unknown task', () => {
    const result = svc.attach({ taskKey: 'NOPE-9', criterionIndex: 0, ref: 'x', actor: 'daniel' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe(ErrorCode.TaskNotFound);
  });

  it('forTask pairs each criterion with its evidence, empty where none', () => {
    makeTask('TEST-1', ['has evidence', 'no evidence']);
    svc.attach({
      taskKey: 'TEST-1',
      criterionIndex: 0,
      kind: 'test',
      ref: 'tests/a.test.ts',
      actor: 'daniel',
    });

    const result = svc.forTask('TEST-1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(2);
    expect(result.value[0]?.evidence).toHaveLength(1);
    expect(result.value[1]?.evidence).toHaveLength(0);
  });

  it('defaults kind to other', () => {
    makeTask('TEST-1', ['c']);
    const result = svc.attach({ taskKey: 'TEST-1', criterionIndex: 0, ref: 'x', actor: 'daniel' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind).toBe('other');
  });
});
