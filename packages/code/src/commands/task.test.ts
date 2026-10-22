import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalogUpcasters } from '@mnema/chain';
import { type DiscoveryEnv, orderedEvents, resolveTrees } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInit } from './init.js';
import { runTask } from './task.js';

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-task-'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function setup(): { repo: string; env: DiscoveryEnv } {
  const repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  const env = { home: join(sandbox, 'home') };
  runInit({ cwd: repo, env });
  return { repo, env };
}

/** The kinds of the events of the public tree, in order. */
function kindsIn(root: string): string[] {
  return orderedEvents({ root }, catalogUpcasters()).map((e) => e.kind);
}

describe('mnema task create --description', () => {
  it('records the task and, in the same call, a `description` observation about it', () => {
    const { repo, env } = setup();
    const result = runTask(
      { cwd: repo, env },
      {
        title: 'Wire the importer',
        description: 'Move it to the new schema.\nKeep the old reader.',
      },
    );
    if (!result.ok) throw new Error('the create was refused');
    const root = resolveTrees(repo, env).projectPublic as string;
    const noted = orderedEvents({ root }, catalogUpcasters()).flatMap((e) =>
      e.kind === 'observation.recorded' ? [{ id: e.subject, ...e.payload }] : [],
    );
    expect(noted).toEqual([
      {
        id: result.descriptionId,
        about: result.id,
        topic: 'description',
        text: 'Move it to the new schema.\nKeep the old reader.',
      },
    ]);
  });

  it('records no observation, and names no id, when no description was given', () => {
    const { repo, env } = setup();
    const result = runTask({ cwd: repo, env }, { title: 'Plain' });
    expect(result.ok && 'descriptionId' in result).toBe(false);
    expect(kindsIn(resolveTrees(repo, env).projectPublic as string)).not.toContain(
      'observation.recorded',
    );
  });

  it('refuses a description over 64 KiB and leaves NO task behind', () => {
    const { repo, env } = setup();
    const before = kindsIn(resolveTrees(repo, env).projectPublic as string);
    const result = runTask(
      { cwd: repo, env },
      { title: 'Too much', description: 'x'.repeat(65_537) },
    );
    expect(result).toMatchObject({ ok: false, reason: 'REFUSED', code: 'CONTENT_TOO_LARGE' });
    expect(kindsIn(resolveTrees(repo, env).projectPublic as string)).toEqual(before);
  });
});
