import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { StateMachine } from '@/domain/state-machine/state-machine.js';
import { WorkflowLoader } from '@/domain/state-machine/workflow-loader.js';
import { ErrorCode } from '@/errors/error-codes.js';
import { AuditService } from '@/services/audit-service.js';
import { DependencyService } from '@/services/dependency-service.js';
import { AuditWriter } from '@/storage/audit/audit-writer.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { DependencyRepository } from '@/storage/sqlite/repositories/dependency-repository.js';
import { ProjectRepository } from '@/storage/sqlite/repositories/project-repository.js';
import { SprintRepository } from '@/storage/sqlite/repositories/sprint-repository.js';
import { TaskRepository } from '@/storage/sqlite/repositories/task-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

const migrationsDir = path.resolve('src/storage/sqlite/migrations');

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

    const audit = new AuditService(new AuditWriter(path.join(tempRoot, '.audit')));
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
      new WorkflowLoader().load(path.resolve('workflows/default.json')),
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

  function makeTask(key: string, state = 'DRAFT'): string {
    const task = tasks.insert({ key, projectId, title: key, reporterId: actorId });
    if (state !== 'DRAFT') tasks.updateState(task.id, state);
    return task.id;
  }

  it('links A blocked by B and records an audit event', () => {
    makeTask('TEST-1');
    makeTask('TEST-2');
    const result = deps.link({ taskKey: 'TEST-1', blocksTaskKey: 'TEST-2', actor: 'daniel' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind).toBe('blocks');
  });

  it('rejects a self-dependency', () => {
    makeTask('TEST-1');
    const result = deps.link({ taskKey: 'TEST-1', blocksTaskKey: 'TEST-1', actor: 'daniel' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe(ErrorCode.DependencySelf);
  });

  it('rejects a duplicate edge', () => {
    makeTask('TEST-1');
    makeTask('TEST-2');
    deps.link({ taskKey: 'TEST-1', blocksTaskKey: 'TEST-2', actor: 'daniel' });
    const dup = deps.link({ taskKey: 'TEST-1', blocksTaskKey: 'TEST-2', actor: 'daniel' });
    expect(dup.ok).toBe(false);
    if (dup.ok) return;
    expect(dup.error.kind).toBe(ErrorCode.DependencyDuplicate);
  });

  it('rejects an unknown task key', () => {
    makeTask('TEST-1');
    const result = deps.link({ taskKey: 'TEST-1', blocksTaskKey: 'NOPE-9', actor: 'daniel' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe(ErrorCode.TaskNotFound);
  });

  it('detects a direct cycle (A→B then B→A)', () => {
    makeTask('TEST-1');
    makeTask('TEST-2');
    deps.link({ taskKey: 'TEST-1', blocksTaskKey: 'TEST-2', actor: 'daniel' });
    const cycle = deps.link({ taskKey: 'TEST-2', blocksTaskKey: 'TEST-1', actor: 'daniel' });
    expect(cycle.ok).toBe(false);
    if (cycle.ok) return;
    expect(cycle.error.kind).toBe(ErrorCode.DependencyCycle);
  });

  it('detects a transitive cycle (A→B→C then C→A)', () => {
    makeTask('TEST-1');
    makeTask('TEST-2');
    makeTask('TEST-3');
    deps.link({ taskKey: 'TEST-1', blocksTaskKey: 'TEST-2', actor: 'daniel' });
    deps.link({ taskKey: 'TEST-2', blocksTaskKey: 'TEST-3', actor: 'daniel' });
    const cycle = deps.link({ taskKey: 'TEST-3', blocksTaskKey: 'TEST-1', actor: 'daniel' });
    expect(cycle.ok).toBe(false);
    if (cycle.ok) return;
    expect(cycle.error.kind).toBe(ErrorCode.DependencyCycle);
  });

  it('allows a non-blocks edge without cycle checking', () => {
    makeTask('TEST-1');
    makeTask('TEST-2');
    deps.link({ taskKey: 'TEST-1', blocksTaskKey: 'TEST-2', actor: 'daniel' });
    // relates_to in the reverse direction is informational, not a cycle
    const rel = deps.link({
      taskKey: 'TEST-2',
      blocksTaskKey: 'TEST-1',
      kind: 'relates_to',
      actor: 'daniel',
    });
    expect(rel.ok).toBe(true);
  });

  it('ready excludes a task whose blocker is not terminal, includes it once terminal', () => {
    makeTask('TEST-1', 'READY'); // dependent
    const blockerId = makeTask('TEST-2', 'IN_PROGRESS'); // blocker, not terminal
    deps.link({ taskKey: 'TEST-1', blocksTaskKey: 'TEST-2', actor: 'daniel' });

    let result = deps.ready();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((t) => t.key)).not.toContain('TEST-1');

    // blocker reaches a terminal state
    tasks.updateState(blockerId, 'DONE');
    result = deps.ready();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((t) => t.key)).toContain('TEST-1');
  });

  it('ready ignores non-blocks dependencies', () => {
    makeTask('TEST-1', 'READY');
    makeTask('TEST-2', 'IN_PROGRESS');
    deps.link({
      taskKey: 'TEST-1',
      blocksTaskKey: 'TEST-2',
      kind: 'relates_to',
      actor: 'daniel',
    });
    const result = deps.ready();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // relates_to does not gate readiness
    expect(result.value.map((t) => t.key)).toContain('TEST-1');
  });

  it('ready scoped to a sprint only returns that sprint tasks', () => {
    const sprint = sprints.insert({ projectId, key: 'TEST-SPRINT-1', name: 'S1' });
    const t1 = makeTask('TEST-1', 'READY');
    makeTask('TEST-2', 'READY'); // not in sprint
    sprints.addTask(sprint.id, t1);

    const result = deps.ready('TEST-SPRINT-1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const keys = result.value.map((t) => t.key);
    expect(keys).toContain('TEST-1');
    expect(keys).not.toContain('TEST-2');
  });

  it('ready returns SprintNotFound for an unknown sprint', () => {
    const result = deps.ready('NOPE-SPRINT-9');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe(ErrorCode.SprintNotFound);
  });

  it('listFor returns dependsOn and blocks for a task', () => {
    makeTask('TEST-1');
    makeTask('TEST-2');
    makeTask('TEST-3');
    deps.link({ taskKey: 'TEST-1', blocksTaskKey: 'TEST-2', actor: 'daniel' });
    deps.link({ taskKey: 'TEST-3', blocksTaskKey: 'TEST-1', actor: 'daniel' });

    const result = deps.listFor('TEST-1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.dependsOn).toHaveLength(1); // TEST-1 depends on TEST-2
    expect(result.value.blocks).toHaveLength(1); // TEST-3 depends on TEST-1
  });

  describe('soft-deleted blockers are handled symmetrically', () => {
    it('does not raise a false cycle when the only path runs through a soft-deleted node', () => {
      makeTask('TEST-1');
      const b = makeTask('TEST-2');
      makeTask('TEST-3');
      deps.link({ taskKey: 'TEST-1', blocksTaskKey: 'TEST-2', actor: 'daniel' }); // 1 → 2
      deps.link({ taskKey: 'TEST-2', blocksTaskKey: 'TEST-3', actor: 'daniel' }); // 2 → 3
      tasks.softDelete(b); // remove the bridge node

      // 3 → 1 would close a cycle only *through* deleted 2; with 2 gone there
      // is no live cycle, so the edge must be allowed.
      const res = deps.link({ taskKey: 'TEST-3', blocksTaskKey: 'TEST-1', actor: 'daniel' });
      expect(res.ok).toBe(true);
    });

    it('still rejects a genuine live cycle (no deleted node on the path)', () => {
      makeTask('TEST-1');
      makeTask('TEST-2');
      deps.link({ taskKey: 'TEST-1', blocksTaskKey: 'TEST-2', actor: 'daniel' }); // 1 → 2
      const res = deps.link({ taskKey: 'TEST-2', blocksTaskKey: 'TEST-1', actor: 'daniel' }); // 2 → 1
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.kind).toBe(ErrorCode.DependencyCycle);
    });
  });
});
