import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ConfigSchema } from '@/config/config-schema.js';
import { createServiceContainer, type ServiceContainer } from '@/services/service-container.js';

const migrationsDir = path.resolve('src/storage/sqlite/migrations');
const workflowsSrc = path.resolve('workflows');

function setupProject(): { root: string; container: ServiceContainer } {
  const root = mkdtempSync(path.join(tmpdir(), 'mnema-rebuild-'));
  for (const dir of ['.mnema/state', '.mnema/audit', '.mnema/backlog', '.mnema/workflows']) {
    mkdirSync(path.join(root, dir), { recursive: true });
  }
  copyFileSync(
    path.join(workflowsSrc, 'default.json'),
    path.join(root, '.mnema/workflows', 'default.json'),
  );

  const config = ConfigSchema.parse({
    version: '1.0',
    mnema_version: '^0.1.0',
    project: { key: 'TEST', name: 'Test' },
    workflow: 'default',
  });
  const container = createServiceContainer(config, root, { migrationsDir });

  return { root, container };
}

describe('SyncRebuild', () => {
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

  it('inserts tasks for markdowns that are not yet in the database', () => {
    const draftDir = path.join(root, '.mnema/backlog', 'DRAFT');
    mkdirSync(draftDir, { recursive: true });

    const md = `---
mnema:
  key: TEST-1
  state: DRAFT
  title: Imported task
  description: ''
  acceptance_criteria: []
  estimate: null
  priority: 3
  reporter: daniel
  reopen_count: 0
  metadata: {}
---

# Imported task
`;
    writeFileSync(path.join(draftDir, 'TEST-1.md'), md, 'utf-8');

    const summary = container.syncRebuild.run('TEST');
    expect(summary.tasksScanned).toBe(1);
    expect(summary.tasksUpserted).toBe(1);

    const list = container.task.list();
    expect(list.map((t) => t.key)).toEqual(['TEST-1']);
    expect(list[0]?.title).toBe('Imported task');
  });

  it('is idempotent — second run reports zero changes', () => {
    const created = container.task.create({
      projectKey: 'TEST',
      title: 'Existing',
      actor: 'daniel',
    });
    expect(created.ok).toBe(true);

    const first = container.syncRebuild.run('TEST');
    const second = container.syncRebuild.run('TEST');

    expect(first.tasksUpserted).toBe(0);
    expect(second.tasksUpserted).toBe(0);
    expect(first.tasksScanned).toBe(second.tasksScanned);
  });

  it('updates state when the markdown lives in a different state folder', () => {
    container.task.create({ projectKey: 'TEST', title: 'Move via fs', actor: 'daniel' });

    const draftFile = path.join(root, '.mnema/backlog', 'DRAFT', 'TEST-1.md');
    const readyDir = path.join(root, '.mnema/backlog', 'READY');
    mkdirSync(readyDir, { recursive: true });

    const original = readFileSync(draftFile, 'utf-8');
    writeFileSync(path.join(readyDir, 'TEST-1.md'), original.replace('DRAFT', 'READY'), 'utf-8');
    rmSync(draftFile, { force: true });

    const summary = container.syncRebuild.run('TEST');
    expect(summary.tasksUpserted).toBe(1);

    const reloaded = container.task.findByKey('TEST-1');
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) return;
    expect(reloaded.value.state).toBe('READY');
  });

  it('skips files whose mnema.key does not match the filename', () => {
    const dir = path.join(root, '.mnema/backlog', 'DRAFT');
    mkdirSync(dir, { recursive: true });

    const md = `---
mnema:
  key: TEST-99
  state: DRAFT
  title: wrong filename
---

body
`;
    writeFileSync(path.join(dir, 'TEST-1.md'), md, 'utf-8');

    const summary = container.syncRebuild.run('TEST');
    expect(summary.skipped.length).toBeGreaterThan(0);
    expect(existsSync(path.join(root, '.mnema/state', 'state.db'))).toBe(true);

    const list = container.task.list();
    expect(list).toHaveLength(0);
  });

  it('skips a backlog directory whose name is not a workflow state', () => {
    // A valid task in a real state, alongside a task under a bogus
    // directory. Since migration 004 dropped the tasks.state CHECK, an
    // unknown state would otherwise persist and strand the task past the
    // workflow gates — the rebuild must refuse it.
    const draftDir = path.join(root, '.mnema/backlog', 'DRAFT');
    mkdirSync(draftDir, { recursive: true });
    const validMd = `---
mnema:
  key: TEST-1
  state: DRAFT
  title: Legit task
  reporter: daniel
---

# Legit task
`;
    writeFileSync(path.join(draftDir, 'TEST-1.md'), validMd, 'utf-8');

    const bogusDir = path.join(root, '.mnema/backlog', 'NOTASTATE');
    mkdirSync(bogusDir, { recursive: true });
    const bogusMd = `---
mnema:
  key: TEST-2
  state: NOTASTATE
  title: Smuggled task
  reporter: daniel
---

# Smuggled task
`;
    writeFileSync(path.join(bogusDir, 'TEST-2.md'), bogusMd, 'utf-8');

    const summary = container.syncRebuild.run('TEST');

    // The legit task is upserted; the smuggled one is reported skipped.
    const list = container.task.list();
    expect(list.map((t) => t.key)).toEqual(['TEST-1']);
    expect(summary.skipped.some((s) => s.file.includes('TEST-2.md'))).toBe(true);
    expect(summary.skipped.some((s) => s.reason.includes('NOTASTATE'))).toBe(true);

    // No row anywhere carries the invalid state.
    expect(container.task.list().some((t) => t.state === 'NOTASTATE')).toBe(false);
  });
});
