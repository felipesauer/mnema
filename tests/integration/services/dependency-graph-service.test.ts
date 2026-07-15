import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StateMachine } from '@/domain/state-machine/state-machine.js';
import { WorkflowLoader } from '@/domain/state-machine/workflow-loader.js';
import { ErrorCode } from '@/errors/error-codes.js';
import { DependencyGraphService } from '@/services/snapshot/dependency-graph-service.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { DependencyRepository } from '@/storage/sqlite/repositories/dependency-repository.js';
import { EpicRepository } from '@/storage/sqlite/repositories/epic-repository.js';
import { ProjectRepository } from '@/storage/sqlite/repositories/project-repository.js';
import { SprintRepository } from '@/storage/sqlite/repositories/sprint-repository.js';
import { TaskRepository } from '@/storage/sqlite/repositories/task-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

const migrationsDir = path.resolve('src/storage/sqlite/migrations');

describe('DependencyGraphService', () => {
  let tempRoot: string;
  let adapter: SqliteAdapter;
  let graph: DependencyGraphService;
  let tasks: TaskRepository;
  let deps: DependencyRepository;
  let projectId: string;
  let actorId: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-depgraph-'));
    adapter = new SqliteAdapter(path.join(tempRoot, 'state.db'));
    new MigrationRunner().run(adapter, migrationsDir);
    const projects = new ProjectRepository(adapter);
    projectId = projects.insert({ key: 'TEST', name: 'Test' }).id;
    adapter
      .getDatabase()
      .prepare("INSERT INTO actors (id, handle, kind) VALUES ('a1', 'daniel', 'human')")
      .run();
    actorId = 'a1';
    tasks = new TaskRepository(adapter);
    deps = new DependencyRepository(adapter);
    const epics = new EpicRepository(adapter);
    const sprints = new SprintRepository(adapter);
    const stateMachine = new StateMachine(
      new WorkflowLoader().load(path.resolve('workflows/default.json')),
    );
    graph = new DependencyGraphService(deps, tasks, epics, sprints, stateMachine);
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  /** Insert a task in a given state; returns its internal id. */
  function makeTask(key: string, state = 'READY'): string {
    const task = tasks.insert({ key, projectId, title: key, reporterId: actorId });
    if (state !== 'DRAFT') tasks.updateState(task.id, state, null);
    return task.id;
  }

  /** Link "blocked is blocked by blocker" (blocker must finish first). */
  function blocks(blockerId: string, blockedId: string): void {
    deps.insert({ taskId: blockedId, blocksTaskId: blockerId, kind: 'blocks' });
  }

  it('reports the critical path of a linear blocks-chain', () => {
    // A → B → C : A blocks B blocks C. Critical path is [A, B, C].
    const a = makeTask('T-A');
    const b = makeTask('T-B');
    const c = makeTask('T-C');
    blocks(a, b);
    blocks(b, c);
    const result = graph.forScope({ kind: 'project' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.cycles).toEqual([]);
    expect(result.value.criticalPath).toEqual(['T-A', 'T-B', 'T-C']);
  });

  it('identifies the ready/blocked frontier with the live blockers', () => {
    // DONE-A blocks B (so B is ready); READY-C blocks D (so D is blocked by C).
    const a = makeTask('T-A', 'DONE');
    const b = makeTask('T-B');
    const c = makeTask('T-C');
    const d = makeTask('T-D');
    blocks(a, b); // terminal blocker → B ready
    blocks(c, d); // live blocker → D blocked by C
    const result = graph.forScope({ kind: 'project' });
    if (!result.ok) return;
    // B and C have no live blocker; A is terminal (not in frontier).
    expect(result.value.frontier.ready).toEqual(['T-B', 'T-C']);
    expect(result.value.frontier.blocked).toEqual([{ key: 'T-D', blockedBy: ['T-C'] }]);
  });

  it('detects a cycle and omits the critical path (cyclic fixture)', () => {
    // A blocks B and B blocks A — a cycle the link tool would reject, but
    // legacy/imported data can contain. Inserted directly to simulate that.
    const a = makeTask('T-A');
    const b = makeTask('T-B');
    blocks(a, b);
    blocks(b, a);
    const result = graph.forScope({ kind: 'project' });
    if (!result.ok) return;
    expect(result.value.cycles.length).toBe(1);
    // The cycle lists both members (closed loop).
    const cycle = result.value.cycles[0] ?? [];
    expect(cycle).toContain('T-A');
    expect(cycle).toContain('T-B');
    // Critical path is undefined under a cycle → empty.
    expect(result.value.criticalPath).toEqual([]);
  });

  it('drops edges that point outside the scope', () => {
    const epics = new EpicRepository(adapter);
    const epic = epics.insert({ key: 'TEST-EPIC-1', projectId, title: 'E' });
    // A is in the epic; X is not. X blocks A, but X is out of scope.
    const a = makeTask('T-A');
    const x = makeTask('T-X');
    epics.addTask(epic.id, a);
    blocks(x, a);
    const result = graph.forScope({ kind: 'epic', key: 'TEST-EPIC-1' });
    if (!result.ok) return;
    // Only A is in scope; its out-of-scope blocker X is dropped, so A is ready.
    expect(result.value.nodes.map((n) => n.key)).toEqual(['T-A']);
    expect(result.value.nodes[0]?.blockedBy).toEqual([]);
    expect(result.value.frontier.ready).toEqual(['T-A']);
  });

  it('returns EpicNotFound for an unknown epic scope', () => {
    const result = graph.forScope({ kind: 'epic', key: 'NOPE-EPIC-9' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe(ErrorCode.EpicNotFound);
  });

  it('reads dependencies with ONE query for the whole scope, not one per task', () => {
    // A → B → C → D → E chain: 5 tasks, so the old code issued 5 queries.
    const ids = ['T-A', 'T-B', 'T-C', 'T-D', 'T-E'].map((k) => makeTask(k));
    for (let i = 1; i < ids.length; i += 1) blocks(ids[i - 1] as string, ids[i] as string);

    const perTask = vi.spyOn(deps, 'findByTask');
    const batched = vi.spyOn(deps, 'findByTasks');

    const result = graph.forScope({ kind: 'project' });
    expect(result.ok).toBe(true);

    // One batched query for all five tasks; the per-task path is not used.
    expect(batched).toHaveBeenCalledTimes(1);
    expect(perTask).not.toHaveBeenCalled();

    // Parity: the batched result still yields the correct critical path.
    if (result.ok) {
      expect(result.value.criticalPath).toEqual(['T-A', 'T-B', 'T-C', 'T-D', 'T-E']);
    }
    perTask.mockRestore();
    batched.mockRestore();
  });

  it('findByTasks returns identical edges to per-task findByTask (bucketed)', () => {
    const a = makeTask('T-A');
    const b = makeTask('T-B');
    const c = makeTask('T-C');
    blocks(a, b); // B blocked by A
    blocks(b, c); // C blocked by B

    const batched = deps.findByTasks([a, b, c]);
    // Each task's batched bucket equals its individual findByTask result.
    for (const id of [a, b, c]) {
      expect(batched.get(id) ?? []).toEqual(deps.findByTask(id));
    }
    // A task with no outgoing edges is absent from the map.
    expect(batched.has(a)).toBe(false); // A has no `task_id = A` rows (it blocks, isn't blocked)
  });
});
