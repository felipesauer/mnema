import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Config } from '@/config/config-schema.js';
import { ConfigSchema } from '@/config/config-schema.js';
import { deriveAlias } from '@/domain/entity-alias.js';
import { ActorKind } from '@/domain/enums/actor-kind.js';
import { createServiceContainer, type ServiceContainer } from '@/services/service-container.js';

const migrationsDir = path.resolve('packages/core/src/storage/sqlite/migrations');
const workflowsSrc = path.resolve('packages/core/workflows');

function makeConfig(): Config {
  return ConfigSchema.parse({
    version: '2.0',
    mnema_version: '^0.1.0',
    project: { key: 'TEST', name: 'Test' },
    workflow: 'default',
  });
}

describe('FocusService.current', () => {
  let projectRoot: string;
  let container: ServiceContainer;

  beforeEach(() => {
    projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-focus-'));
    for (const dir of ['.mnema/state', '.mnema/audit', '.mnema/backlog', '.mnema/workflows']) {
      const full = path.join(projectRoot, dir);
      if (!existsSync(full)) mkdirSync(full, { recursive: true });
    }
    copyFileSync(
      path.join(workflowsSrc, 'default.json'),
      path.join(projectRoot, '.mnema/workflows', 'default.json'),
    );
    container = createServiceContainer(makeConfig(), projectRoot, { migrationsDir });
    container.identity.ensureActor('alice', ActorKind.Human);
    container.identity.ensureActor('bob', ActorKind.Human);
  });

  afterEach(() => {
    container.close();
    rmSync(projectRoot, { recursive: true, force: true });
  });

  /** Create a task and drive it to IN_PROGRESS assigned to `assignee`. */
  function inProgressFor(assignee: string, title: string): string {
    const created = container.task.create({ projectKey: 'TEST', title, actor: assignee });
    if (!created.ok) throw new Error('create failed');
    const id = created.value.id;
    container.task.transition({
      taskKey: id,
      action: 'submit',
      payload: { title, description: `${title} ready`, acceptance_criteria: ['ok'], estimate: 1 },
      actor: assignee,
    });
    container.task.transition({
      taskKey: id,
      action: 'start',
      payload: { assignee_id: assignee },
      actor: assignee,
    });
    return id;
  }

  it("resumes the actor's OWN in-progress task with activeIsMine=true", () => {
    const id = inProgressFor('alice', 'Alice work');
    const focus = container.focus.current('alice');
    expect(focus.focus).toBe('resume');
    expect(focus.activeTask?.key).toBe(deriveAlias('task', id));
    expect(focus.activeIsMine).toBe(true);
  });

  it("falls back to another actor's in-progress task for the line, but marks activeIsMine=false", () => {
    // Audit MEDIUM: the generic focus line still resumes any in-progress work
    // (so a session sees there IS work), but `activeIsMine` must reveal it is
    // not the querying actor's — the signal `mnema guard` needs to avoid
    // authorising Alice's edit off Bob's task.
    const bobId = inProgressFor('bob', 'Bob work');
    const focus = container.focus.current('alice');
    expect(focus.focus).toBe('resume');
    expect(focus.activeTask?.key).toBe(deriveAlias('task', bobId));
    expect(focus.activeIsMine).toBe(false);
  });

  it('points at the top ready task with activeIsMine=false when nothing is in progress', () => {
    const created = container.task.create({
      projectKey: 'TEST',
      title: 'Ready one',
      actor: 'alice',
    });
    if (!created.ok) throw new Error('create failed');
    container.task.transition({
      taskKey: created.value.id,
      action: 'submit',
      payload: {
        title: 'Ready one',
        description: 'ready to pick',
        acceptance_criteria: ['ok'],
        estimate: 1,
      },
      actor: 'alice',
    });
    const focus = container.focus.current('alice');
    expect(focus.focus).toBe('start');
    expect(focus.activeIsMine).toBe(false);
  });
});
