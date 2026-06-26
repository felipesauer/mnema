import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Config } from '@/config/config-schema.js';
import { ConfigSchema } from '@/config/config-schema.js';
import { ActorKind } from '@/domain/enums/actor-kind.js';
import { ErrorCode } from '@/errors/error-codes.js';
import { createServiceContainer, type ServiceContainer } from '@/services/service-container.js';

/**
 * Regression for the assignee handling (report items #4/#5):
 * - a known handle resolves to its actor id;
 * - an unknown handle returns a clean UNKNOWN_ASSIGNEE, never the raw
 *   `FOREIGN KEY constraint failed` the database would otherwise throw;
 * - `assign` sets and clears the owner without a state transition.
 */
const migrationsDir = path.resolve('src/storage/sqlite/migrations');
const workflowsSrc = path.resolve('workflows');

function makeConfig(): Config {
  return ConfigSchema.parse({
    version: '1.0',
    mnema_version: '^0.1.0',
    project: { key: 'TEST', name: 'Test' },
    workflow: 'default',
  });
}

describe('TaskService assignee resolution', () => {
  let projectRoot: string;
  let container: ServiceContainer;

  beforeEach(() => {
    projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-assignee-'));
    for (const dir of ['.mnema/state', '.mnema/audit', '.mnema/backlog', '.mnema/workflows']) {
      mkdirSync(path.join(projectRoot, dir), { recursive: true });
    }
    copyFileSync(
      path.join(workflowsSrc, 'default.json'),
      path.join(projectRoot, '.mnema/workflows', 'default.json'),
    );
    container = createServiceContainer(makeConfig(), projectRoot, { migrationsDir });
    // Register `maria` as a known actor by making her the reporter of a
    // throwaway task — `ensureActor` inserts the row that `findActorIdByHandle`
    // can later resolve.
    container.identity.ensureActor('maria', ActorKind.Human);
  });

  afterEach(() => {
    container.close();
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('resolves a known handle to the actor id on create', () => {
    const mariaId = container.identity.findActorIdByHandle('maria');
    expect(mariaId).not.toBeNull();

    const result = container.task.create({
      projectKey: 'TEST',
      title: 'Assigned to maria',
      assigneeId: 'maria',
      actor: 'daniel',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.assigneeId).toBe(mariaId);
  });

  it('returns UNKNOWN_ASSIGNEE (not a raw FK error) for an unknown handle', () => {
    const result = container.task.create({
      projectKey: 'TEST',
      title: 'Assigned to a ghost',
      assigneeId: 'does-not-exist',
      actor: 'daniel',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe(ErrorCode.UnknownAssignee);
    if (result.error.kind === ErrorCode.UnknownAssignee) {
      expect(result.error.handle).toBe('does-not-exist');
    }
  });

  it('accepts a raw UUID assignee without a handle lookup', () => {
    const mariaId = container.identity.findActorIdByHandle('maria');
    expect(mariaId).not.toBeNull();
    if (mariaId === null) return;

    const result = container.task.create({
      projectKey: 'TEST',
      title: 'Assigned by id',
      assigneeId: mariaId,
      actor: 'daniel',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.assigneeId).toBe(mariaId);
  });

  it('assigns and clears via assign()', () => {
    const created = container.task.create({
      projectKey: 'TEST',
      title: 'Will be assigned later',
      actor: 'daniel',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const key = created.value.key;
    expect(created.value.assigneeId).toBeNull();

    const mariaId = container.identity.findActorIdByHandle('maria');
    const assigned = container.task.assign({ taskKey: key, assignee: 'maria', actor: 'daniel' });
    expect(assigned.ok).toBe(true);
    if (assigned.ok) expect(assigned.value.assigneeId).toBe(mariaId);

    const cleared = container.task.assign({ taskKey: key, assignee: null, actor: 'daniel' });
    expect(cleared.ok).toBe(true);
    if (cleared.ok) expect(cleared.value.assigneeId).toBeNull();
  });

  it('assign() on an unknown handle returns UNKNOWN_ASSIGNEE', () => {
    const created = container.task.create({
      projectKey: 'TEST',
      title: 'Probe',
      actor: 'daniel',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = container.task.assign({
      taskKey: created.value.key,
      assignee: 'nobody',
      actor: 'daniel',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe(ErrorCode.UnknownAssignee);
  });

  /** Drives a fresh task DRAFT→READY so `start` (which gates on assignee_id) is reachable. */
  function readyTaskKey(): string {
    const created = container.task.create({
      projectKey: 'TEST',
      title: 'Ready for assignment',
      description: 'A description longer than ten characters',
      acceptanceCriteria: ['done'],
      estimate: 2,
      actor: 'daniel',
    });
    if (!created.ok) throw new Error('setup: create failed');
    const submitted = container.task.transition({
      taskKey: created.value.key,
      action: 'submit',
      payload: {},
      actor: 'daniel',
    });
    if (!submitted.ok) throw new Error('setup: submit failed');
    return created.value.key;
  }

  it('a transition gate (start) resolves a known assignee handle to its id', () => {
    const key = readyTaskKey();
    const mariaId = container.identity.findActorIdByHandle('maria');

    const moved = container.task.transition({
      taskKey: key,
      action: 'start',
      payload: { assignee_id: 'maria' },
      actor: 'daniel',
    });
    expect(moved.ok).toBe(true);
    if (moved.ok) {
      expect(moved.value.state).toBe('IN_PROGRESS');
      expect(moved.value.assigneeId).toBe(mariaId);
    }
  });

  it('a transition gate rejects an unknown assignee handle without minting a ghost actor', () => {
    const key = readyTaskKey();

    const moved = container.task.transition({
      taskKey: key,
      action: 'start',
      payload: { assignee_id: 'phantom' },
      actor: 'daniel',
    });
    expect(moved.ok).toBe(false);
    if (!moved.ok) expect(moved.error.kind).toBe(ErrorCode.UnknownAssignee);
    // The bogus handle must not have been created as a side effect.
    expect(container.identity.findActorIdByHandle('phantom')).toBeNull();
  });
});
