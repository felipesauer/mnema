import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Config } from '@/config/config-schema.js';
import { ConfigSchema } from '@/config/config-schema.js';
import { createServiceContainer, type ServiceContainer } from '@/services/service-container.js';

/**
 * Recovery path: a project that gained epics/sprints/decisions before
 * the markdown mirror existed (or after the files were deleted) has rows
 * in SQLite but no `.md` on disk. `rebuildMirrors` re-creates the
 * missing files without touching the ones already present.
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

describe('roadmap mirror rebuild', () => {
  let projectRoot: string;
  let container: ServiceContainer;
  const roadmapDir = () => path.join(projectRoot, '.mnema/roadmap');
  const sprintsDir = () => path.join(projectRoot, '.mnema/sprints');

  beforeEach(() => {
    projectRoot = mkdtempSync(path.join(tmpdir(), 'mnema-roadmap-rebuild-'));
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

  /** Creates one epic, one sprint and one decision, then deletes their mirrors. */
  function seedRowsWithoutMirrors(): { epic: string; sprint: string; decision: string } {
    const epic = container.epic.create({ projectKey: 'TEST', title: 'An epic', actor: 'daniel' });
    const sprint = container.sprint.plan({ projectKey: 'TEST', name: 'A sprint', actor: 'daniel' });
    const decision = container.decision.record({
      projectKey: 'TEST',
      title: 'A decision',
      decision: 'do the thing',
      actor: 'daniel',
    });
    if (!epic.ok || !sprint.ok || !decision.ok) throw new Error('setup: create failed');

    // Simulate a project from before the mirror existed: rows present,
    // files gone.
    rmSync(path.join(roadmapDir(), `${epic.value.key}.md`), { force: true });
    rmSync(path.join(sprintsDir(), `${sprint.value.key}.md`), { force: true });
    rmSync(path.join(roadmapDir(), `${decision.value.key}.md`), { force: true });

    return { epic: epic.value.key, sprint: sprint.value.key, decision: decision.value.key };
  }

  it('recreates missing epic/sprint/decision mirrors', () => {
    const keys = seedRowsWithoutMirrors();
    expect(existsSync(path.join(roadmapDir(), `${keys.epic}.md`))).toBe(false);

    const epics = container.epic.rebuildMirrors('TEST');
    const sprints = container.sprint.rebuildMirrors('TEST');
    const decisions = container.decision.rebuildMirrors('TEST');

    expect(epics).toEqual([keys.epic]);
    expect(sprints).toEqual([keys.sprint]);
    expect(decisions).toEqual([keys.decision]);

    expect(existsSync(path.join(roadmapDir(), `${keys.epic}.md`))).toBe(true);
    expect(existsSync(path.join(sprintsDir(), `${keys.sprint}.md`))).toBe(true);
    expect(existsSync(path.join(roadmapDir(), `${keys.decision}.md`))).toBe(true);
  });

  it('is idempotent — a second rebuild writes nothing', () => {
    seedRowsWithoutMirrors();
    container.epic.rebuildMirrors('TEST');
    container.sprint.rebuildMirrors('TEST');
    container.decision.rebuildMirrors('TEST');

    expect(container.epic.rebuildMirrors('TEST')).toEqual([]);
    expect(container.sprint.rebuildMirrors('TEST')).toEqual([]);
    expect(container.decision.rebuildMirrors('TEST')).toEqual([]);
  });

  it('leaves an existing mirror untouched (only fills the gaps)', () => {
    const keys = seedRowsWithoutMirrors();
    // Restore just the epic's mirror by rebuilding it once.
    container.epic.rebuildMirrors('TEST');

    // A fresh rebuild should now find the epic present and skip it.
    expect(container.epic.rebuildMirrors('TEST')).toEqual([]);
    // The sprint was never rebuilt, so it is still pending.
    expect(container.sprint.rebuildMirrors('TEST')).toEqual([keys.sprint]);
  });
});
