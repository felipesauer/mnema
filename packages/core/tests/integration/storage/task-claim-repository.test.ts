import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ActorKind } from '@/domain/enums/actor-kind.js';
import { TaskState } from '@/domain/enums/task-state.js';
import { MigrationRunner } from '@/storage/sqlite/migration-runner.js';
import { ActorRepository } from '@/storage/sqlite/repositories/actor-repository.js';
import { ProjectRepository } from '@/storage/sqlite/repositories/project-repository.js';
import { TaskRepository } from '@/storage/sqlite/repositories/task-repository.js';
import { SqliteAdapter } from '@/storage/sqlite/sqlite-adapter.js';

const migrationsDir = path.resolve('packages/core/src/storage/sqlite/migrations');

/** A fixed lease window used across the deterministic (non-fork) cases. */
const THIRTY_MIN_MS = 30 * 60_000;

describe('TaskRepository claim/releaseClaim', () => {
  let tempRoot: string;
  let adapter: SqliteAdapter;
  let actors: ActorRepository;
  let projects: ProjectRepository;
  let tasks: TaskRepository;
  let taskId: string;
  let alice: string;
  let bob: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'mnema-claim-repo-'));
    adapter = new SqliteAdapter(path.join(tempRoot, 'state.db'));
    new MigrationRunner().run(adapter, migrationsDir);
    actors = new ActorRepository(adapter);
    projects = new ProjectRepository(adapter);
    tasks = new TaskRepository(adapter);

    const project = projects.insert({ key: 'WEBAPP', name: 'Webapp' });
    alice = actors.upsert('alice', ActorKind.Human);
    bob = actors.upsert('bob', ActorKind.Human);
    taskId = tasks.insert({
      key: 'WEBAPP-1',
      projectId: project.id,
      title: 'Claimable',
      reporterId: alice,
      state: TaskState.Ready,
    }).id;
  });

  afterEach(() => {
    adapter.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('claims an unclaimed task and stamps claimed_by + lease_expires_at', () => {
    const now = new Date();
    const lease = new Date(now.getTime() + THIRTY_MIN_MS).toISOString();
    const result = tasks.claim(taskId, alice, lease, now.toISOString());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.task.claimedBy).toBe(alice);
    expect(result.task.leaseExpiresAt).toBe(lease);
  });

  it('refuses a second actor while the first lease is live', () => {
    const now = new Date();
    const aliceLease = new Date(now.getTime() + THIRTY_MIN_MS).toISOString();
    tasks.claim(taskId, alice, aliceLease, now.toISOString());

    const bobLease = new Date(now.getTime() + THIRTY_MIN_MS).toISOString();
    const result = tasks.claim(taskId, bob, bobLease, now.toISOString());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason.kind).toBe('ALREADY_CLAIMED');
    if (result.reason.kind === 'ALREADY_CLAIMED') {
      expect(result.reason.claimedBy).toBe(alice);
      expect(result.reason.leaseExpiresAt).toBe(aliceLease);
    }
    // The row still belongs to alice — bob's attempt changed nothing.
    expect(tasks.findById(taskId)?.claimedBy).toBe(alice);
  });

  it('lets a second actor claim once the first lease has expired', () => {
    const t0 = new Date('2026-01-01T00:00:00.000Z');
    const shortLease = new Date(t0.getTime() + 60_000).toISOString(); // expires at 00:01
    tasks.claim(taskId, alice, shortLease, t0.toISOString());

    // Two minutes later alice's lease is in the past; bob may take it.
    const t1 = new Date('2026-01-01T00:02:00.000Z');
    const bobLease = new Date(t1.getTime() + THIRTY_MIN_MS).toISOString();
    const result = tasks.claim(taskId, bob, bobLease, t1.toISOString());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.task.claimedBy).toBe(bob);
    expect(result.task.leaseExpiresAt).toBe(bobLease);
  });

  it('lets the same actor re-claim its own live lease and extends it', () => {
    const now = new Date();
    const first = new Date(now.getTime() + 60_000).toISOString();
    tasks.claim(taskId, alice, first, now.toISOString());

    const extended = new Date(now.getTime() + THIRTY_MIN_MS).toISOString();
    const result = tasks.claim(taskId, alice, extended, now.toISOString());

    // The holder renewing its own live lease succeeds — an agent still
    // working must be able to push the expiry out. A different actor, by
    // contrast, is refused until the lease lapses (covered above).
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.task.claimedBy).toBe(alice);
    expect(result.task.leaseExpiresAt).toBe(extended);
  });

  it('reports NOT_FOUND for an unknown task id', () => {
    const now = new Date();
    const result = tasks.claim(
      'nonexistent-id',
      alice,
      new Date(now.getTime() + THIRTY_MIN_MS).toISOString(),
      now.toISOString(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.kind).toBe('NOT_FOUND');
  });

  it('releaseClaim clears the lease when the holder releases it', () => {
    const now = new Date();
    tasks.claim(
      taskId,
      alice,
      new Date(now.getTime() + THIRTY_MIN_MS).toISOString(),
      now.toISOString(),
    );

    const released = tasks.releaseClaim(taskId, alice);
    expect(released).toBe(true);

    const reloaded = tasks.findById(taskId);
    expect(reloaded?.claimedBy).toBeNull();
    expect(reloaded?.leaseExpiresAt).toBeNull();
  });

  it('releaseClaim is a no-op when a different actor tries to release', () => {
    const now = new Date();
    const lease = new Date(now.getTime() + THIRTY_MIN_MS).toISOString();
    tasks.claim(taskId, alice, lease, now.toISOString());

    const released = tasks.releaseClaim(taskId, bob);
    expect(released).toBe(false);

    // Alice's claim survives bob's defensive release attempt.
    const reloaded = tasks.findById(taskId);
    expect(reloaded?.claimedBy).toBe(alice);
    expect(reloaded?.leaseExpiresAt).toBe(lease);
  });

  it('releaseClaim is a no-op on an unclaimed task', () => {
    expect(tasks.releaseClaim(taskId, alice)).toBe(false);
  });

  it('a claim does not disturb the task state', () => {
    const now = new Date();
    tasks.claim(
      taskId,
      alice,
      new Date(now.getTime() + THIRTY_MIN_MS).toISOString(),
      now.toISOString(),
    );
    expect(tasks.findById(taskId)?.state).toBe(TaskState.Ready);
  });
});
