import path from 'node:path';
import { describe, expect, it } from 'vitest';

import type { Task } from '@/domain/entities/task.js';
import { StateMachine } from '@/domain/state-machine/state-machine.js';
import type {
  ClaimResult,
  ITaskRepository,
  LeanTask,
  LeanTaskFilter,
  TaskFieldUpdates,
  TaskInsertInput,
  UpdateStateResult,
} from '@/ports/task-repository.port.js';
import { TaskService } from '@/services/backlog/task-service.js';
import { loadWorkflowFile } from '@/storage/workflow-file.js';

/**
 * Proof that the persistence PORT works: TaskService is driven here with an
 * in-memory fake implementing ITaskRepository — no SQLite file, no adapter,
 * no disk. Before the port, TaskService depended on the concrete
 * TaskRepository and this test was impossible. This is the whole point of the
 * seam: a service is unit-testable and reusable against any implementation of
 * the port.
 */

/** A minimal in-memory ITaskRepository — enough to exercise `create`. */
class InMemoryTaskRepository implements ITaskRepository {
  private readonly rows = new Map<string, Task>();
  private seq = 0;

  insert(input: TaskInsertInput): Task {
    const now = '2026-01-01T00:00:00.000Z';
    const task: Task = {
      id: `id-${this.rows.size + 1}`,
      key: input.key,
      projectId: input.projectId,
      epicId: input.epicId ?? null,
      sprintId: input.sprintId ?? null,
      title: input.title,
      description: input.description ?? null,
      acceptanceCriteria: input.acceptanceCriteria ?? [],
      state: input.state ?? 'DRAFT',
      estimate: input.estimate ?? null,
      contextBudget: input.contextBudget ?? null,
      priority: input.priority ?? 3,
      assigneeId: input.assigneeId ?? null,
      reporterId: input.reporterId,
      reopenCount: 0,
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now,
      closedAt: null,
      deletedAt: null,
      claimedBy: null,
      leaseExpiresAt: null,
      gitBranch: null,
      gitCommits: [],
      gitPr: null,
    };
    this.rows.set(task.id, task);
    return task;
  }

  nextSequence(_projectId: string): number {
    this.seq += 1;
    return this.seq;
  }

  findByKey(key: string): Task | null {
    for (const t of this.rows.values()) if (t.key === key) return t;
    return null;
  }
  findById(id: string): Task | null {
    return this.rows.get(id) ?? null;
  }
  findByTitle(_projectId: string, title: string): Task[] {
    return [...this.rows.values()].filter((t) => t.title === title);
  }
  findAllActive(): Task[] {
    return [...this.rows.values()];
  }
  runInTransaction<T>(fn: () => T): T {
    return fn();
  }
  runInTransactionImmediate<T>(fn: () => T): T {
    return fn();
  }

  // Unused by this test's path — present to satisfy the port. They throw so a
  // future test that hits them fails loudly instead of silently no-op'ing.
  findByKeyIncludingDeleted(): Task | null {
    throw new Error('not implemented in fake');
  }
  findByState(): Task[] {
    throw new Error('not implemented in fake');
  }
  findByEpic(): Task[] {
    throw new Error('not implemented in fake');
  }
  findActiveLean(_filter?: LeanTaskFilter): LeanTask[] {
    throw new Error('not implemented in fake');
  }
  countActive(): number {
    return this.rows.size;
  }
  updateState(): UpdateStateResult {
    throw new Error('not implemented in fake');
  }
  updateFields(_taskId: string, _fields: TaskFieldUpdates): Task {
    throw new Error('not implemented in fake');
  }
  incrementReopenCount(): Task | null {
    throw new Error('not implemented in fake');
  }
  setGitLink(): Task | null {
    throw new Error('not implemented in fake');
  }
  claim(): ClaimResult {
    throw new Error('not implemented in fake');
  }
  findClaim(): { claimedBy: string | null; leaseExpiresAt: string | null } | null {
    return null;
  }
  clearClaim(): boolean {
    return false;
  }
  releaseClaim(): boolean {
    return false;
  }
  softDelete(): boolean {
    return false;
  }
  restore(): boolean {
    return false;
  }
}

/** Build a TaskService whose only real collaborator is the in-memory port. */
function serviceWithFakeRepo(fake: ITaskRepository): TaskService {
  const stateMachine = new StateMachine(
    loadWorkflowFile(path.resolve('packages/core/workflows/default.json')),
  );
  const projects = {
    findByKey: (key: string) => ({ id: 'proj-1', key, name: 'Test' }),
  };
  const transitions = { record: () => undefined };
  const audit = { write: () => undefined };
  const identity = {
    ensureActor: () => 'actor-1',
    findActorIdByHandle: () => 'actor-1',
    getDefaultActor: () => 'actor-1',
  };
  const sync = { syncTask: () => undefined };

  // The service only needs these behaviours for the `create` path; the casts
  // keep the fake minimal without reconstructing every collaborator.
  return new TaskService(
    fake,
    transitions as never,
    projects as never,
    stateMachine,
    audit as never,
    sync as never,
    identity,
  );
}

describe('TaskService drives against an in-memory port (no SQLite)', () => {
  it('creates a task through the ITaskRepository fake', () => {
    const fake = new InMemoryTaskRepository();
    const service = serviceWithFakeRepo(fake);

    const result = service.create({
      projectKey: 'TEST',
      title: 'A task created with no database',
      description: 'proves the persistence port',
      actor: 'alice',
    });

    expect(result.ok, result.ok ? '' : JSON.stringify(result.error)).toBe(true);
    if (!result.ok) return;
    expect(result.value.title).toBe('A task created with no database');
    // The task really landed in the in-memory store — the service used the
    // port, not a concrete SQLite repository.
    expect(fake.findByKey(result.value.key)?.title).toBe('A task created with no database');
    expect(fake.countActive()).toBe(1);
  });
});
