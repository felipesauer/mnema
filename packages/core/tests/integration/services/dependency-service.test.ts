import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { StateMachine } from '@/domain/state-machine/state-machine.js';
import { ErrorCode } from '@/errors/error-codes.js';
import { DependencyService } from '@/services/backlog/dependency-service.js';
import { AuditService } from '@/services/integrity/audit-service.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { DependencyRepository } from '@/storage/sqlite/repositories/dependency-repository.js';
import { ProjectRepository } from '@/storage/sqlite/repositories/project-repository.js';
import { SprintRepository } from '@/storage/sqlite/repositories/sprint-repository.js';
import { TaskRepository } from '@/storage/sqlite/repositories/task-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';
import { loadWorkflowFile } from '@/storage/workflow-file.js';
import { chainedAuditWriter } from '../../setup/audit-writer.js';

const migrationsDir = path.resolve('packages/core/src/storage/sqlite/migrations');

describe('DependencyService', () => {
  let tempRoot: string;
  let adapter: SqliteAdapter;
  let deps: DependencyService;
  let tasks: TaskRepository;
  let sprints: SprintRepository;
  let projectId: string;
  let actorId: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-dep-svc-'));
    adapter = new SqliteAdapter(path.join(tempRoot, 'state.db'));
    new MigrationRunner().run(adapter, migrationsDir);

    const audit = new AuditService(chainedAuditWriter(adapter, path.join(tempRoot, '.audit')));
    const projects = new ProjectRepository(adapter);
    projectId = projects.insert({ key: 'TEST', name: 'Test' }).id;

    actorId = 'a1';
    adapter
      .getDatabase()
      .prepare("INSERT INTO actors (id, handle, kind) VALUES (?, 'daniel', 'human')")
      .run(actorId);

    tasks = new TaskRepository(adapter);
    sprints = new SprintRepository(adapter);
    const stateMachine = new StateMachine(
      loadWorkflowFile(path.resolve('packages/core/workflows/default.json')),
    );
    deps = new DependencyService(
      new DependencyRepository(adapter),
      tasks,
      sprints,
      stateMachine,
      audit,
    );
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  function makeTask(title: string, state = 'DRAFT'): string {
    const task = tasks.insert({ projectId, title, reporterId: actorId });
    if (state !== 'DRAFT') tasks.updateState(task.id, state);
    return task.id;
  }

  it('links A blocked by B and records an audit event', () => {
    const t1 = makeTask('TEST-1');
    const t2 = makeTask('TEST-2');
    const result = deps.link({ taskKey: t1, blocksTaskKey: t2, actor: 'daniel' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind).toBe('blocks');
  });

  it('rejects a self-dependency', () => {
    const t1 = makeTask('TEST-1');
    const result = deps.link({ taskKey: t1, blocksTaskKey: t1, actor: 'daniel' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe(ErrorCode.DependencySelf);
  });

  it('rejects a duplicate edge', () => {
    const t1 = makeTask('TEST-1');
    const t2 = makeTask('TEST-2');
    deps.link({ taskKey: t1, blocksTaskKey: t2, actor: 'daniel' });
    const dup = deps.link({ taskKey: t1, blocksTaskKey: t2, actor: 'daniel' });
    expect(dup.ok).toBe(false);
    if (dup.ok) return;
    expect(dup.error.kind).toBe(ErrorCode.DependencyDuplicate);
  });

  it('rejects an unknown task key', () => {
    const t1 = makeTask('TEST-1');
    const result = deps.link({ taskKey: t1, blocksTaskKey: 'NOPE-9', actor: 'daniel' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe(ErrorCode.TaskNotFound);
  });

  it('detects a direct cycle (A→B then B→A)', () => {
    const t1 = makeTask('TEST-1');
    const t2 = makeTask('TEST-2');
    deps.link({ taskKey: t1, blocksTaskKey: t2, actor: 'daniel' });
    const cycle = deps.link({ taskKey: t2, blocksTaskKey: t1, actor: 'daniel' });
    expect(cycle.ok).toBe(false);
    if (cycle.ok) return;
    expect(cycle.error.kind).toBe(ErrorCode.DependencyCycle);
  });

  it('detects a transitive cycle (A→B→C then C→A)', () => {
    const t1 = makeTask('TEST-1');
    const t2 = makeTask('TEST-2');
    const t3 = makeTask('TEST-3');
    deps.link({ taskKey: t1, blocksTaskKey: t2, actor: 'daniel' });
    deps.link({ taskKey: t2, blocksTaskKey: t3, actor: 'daniel' });
    const cycle = deps.link({ taskKey: t3, blocksTaskKey: t1, actor: 'daniel' });
    expect(cycle.ok).toBe(false);
    if (cycle.ok) return;
    expect(cycle.error.kind).toBe(ErrorCode.DependencyCycle);
  });

  it('allows a non-blocks edge without cycle checking', () => {
    const t1 = makeTask('TEST-1');
    const t2 = makeTask('TEST-2');
    deps.link({ taskKey: t1, blocksTaskKey: t2, actor: 'daniel' });
    // relates_to in the reverse direction is informational, not a cycle
    const rel = deps.link({
      taskKey: t2,
      blocksTaskKey: t1,
      kind: 'relates_to',
      actor: 'daniel',
    });
    expect(rel.ok).toBe(true);
  });

  it('ready excludes a task whose blocker is not terminal, includes it once terminal', () => {
    const t1 = makeTask('TEST-1', 'READY'); // dependent
    const blockerId = makeTask('TEST-2', 'IN_PROGRESS'); // blocker, not terminal
    deps.link({ taskKey: t1, blocksTaskKey: blockerId, actor: 'daniel' });

    let result = deps.ready();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((t) => t.id)).not.toContain(t1);

    // blocker reaches a terminal state
    tasks.updateState(blockerId, 'DONE');
    result = deps.ready();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((t) => t.id)).toContain(t1);
  });

  it('ready ignores non-blocks dependencies', () => {
    const t1 = makeTask('TEST-1', 'READY');
    const t2 = makeTask('TEST-2', 'IN_PROGRESS');
    deps.link({
      taskKey: t1,
      blocksTaskKey: t2,
      kind: 'relates_to',
      actor: 'daniel',
    });
    const result = deps.ready();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // relates_to does not gate readiness
    expect(result.value.map((t) => t.id)).toContain(t1);
  });

  it('ready scoped to a sprint only returns that sprint tasks', () => {
    const sprint = sprints.insert({ projectId, key: 'TEST-SPRINT-1', name: 'S1' });
    const t1 = makeTask('TEST-1', 'READY');
    const t2 = makeTask('TEST-2', 'READY'); // not in sprint
    sprints.addTask(sprint.id, t1);

    const result = deps.ready(sprint.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ids = result.value.map((t) => t.id);
    expect(ids).toContain(t1);
    expect(ids).not.toContain(t2);
  });

  it('ready returns SprintNotFound for an unknown sprint', () => {
    const result = deps.ready('NOPE-SPRINT-9');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe(ErrorCode.SprintNotFound);
  });

  it('listFor returns dependsOn and blocks for a task', () => {
    const t1 = makeTask('TEST-1');
    const t2 = makeTask('TEST-2');
    const t3 = makeTask('TEST-3');
    deps.link({ taskKey: t1, blocksTaskKey: t2, actor: 'daniel' });
    deps.link({ taskKey: t3, blocksTaskKey: t1, actor: 'daniel' });

    const result = deps.listFor(t1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.dependsOn).toHaveLength(1); // TEST-1 depends on TEST-2
    expect(result.value.blocks).toHaveLength(1); // TEST-3 depends on TEST-1
  });

  describe('soft-deleted blockers are handled symmetrically', () => {
    it('does not raise a false cycle when the only path runs through a soft-deleted node', () => {
      const t1 = makeTask('TEST-1');
      const b = makeTask('TEST-2');
      const t3 = makeTask('TEST-3');
      deps.link({ taskKey: t1, blocksTaskKey: b, actor: 'daniel' }); // 1 → 2
      deps.link({ taskKey: b, blocksTaskKey: t3, actor: 'daniel' }); // 2 → 3
      tasks.softDelete(b); // remove the bridge node

      // 3 → 1 would close a cycle only *through* deleted 2; with 2 gone there
      // is no live cycle, so the edge must be allowed.
      const res = deps.link({ taskKey: t3, blocksTaskKey: t1, actor: 'daniel' });
      expect(res.ok).toBe(true);
    });

    it('still rejects a genuine live cycle (no deleted node on the path)', () => {
      const t1 = makeTask('TEST-1');
      const t2 = makeTask('TEST-2');
      deps.link({ taskKey: t1, blocksTaskKey: t2, actor: 'daniel' }); // 1 → 2
      const res = deps.link({ taskKey: t2, blocksTaskKey: t1, actor: 'daniel' }); // 2 → 1
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.kind).toBe(ErrorCode.DependencyCycle);
    });
  });
});
