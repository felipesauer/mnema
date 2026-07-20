import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConfigSchema } from '@/config/config-schema.js';
import { createServiceContainer, type ServiceContainer } from '@/services/service-container.js';

const migrationsDir = path.resolve('packages/core/src/storage/sqlite/migrations');
const workflowsSrc = path.resolve('packages/core/workflows');

function setupProject(): { root: string; container: ServiceContainer } {
  const root = mkdtempSync(path.join(tmpdir(), 'mnema-label-sync-'));
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
  return { root, container: createServiceContainer(config, root, { migrationsDir }) };
}

/** Reads the markdown a task currently lives at (DRAFT by default). */
function readTaskMd(root: string, id: string, state = 'DRAFT'): string {
  return readFileSync(path.join(root, '.mnema/backlog', state, `${id}.md`), 'utf-8');
}

describe('label markdown mirror', () => {
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

  it('writes the labels into the task frontmatter on set', () => {
    const created = container.task.create({ projectKey: 'TEST', title: 'Wired', actor: 'daniel' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    container.label.setLabels({
      taskKey: created.value.id,
      labels: ['area:api', 'tipo:bug'],
      actor: 'daniel',
    });

    const md = readTaskMd(root, created.value.id);
    expect(md).toContain('labels:');
    expect(md).toContain('area:api');
    expect(md).toContain('tipo:bug');
  });

  it('clears the frontmatter labels when the set is emptied', () => {
    const created = container.task.create({ projectKey: 'TEST', title: 'Wired', actor: 'daniel' });
    if (!created.ok) return;
    container.label.setLabels({ taskKey: created.value.id, labels: ['area:api'], actor: 'd' });
    container.label.setLabels({ taskKey: created.value.id, labels: [], actor: 'd' });

    const md = readTaskMd(root, created.value.id);
    // The key remains (as an empty list) but the value is gone.
    expect(md).not.toContain('area:api');
  });

  it('rebuilds labels from the markdown frontmatter (round-trip)', () => {
    const draftDir = path.join(root, '.mnema/backlog', 'DRAFT');
    mkdirSync(draftDir, { recursive: true });
    // The mirror is named by the committed id; the frontmatter `id` must match
    // the filename or the rebuild skips the file fail-closed.
    const id = '01920000-0000-7000-8000-000000000001';
    const md = `---
mnema:
  id: ${id}
  state: DRAFT
  title: Imported with labels
  description: ''
  acceptance_criteria: []
  labels:
    - area:api
    - tipo:bug
  estimate: null
  priority: 3
  reporter: daniel
  reopen_count: 0
  metadata: {}
---

# Imported with labels
`;
    writeFileSync(path.join(draftDir, `${id}.md`), md, 'utf-8');

    const summary = container.syncRebuild.run('TEST');
    expect(summary.tasksUpserted).toBe(1);

    const labels = container.label.listForTask(id);
    expect(labels).toEqual({ ok: true, value: ['area:api', 'tipo:bug'] });
  });

  it('rebuild heals label drift: a label removed on disk is removed in the cache', () => {
    // Start with two labels persisted via the service (also writes md).
    const created = container.task.create({ projectKey: 'TEST', title: 'Drift', actor: 'daniel' });
    if (!created.ok) return;
    container.label.setLabels({
      taskKey: created.value.id,
      labels: ['area:api', 'tipo:bug'],
      actor: 'daniel',
    });

    // Rewrite the markdown with only one label, then rebuild. The mirror is
    // named by the committed id.
    const file = path.join(root, '.mnema/backlog', 'DRAFT', `${created.value.id}.md`);
    const original = readFileSync(file, 'utf-8');
    const trimmed = original.replace(/ {4}- tipo:bug\n/, '');
    writeFileSync(file, trimmed, 'utf-8');

    container.syncRebuild.run('TEST');

    expect(container.label.listForTask(created.value.id)).toEqual({
      ok: true,
      value: ['area:api'],
    });
  });
});
