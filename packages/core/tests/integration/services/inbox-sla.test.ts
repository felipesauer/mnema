import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { ConfigSchema } from '@/config/config-schema.js';
import { deriveAlias } from '@/domain/entity-alias.js';
import { createServiceContainer, type ServiceContainer } from '@/services/service-container.js';

const migrationsDir = path.resolve('packages/core/src/storage/sqlite/migrations');
const workflowsSrc = path.resolve('packages/core/workflows');
const DAY = 86_400_000;

/**
 * Build a container with a given aging/SLA config, seed one task per
 * state, and backdate each via SQL so its time-in-state is controllable.
 */
function setup(
  slaDays: Record<string, number>,
  staleAfterDays = 3,
): {
  container: ServiceContainer;
  now: number;
  close: () => void;
} {
  const projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-inbox-sla-'));
  for (const dir of ['.mnema/state', '.mnema/audit', '.mnema/backlog', '.mnema/workflows']) {
    mkdirSync(path.join(projectRoot, dir), { recursive: true });
  }
  copyFileSync(
    path.join(workflowsSrc, 'default.json'),
    path.join(projectRoot, '.mnema/workflows', 'default.json'),
  );
  const config = ConfigSchema.parse({
    version: '2.0',
    mnema_version: '^0.1.0',
    project: { key: 'TEST', name: 'Test' },
    workflow: 'default',
    aging: { stale_after_days: staleAfterDays, sla_days: slaDays },
  });
  const container = createServiceContainer(config, projectRoot, { migrationsDir });
  return {
    container,
    now: Date.now(),
    close: () => {
      container.close();
      rmSync(projectRoot, { recursive: true, force: true });
    },
  };
}

/**
 * Insert a task directly in a given state, last-moved `ageDays` ago.
 *
 * `at` is derived from the same `now` the test later passes to
 * `slaBreaches`, never from a fresh `Date.now()`. Anchoring both reads
 * to one clock makes `now - at` exactly `ageDays * DAY`, so the
 * service's `Math.floor` is exact — otherwise the few ms between the
 * two `Date.now()` calls can drop the floored age by one day and make
 * the assertion non-deterministic across runtimes.
 */
function seedTask(
  container: ServiceContainer,
  handle: string,
  state: string,
  ageDays: number,
  now: number,
): string {
  const db = container.adapter.getDatabase();
  const project = db.prepare('SELECT id FROM projects LIMIT 1').get() as { id: string };
  let actor = db.prepare('SELECT id FROM actors LIMIT 1').get() as { id: string } | undefined;
  if (actor === undefined) {
    db.prepare("INSERT INTO actors (id, handle, kind) VALUES ('act-1', 'daniel', 'human')").run();
    actor = { id: 'act-1' };
  }
  const id = `id-${handle}`;
  const at = new Date(now - ageDays * DAY).toISOString();
  db.prepare(
    `INSERT INTO tasks (id, project_id, title, description, acceptance_criteria, state,
       reporter_id, assignee_id, reopen_count, metadata, created_at, updated_at)
     VALUES (?, ?, ?, '', '[]', ?, ?, ?, 0, '{}', ?, ?)`,
  ).run(id, project.id, `Task ${handle}`, state, actor.id, actor.id, at, at);
  return id;
}

describe('InboxService SLA breaches', () => {
  let h: ReturnType<typeof setup>;
  afterEach(() => h.close());

  it('flags a task past the per-state SLA, with age and threshold', () => {
    // IN_REVIEW SLA = 2 days; this task has sat 5 days → breach.
    h = setup({ IN_REVIEW: 2 });
    const id = seedTask(h.container, 'TEST-1', 'IN_REVIEW', 5, h.now);
    const breaches = h.container.inbox.slaBreaches(h.now);
    expect(breaches).toHaveLength(1);
    expect(breaches[0]).toMatchObject({
      key: deriveAlias('task', id),
      state: 'IN_REVIEW',
      age_days: 5,
      sla_days: 2,
    });
  });

  it('does not flag a task within its per-state SLA', () => {
    // IN_REVIEW SLA = 5; only 2 days in → no breach.
    h = setup({ IN_REVIEW: 5 });
    seedTask(h.container, 'TEST-1', 'IN_REVIEW', 2, h.now);
    expect(h.container.inbox.slaBreaches(h.now)).toHaveLength(0);
  });

  it('falls back to stale_after_days when a state has no SLA override', () => {
    // No override for IN_PROGRESS → uses stale_after_days = 3. 4 days → breach.
    h = setup({ IN_REVIEW: 10 }, 3);
    seedTask(h.container, 'TEST-1', 'IN_PROGRESS', 4, h.now);
    const breaches = h.container.inbox.slaBreaches(h.now);
    expect(breaches).toHaveLength(1);
    expect(breaches[0]?.sla_days).toBe(3); // the fallback, not 10
  });

  it('never flags terminal-state tasks, however old', () => {
    h = setup({}, 1);
    seedTask(h.container, 'TEST-1', 'DONE', 90, h.now);
    seedTask(h.container, 'TEST-2', 'CANCELED', 90, h.now);
    expect(h.container.inbox.slaBreaches(h.now)).toHaveLength(0);
  });

  it('sorts breaches most-overdue first and surfaces them in view()', () => {
    h = setup({ IN_REVIEW: 1, BLOCKED: 1 });
    const id1 = seedTask(h.container, 'TEST-1', 'IN_REVIEW', 3, h.now);
    const id2 = seedTask(h.container, 'TEST-2', 'BLOCKED', 9, h.now);
    const view = h.container.inbox.view(h.now);
    // 9d before 3d.
    expect(view.slaBreaches.map((b) => b.key)).toEqual([
      deriveAlias('task', id2),
      deriveAlias('task', id1),
    ]);
  });
});
