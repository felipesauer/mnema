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
    expect(result.value.criteria).toHaveLength(2);
    expect(result.value.criteria[0]?.evidence).toHaveLength(1);
    expect(result.value.criteria[1]?.evidence).toHaveLength(0);
    expect(result.value.orphaned).toHaveLength(0);
  });

  it('defaults kind to other', () => {
    makeTask('TEST-1', ['c']);
    const result = svc.attach({ taskKey: 'TEST-1', criterionIndex: 0, ref: 'x', actor: 'daniel' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind).toBe('other');
  });

  it('surfaces evidence as orphaned (not dropped) when criteria shrink below its index', () => {
    makeTask('TEST-1', ['login works', 'logout works']);
    svc.attach({
      taskKey: 'TEST-1',
      criterionIndex: 1,
      kind: 'test',
      ref: 'tests/logout.test.ts',
      actor: 'daniel',
    });

    // The criteria array is rewritten to a single item (what a `submit`
    // transition does), leaving the index-1 evidence row dangling.
    const taskId = tasks.findByKey('TEST-1')?.id;
    tasks.updateFields(taskId as string, { acceptanceCriteria: ['login works'] });

    const result = svc.forTask('TEST-1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.criteria).toHaveLength(1);
    // The evidence is NOT silently lost — it shows up as an orphan.
    expect(result.value.orphaned).toHaveLength(1);
    expect(result.value.orphaned[0]?.ref).toBe('tests/logout.test.ts');
    expect(result.value.orphaned[0]?.criterionIndex).toBe(1);
  });

  it('evidence follows its criterion when the criteria are REORDERED', () => {
    makeTask('TEST-1', ['login works', 'logout works']);
    svc.attach({
      taskKey: 'TEST-1',
      criterionIndex: 1, // 'logout works'
      kind: 'test',
      ref: 'tests/logout.test.ts',
      actor: 'daniel',
    });

    // Reorder so 'logout works' is now at index 0.
    const taskId = tasks.findByKey('TEST-1')?.id;
    tasks.updateFields(taskId as string, {
      acceptanceCriteria: ['logout works', 'login works'],
    });

    const result = svc.forTask('TEST-1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.orphaned).toHaveLength(0);
    // The evidence is attributed to 'logout works' (now index 0), NOT to
    // whatever sits at the original index 1.
    const idx0 = result.value.criteria[0];
    const idx1 = result.value.criteria[1];
    expect(idx0?.criterion).toBe('logout works');
    expect(idx0?.evidence.map((e) => e.ref)).toEqual(['tests/logout.test.ts']);
    expect(idx1?.criterion).toBe('login works');
    expect(idx1?.evidence).toHaveLength(0);
  });

  it('treats evidence as orphaned when its criterion TEXT is edited away', () => {
    makeTask('TEST-1', ['login works']);
    svc.attach({
      taskKey: 'TEST-1',
      criterionIndex: 0,
      kind: 'test',
      ref: 'tests/a.test.ts',
      actor: 'daniel',
    });
    const taskId = tasks.findByKey('TEST-1')?.id;
    // Same length, but the criterion's text changed — the original criterion
    // no longer exists, so the evidence is a true orphan (not mis-attributed).
    tasks.updateFields(taskId as string, { acceptanceCriteria: ['SSO works'] });

    const result = svc.forTask('TEST-1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.criteria[0]?.evidence).toHaveLength(0);
    expect(result.value.orphaned).toHaveLength(1);
    expect(result.value.orphaned[0]?.ref).toBe('tests/a.test.ts');
  });

  it('falls back to positional matching for a legacy row with no criterion_text', () => {
    makeTask('TEST-1', ['a', 'b']);
    const taskId = tasks.findByKey('TEST-1')?.id as string;
    // Simulate a row written before migration 016: criterion_text is NULL.
    adapter
      .getDatabase()
      .prepare(
        `INSERT INTO task_evidence
           (id, task_id, criterion_index, criterion_text, kind, ref, created_at)
         VALUES ('legacy1', ?, 1, NULL, 'test', 'tests/legacy.test.ts', '2026-06-23T00:00:00.000Z')`,
      )
      .run(taskId);

    const result = svc.forTask('TEST-1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // No criterion_text → positional: index 1 is in range, so it attributes
    // to criterion 'b' and is not orphaned.
    expect(result.value.orphaned).toHaveLength(0);
    expect(result.value.criteria[1]?.evidence.map((e) => e.ref)).toEqual(['tests/legacy.test.ts']);
  });
});
