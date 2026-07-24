import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalogUpcasters, verify } from '@mnema/chain';
import { type DiscoveryEnv, orderedEvents, projectTasks, resolveTrees } from '@mnema/core';
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
  return { repo, env: { xdgDataHome: join(sandbox, 'data'), home: join(sandbox, 'home') } };
}

describe('mnema task', () => {
  it('creates a task in the current project and returns its id and alias', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });

    const result = runTask({ cwd: repo, env }, { title: 'ship the CLI' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(result.alias).toMatch(/^t-[0-9a-f]{4}$/);
      // The task really landed in the public tree, as a DRAFT.
      const root = resolveTrees(repo, env).projectPublic as string;
      const tasks = projectTasks(orderedEvents({ root }, catalogUpcasters()));
      expect(tasks.get(result.id)?.state).toBe('DRAFT');
    }
  });

  it('leaves the tree fully signed after creating a task', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    runTask({ cwd: repo, env }, { title: 'a task' });
    const root = resolveTrees(repo, env).projectPublic as string;
    const verdict = verify(root);
    expect(verdict.ok).toBe(true);
    expect(verdict.fullySigned).toBe(true);
  });

  it('resolves the project from a subdirectory (walks up to the tree)', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const sub = join(repo, 'src', 'deep');
    mkdirSync(sub, { recursive: true });

    const result = runTask({ cwd: sub, env }, { title: 'from a subdir' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const root = resolveTrees(repo, env).projectPublic as string;
      const tasks = projectTasks(orderedEvents({ root }, catalogUpcasters()));
      expect(tasks.has(result.id)).toBe(true);
    }
  });

  it('refuses with NO_PROJECT when there is no project here', () => {
    const { repo, env } = setup();
    // No init — the cwd has no .mnema up the tree.
    const orphan = join(repo, 'nowhere');
    mkdirSync(orphan, { recursive: true });
    const result = runTask({ cwd: orphan, env }, { title: 'homeless task' });
    expect(result).toEqual({ ok: false, reason: 'NO_PROJECT' });
  });

  it('--scope private is honored: the task is born in the private tree', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });

    const result = runTask({ cwd: repo, env }, { title: 'a private draft', scope: 'private' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const trees = resolveTrees(repo, env);
      // The task is in PRIVATE.
      const privateTasks = projectTasks(
        orderedEvents({ root: trees.projectPrivate as string }, catalogUpcasters()),
      );
      expect(privateTasks.has(result.id)).toBe(true);
      // and NOT in public — the override truly routed the birth.
      const publicTasks = projectTasks(
        orderedEvents({ root: trees.projectPublic as string }, catalogUpcasters()),
      );
      expect(publicTasks.has(result.id)).toBe(false);
    }
  });

  it('an omitted scope defaults to public (the provisional default)', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });

    const result = runTask({ cwd: repo, env }, { title: 'no scope stated' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const root = resolveTrees(repo, env).projectPublic as string;
      const tasks = projectTasks(orderedEvents({ root }, catalogUpcasters()));
      expect(tasks.has(result.id)).toBe(true);
    }
  });

  it('--scope global is born in the global tree even inside a project', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });

    const result = runTask({ cwd: repo, env }, { title: 'cross-project lesson', scope: 'global' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const trees = resolveTrees(repo, env);
      const globalTasks = projectTasks(orderedEvents({ root: trees.global }, catalogUpcasters()));
      expect(globalTasks.has(result.id)).toBe(true);
      // The project's public tree did not receive it.
      const publicTasks = projectTasks(
        orderedEvents({ root: trees.projectPublic as string }, catalogUpcasters()),
      );
      expect(publicTasks.has(result.id)).toBe(false);
    }
  });

  it('--scope global works with no project (global needs no project)', () => {
    const { repo, env } = setup();
    // No init anywhere.
    const orphan = join(repo, 'nowhere');
    mkdirSync(orphan, { recursive: true });

    const result = runTask({ cwd: orphan, env }, { title: 'homeless but global', scope: 'global' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const trees = resolveTrees(orphan, env);
      const globalTasks = projectTasks(orderedEvents({ root: trees.global }, catalogUpcasters()));
      expect(globalTasks.has(result.id)).toBe(true);
    }
  });

  it('--scope public with no project refuses NO_PROJECT (guard is on the resolved scope)', () => {
    const { repo, env } = setup();
    const orphan = join(repo, 'nowhere');
    mkdirSync(orphan, { recursive: true });

    const result = runTask({ cwd: orphan, env }, { title: 'homeless public', scope: 'public' });
    expect(result).toEqual({ ok: false, reason: 'NO_PROJECT' });
  });
});
