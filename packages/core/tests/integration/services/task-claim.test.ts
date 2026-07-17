import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Config } from '@/config/config-schema.js';
import { ConfigSchema } from '@/config/config-schema.js';
import { ErrorCode } from '@/errors/error-codes.js';
import { createServiceContainer, type ServiceContainer } from '@/services/service-container.js';

/**
 * Covers the claim lease at the service level: reserving a task before work
 * starts, the self-expiring lease, and that only the holder can release it.
 * Uses the real container (no mocks), the project-wide convention.
 */
const migrationsDir = path.resolve('packages/core/src/storage/sqlite/migrations');
const workflowsSrc = path.resolve('packages/core/workflows');

function makeConfig(): Config {
  return ConfigSchema.parse({
    version: '1.0',
    mnema_version: '^0.1.0',
    project: { key: 'TEST', name: 'Test' },
    workflow: 'default',
  });
}

describe('TaskService claim/releaseClaim', () => {
  let projectRoot: string;
  let container: ServiceContainer;

  beforeEach(() => {
    projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-claim-svc-'));
    for (const dir of ['.mnema/state', '.mnema/audit', '.mnema/backlog', '.mnema/workflows']) {
      mkdirSync(path.join(projectRoot, dir), { recursive: true });
    }
    copyFileSync(
      path.join(workflowsSrc, 'default.json'),
      path.join(projectRoot, '.mnema/workflows', 'default.json'),
    );
    container = createServiceContainer(makeConfig(), projectRoot, { migrationsDir });
  });

  afterEach(() => {
    container.close();
    rmSync(projectRoot, { recursive: true, force: true });
  });

  /** Creates a task and returns its key. */
  function makeTask(title = 'Claimable'): string {
    const created = container.task.create({ projectKey: 'TEST', title, actor: 'alice' });
    if (!created.ok) throw new Error('setup: create failed');
    return created.value.key;
  }

  it('claims a task and records the holder + a future lease', () => {
    const key = makeTask();
    const result = container.task.claim({ taskKey: key, actor: 'alice', leaseMinutes: 30 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.claimedBy).not.toBeNull();
    expect(result.value.leaseExpiresAt).not.toBeNull();
    // The lease is in the future relative to now.
    expect(Date.parse(result.value.leaseExpiresAt as string)).toBeGreaterThan(Date.now());
  });

  it('refuses a claim held by a different actor with TASK_ALREADY_CLAIMED', () => {
    const key = makeTask();
    const first = container.task.claim({ taskKey: key, actor: 'alice', leaseMinutes: 30 });
    expect(first.ok).toBe(true);

    const second = container.task.claim({ taskKey: key, actor: 'bob', leaseMinutes: 30 });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.kind).toBe(ErrorCode.TaskAlreadyClaimed);
    if (second.error.kind === ErrorCode.TaskAlreadyClaimed) {
      expect(second.error.taskKey).toBe(key);
      expect(second.error.leaseExpiresAt).not.toBe('');
    }
  });

  it('lets the same actor re-claim to extend its own live lease', () => {
    const key = makeTask();
    const first = container.task.claim({ taskKey: key, actor: 'alice', leaseMinutes: 1 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const extended = container.task.claim({ taskKey: key, actor: 'alice', leaseMinutes: 60 });
    expect(extended.ok).toBe(true);
    if (!extended.ok) return;
    // The renewed lease is strictly later than the original.
    expect(Date.parse(extended.value.leaseExpiresAt as string)).toBeGreaterThan(
      Date.parse(first.value.leaseExpiresAt as string),
    );
  });

  it('returns TASK_NOT_FOUND for an unknown task', () => {
    const result = container.task.claim({ taskKey: 'TEST-999', actor: 'alice', leaseMinutes: 30 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe(ErrorCode.TaskNotFound);
  });

  it('releaseClaim clears the holder for the actor that holds it', () => {
    const key = makeTask();
    container.task.claim({ taskKey: key, actor: 'alice', leaseMinutes: 30 });

    const released = container.task.releaseClaim({ taskKey: key, actor: 'alice' });
    expect(released.ok).toBe(true);
    if (!released.ok) return;
    expect(released.value.claimedBy).toBeNull();
    expect(released.value.leaseExpiresAt).toBeNull();
  });

  it('releaseClaim by a non-holder is a no-op that leaves the claim intact', () => {
    const key = makeTask();
    const claimed = container.task.claim({ taskKey: key, actor: 'alice', leaseMinutes: 30 });
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) return;

    // Bob defensively releases a task he never held: not an error, but the
    // claim must survive.
    const released = container.task.releaseClaim({ taskKey: key, actor: 'bob' });
    expect(released.ok).toBe(true);
    if (!released.ok) return;
    expect(released.value.claimedBy).toBe(claimed.value.claimedBy);
    expect(released.value.leaseExpiresAt).toBe(claimed.value.leaseExpiresAt);
  });

  it('writes a task_claimed audit event on a successful claim', () => {
    const key = makeTask();
    container.task.claim({ taskKey: key, actor: 'alice', leaseMinutes: 30 });

    const events = container.auditQuery.run({ taskKey: key, kind: 'task_claimed' });
    expect(events).toHaveLength(1);
  });

  it('writes a task_claim_released audit event only when a claim was actually released', () => {
    const key = makeTask();
    container.task.claim({ taskKey: key, actor: 'alice', leaseMinutes: 30 });

    // A real release by the holder.
    container.task.releaseClaim({ taskKey: key, actor: 'alice' });
    // A no-op release by a non-holder must not add a second event.
    container.task.releaseClaim({ taskKey: key, actor: 'bob' });

    const events = container.auditQuery.run({ taskKey: key, kind: 'task_claim_released' });
    expect(events).toHaveLength(1);
  });

  it('reaching a terminal state clears a dangling claim', () => {
    const key = makeTask();
    // Claim the task, then drive it all the way to DONE. The holder never
    // releases; the terminal transition must clear the lease on its own.
    const claimed = container.task.claim({ taskKey: key, actor: 'alice', leaseMinutes: 30 });
    expect(claimed.ok).toBe(true);

    container.task.transition({
      taskKey: key,
      action: 'submit',
      payload: {
        title: 'A well-formed title',
        description: 'A description long enough to pass the gate',
        acceptance_criteria: ['works'],
        estimate: 1,
      },
      actor: 'alice',
    });
    container.task.transition({
      taskKey: key,
      action: 'start',
      payload: { assignee_id: 'alice' },
      actor: 'alice',
    });
    const done = container.task.transition({
      taskKey: key,
      action: 'complete',
      payload: { completion_note: 'shipped it' },
      actor: 'alice',
    });

    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.value.state).toBe('DONE');
    // The whole point: a completed task keeps no stale claim.
    expect(done.value.claimedBy).toBeNull();
    expect(done.value.leaseExpiresAt).toBeNull();
  });
});

/**
 * Covers the opt-in start-time claim gate (`claims.require_to_start`). With
 * the flag on, the `start` action requires the acting actor to hold a live
 * claim: two actors cannot both pull the same ready task into progress. The
 * default-off behaviour (no claim needed) is asserted alongside so the two
 * cannot drift.
 */
describe('TaskService start-time claim gate (claims.require_to_start)', () => {
  let projectRoot: string;
  let container: ServiceContainer;

  function setup(requireToStart: boolean): void {
    projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-claim-gate-'));
    for (const dir of ['.mnema/state', '.mnema/audit', '.mnema/backlog', '.mnema/workflows']) {
      mkdirSync(path.join(projectRoot, dir), { recursive: true });
    }
    copyFileSync(
      path.join(workflowsSrc, 'default.json'),
      path.join(projectRoot, '.mnema/workflows', 'default.json'),
    );
    const config = ConfigSchema.parse({
      version: '1.0',
      mnema_version: '^0.1.0',
      project: { key: 'TEST', name: 'Test' },
      workflow: 'default',
      claims: { require_to_start: requireToStart },
    });
    container = createServiceContainer(config, projectRoot, { migrationsDir });
  }

  afterEach(() => {
    container.close();
    rmSync(projectRoot, { recursive: true, force: true });
  });

  /** Creates a task and drives it to READY so `start` is the next move. */
  function makeReadyTask(): string {
    const created = container.task.create({
      projectKey: 'TEST',
      title: 'Pickable',
      actor: 'alice',
    });
    if (!created.ok) throw new Error('setup: create failed');
    const key = created.value.key;
    const submitted = container.task.transition({
      taskKey: key,
      action: 'submit',
      payload: {
        title: 'A well-formed title',
        description: 'A description long enough to pass the gate',
        acceptance_criteria: ['works'],
        estimate: 1,
      },
      actor: 'alice',
    });
    if (!submitted.ok) throw new Error('setup: submit failed');
    return key;
  }

  it('flag ON: two actors cannot both start the same ready task — one wins, the other is refused', () => {
    setup(true);
    const key = makeReadyTask();

    // Alice claims the ready task; bob does not hold a claim.
    const claimed = container.task.claim({ taskKey: key, actor: 'alice', leaseMinutes: 30 });
    expect(claimed.ok).toBe(true);

    // Bob (no live claim) is refused with TASK_NOT_CLAIMED. The assignee
    // is a known handle so assignee resolution passes and the claim gate
    // is what refuses — the acting actor (bob) is not the claim holder.
    const bob = container.task.transition({
      taskKey: key,
      action: 'start',
      payload: { assignee_id: 'alice' },
      actor: 'bob',
    });
    expect(bob.ok).toBe(false);
    if (bob.ok) return;
    expect(bob.error.kind).toBe(ErrorCode.TaskNotClaimed);

    // Alice, who holds the live lease, succeeds.
    const alice = container.task.transition({
      taskKey: key,
      action: 'start',
      payload: { assignee_id: 'alice' },
      actor: 'alice',
    });
    expect(alice.ok).toBe(true);
    if (!alice.ok) return;
    expect(alice.value.state).toBe('IN_PROGRESS');
  });

  it('flag ON: starting with no claim at all is refused with TASK_NOT_CLAIMED', () => {
    setup(true);
    const key = makeReadyTask();

    const started = container.task.transition({
      taskKey: key,
      action: 'start',
      payload: { assignee_id: 'alice' },
      actor: 'alice',
    });
    expect(started.ok).toBe(false);
    if (started.ok) return;
    expect(started.error.kind).toBe(ErrorCode.TaskNotClaimed);
  });

  it('flag OFF (default): start needs no claim — unchanged behaviour', () => {
    setup(false);
    const key = makeReadyTask();

    const started = container.task.transition({
      taskKey: key,
      action: 'start',
      payload: { assignee_id: 'alice' },
      actor: 'alice',
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.value.state).toBe('IN_PROGRESS');
  });
});
