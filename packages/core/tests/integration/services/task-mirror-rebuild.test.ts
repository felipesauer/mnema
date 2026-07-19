import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Config } from '@/config/config-schema.js';
import { ConfigSchema } from '@/config/config-schema.js';
import { createServiceContainer, type ServiceContainer } from '@/services/service-container.js';

/**
 * Recovery path for the backlog mirror: a task has a SQLite row but its
 * `backlog/<STATE>/<ID>.md` file is gone (a project from before the
 * mirror existed, or a file deleted by hand). `SyncService.rebuildMirrors`
 * re-creates the missing file from the row without touching mirrors that
 * are already present.
 *
 * Sibling of `roadmap-mirror-rebuild.test.ts`, which covers the flat
 * epic/sprint/decision directories; tasks differ in that their mirrors
 * live under a per-state subfolder, so the rebuild has to land the file
 * in the right `<STATE>/` directory.
 */
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

describe('task mirror rebuild', () => {
  let projectRoot: string;
  let container: ServiceContainer;
  const backlogDir = () => path.join(projectRoot, '.mnema/backlog');
  const mirrorFor = (state: string, id: string) => path.join(backlogDir(), state, `${id}.md`);

  beforeEach(() => {
    projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-task-rebuild-'));
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

  /** Creates one task (DRAFT); its mirror (named by id) is written on create. */
  function seedTask(title: string): { id: string; key: string } {
    const task = container.task.create({ projectKey: 'TEST', title, actor: 'daniel' });
    if (!task.ok) throw new Error('setup: task create failed');
    return { id: task.value.id, key: task.value.key };
  }

  it('recreates a missing task mirror from the SQLite row', () => {
    const { id, key } = seedTask('A real task');
    // Simulate drift: the row is present, the file is gone.
    rmSync(mirrorFor('DRAFT', id), { force: true });
    expect(existsSync(mirrorFor('DRAFT', id))).toBe(false);

    const rebuilt = container.sync.rebuildMirrors();

    expect(rebuilt).toEqual([key]);
    expect(existsSync(mirrorFor('DRAFT', id))).toBe(true);
  });

  it("lands the rebuilt mirror in the task's current state folder", () => {
    const { id, key } = seedTask('Moves through states');
    // Advance the task so its state — and therefore its mirror folder —
    // is no longer the initial one, then delete the mirror.
    const moved = container.task.transition({
      taskKey: key,
      action: 'submit',
      payload: {
        title: 'Moves through states',
        description: 'A task with enough detail to pass the submit gate.',
        acceptance_criteria: ['ships'],
        estimate: 3,
      },
      actor: 'daniel',
    });
    if (!moved.ok) throw new Error(`setup: submit failed (${moved.error.kind})`);
    const state = moved.value.state;
    expect(state).not.toBe('DRAFT');
    rmSync(mirrorFor(state, id), { force: true });

    const rebuilt = container.sync.rebuildMirrors();

    expect(rebuilt).toEqual([key]);
    // Recreated under the new state, not the initial DRAFT folder.
    expect(existsSync(mirrorFor(state, id))).toBe(true);
    expect(existsSync(mirrorFor('DRAFT', id))).toBe(false);
  });

  it('is idempotent — a second rebuild writes nothing', () => {
    const { id, key } = seedTask('Idempotent');
    rmSync(mirrorFor('DRAFT', id), { force: true });

    expect(container.sync.rebuildMirrors()).toEqual([key]);
    expect(container.sync.rebuildMirrors()).toEqual([]);
  });

  it('leaves an existing mirror untouched (only fills the gaps)', () => {
    const kept = seedTask('Kept');
    const gone = seedTask('Gone');
    // Only the second task's mirror drifts.
    rmSync(mirrorFor('DRAFT', gone.id), { force: true });

    const rebuilt = container.sync.rebuildMirrors();

    expect(rebuilt).toEqual([gone.key]);
    expect(existsSync(mirrorFor('DRAFT', kept.id))).toBe(true);
    expect(existsSync(mirrorFor('DRAFT', gone.id))).toBe(true);
  });
});
