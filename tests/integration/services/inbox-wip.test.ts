import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { ConfigSchema } from '@/config/config-schema.js';
import { createServiceContainer, type ServiceContainer } from '@/services/service-container.js';

const migrationsDir = path.resolve('src/storage/sqlite/migrations');
const workflowsSrc = path.resolve('workflows');

/** Build a container with a given per-state WIP limit config. */
function setup(wipLimits: Record<string, number>): {
  container: ServiceContainer;
  close: () => void;
} {
  const projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-inbox-wip-'));
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
    aging: { wip_limits: wipLimits },
  });
  const container = createServiceContainer(config, projectRoot, { migrationsDir });
  return {
    container,
    close: () => {
      container.close();
      rmSync(projectRoot, { recursive: true, force: true });
    },
  };
}

/** Insert `count` tasks in a given state. */
function seedState(container: ServiceContainer, state: string, count: number): void {
  const db = container.adapter.getDatabase();
  const project = db.prepare('SELECT id FROM projects LIMIT 1').get() as { id: string };
  let actor = db.prepare('SELECT id FROM actors LIMIT 1').get() as { id: string } | undefined;
  if (actor === undefined) {
    db.prepare("INSERT INTO actors (id, handle, kind) VALUES ('act-1', 'daniel', 'human')").run();
    actor = { id: 'act-1' };
  }
  const now = new Date().toISOString();
  for (let i = 0; i < count; i += 1) {
    const key = `${state}-${i}`;
    db.prepare(
      `INSERT INTO tasks (id, key, project_id, title, description, acceptance_criteria, state,
         priority, reporter_id, reopen_count, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, '', '[]', ?, 3, ?, 0, '{}', ?, ?)`,
    ).run(`id-${key}`, key, project.id, `Task ${key}`, state, actor.id, now, now);
  }
}

describe('InboxService WIP limits', () => {
  let h: ReturnType<typeof setup>;
  afterEach(() => h.close());

  it('flags a state holding more tasks than its WIP limit', () => {
    h = setup({ IN_PROGRESS: 2 });
    seedState(h.container, 'IN_PROGRESS', 3); // 3 > 2 → breach
    const breaches = h.container.inbox.wipBreaches();
    expect(breaches).toHaveLength(1);
    expect(breaches[0]).toMatchObject({ state: 'IN_PROGRESS', count: 3, limit: 2 });
    expect(breaches[0]?.keys).toHaveLength(3);
  });

  it('does not flag a state within its WIP limit', () => {
    h = setup({ IN_PROGRESS: 5 });
    seedState(h.container, 'IN_PROGRESS', 5); // 5 == 5 → within limit (not over)
    expect(h.container.inbox.wipBreaches()).toHaveLength(0);
  });

  it('ignores states without a configured limit', () => {
    h = setup({ IN_REVIEW: 1 });
    seedState(h.container, 'IN_PROGRESS', 9); // no limit for IN_PROGRESS
    expect(h.container.inbox.wipBreaches()).toHaveLength(0);
  });

  it('surfaces WIP breaches through view()', () => {
    h = setup({ IN_PROGRESS: 1 });
    seedState(h.container, 'IN_PROGRESS', 2);
    expect(h.container.inbox.view().wipBreaches.map((b) => b.state)).toEqual(['IN_PROGRESS']);
  });

  it('absent config raises nothing', () => {
    h = setup({});
    seedState(h.container, 'IN_PROGRESS', 50);
    expect(h.container.inbox.wipBreaches()).toEqual([]);
  });
});
