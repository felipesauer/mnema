import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConfigSchema } from '@/config/config-schema.js';
import { createServiceContainer, type ServiceContainer } from '@/services/service-container.js';

const migrationsDir = path.resolve('packages/core/src/storage/sqlite/migrations');
const workflowsSrc = path.resolve('packages/core/workflows');

function setupProject(): { root: string; container: ServiceContainer } {
  const root = mkdtempSync(path.join(tmpdir(), 'mnema-dual-id-'));
  for (const dir of ['.mnema/state', '.mnema/audit', '.mnema/backlog', '.mnema/workflows']) {
    mkdirSync(path.join(root, dir), { recursive: true });
  }
  copyFileSync(
    path.join(workflowsSrc, 'default.json'),
    path.join(root, '.mnema/workflows', 'default.json'),
  );

  const config = ConfigSchema.parse({
    version: '2.0',
    mnema_version: '^0.1.0',
    project: { key: 'TEST', name: 'Test' },
    workflow: 'default',
  });
  const container = createServiceContainer(config, root, { migrationsDir });

  return { root, container };
}

describe('Dual identity in transitions', () => {
  let root: string;
  let container: ServiceContainer;

  beforeEach(() => {
    const setup = setupProject();
    root = setup.root;
    container = setup.container;
  });

  afterEach(() => {
    container.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('records actor + via_actor + agent_run on a task created through an agent run', () => {
    const runResult = container.agentRun.start({
      goal: 'create a task',
      actor: 'daniel',
      agentHandle: 'claude-code',
    });
    expect(runResult.ok).toBe(true);
    if (!runResult.ok) return;
    const runId = runResult.value.id;

    const created = container.task.create({
      projectKey: 'TEST',
      title: 'Created via agent',
      actor: 'daniel',
      via: 'agent:claude-code',
      runId,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const transition = container.adapter
      .getDatabase()
      .prepare(
        `SELECT t.actor_id, t.via_actor_id, t.agent_run_id,
                actor.handle AS actor_handle,
                via.handle    AS via_handle
           FROM transitions t
           JOIN actors actor ON actor.id = t.actor_id
           LEFT JOIN actors via ON via.id = t.via_actor_id
          WHERE t.task_id = ?`,
      )
      .get(created.value.id) as
      | {
          actor_id: string;
          via_actor_id: string | null;
          agent_run_id: string | null;
          actor_handle: string;
          via_handle: string | null;
        }
      | undefined;

    expect(transition).toBeDefined();
    expect(transition?.actor_handle).toBe('daniel');
    expect(transition?.via_handle).toBe('agent:claude-code');
    expect(transition?.agent_run_id).toBe(runId);
  });

  it('leaves via_actor_id and agent_run_id NULL when invoked directly by a human', () => {
    const created = container.task.create({
      projectKey: 'TEST',
      title: 'Direct human',
      actor: 'daniel',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const transition = container.adapter
      .getDatabase()
      .prepare('SELECT via_actor_id, agent_run_id FROM transitions WHERE task_id = ?')
      .get(created.value.id) as
      | { via_actor_id: string | null; agent_run_id: string | null }
      | undefined;

    expect(transition?.via_actor_id).toBeNull();
    expect(transition?.agent_run_id).toBeNull();
  });
});
