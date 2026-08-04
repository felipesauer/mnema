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

  it('an omitted scope follows the kind: a task is the team’s board, so public', () => {
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

describe('mnema task --which — the agent that executed', () => {
  /** Every `task.created` in a tree, with the agent each one names. */
  function creationsIn(root: string): { subject: string | undefined; which?: string }[] {
    return orderedEvents({ root }, catalogUpcasters())
      .filter((e) => e.kind === 'task.created')
      .map((e) => ({ subject: e.subject, ...(e.which !== undefined ? { which: e.which } : {}) }));
  }

  it('records the declared agent on the fact', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });

    const result = runTask(
      { cwd: repo, env },
      { title: 'work an agent did', which: 'ci-runner', scope: 'public' },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const root = resolveTrees(repo, env).projectPublic as string;
      const created = creationsIn(root).find((e) => e.subject === result.id);
      expect(created?.which).toBe('ci-runner');
    }
  });

  it('does NOT move the tree: the KIND decides, so an agent’s task is the team’s too', () => {
    // The site's rule, asserted against BOTH authors at once: a task is the team's
    // board whoever opened it. This used to send an agent's task to the private
    // tree, which left a clone of the repository with no board at all.
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const trees = resolveTrees(repo, env);

    const byAgent = runTask({ cwd: repo, env }, { title: 'an agent capture', which: 'ci-runner' });
    const byPerson = runTask({ cwd: repo, env }, { title: 'a person capture' });
    expect(byAgent.ok && byPerson.ok).toBe(true);
    if (byAgent.ok && byPerson.ok) {
      const inPublic = creationsIn(trees.projectPublic as string).map((e) => e.subject);
      expect(inPublic).toContain(byAgent.id);
      expect(inPublic).toContain(byPerson.id);
      // And the private tree holds neither — it has no tail at all.
      expect(creationsIn(trees.projectPrivate as string)).toEqual([]);
      // The reply says where each landed, since nothing in the call did.
      expect(byAgent.scope).toBe('public');
      expect(byPerson.scope).toBe('public');
    }
  });

  it('an explicit scope still wins over the kind', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const trees = resolveTrees(repo, env);

    const result = runTask({ cwd: repo, env }, { title: 'mine alone', scope: 'private' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(creationsIn(trees.projectPrivate as string).map((e) => e.subject)).toContain(
        result.id,
      );
      expect(result.scope).toBe('private');
    }
  });

  it('an explicit scope wins for an agent as well', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });

    const result = runTask(
      { cwd: repo, env },
      { title: 'an agent capture the team should see', which: 'ci-runner', scope: 'public' },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const trees = resolveTrees(repo, env);
      expect(creationsIn(trees.projectPublic as string).some((e) => e.subject === result.id)).toBe(
        true,
      );
    }
  });

  it('an agent named only by whitespace is no agent — and cannot move a tree either', () => {
    // The core reads a blank identity as absent, so the fact carries no agent. The
    // tree is a function of the kind now, so a blank `which` cannot make the two
    // disagree the way it once could: the class of defect is gone, not merely tested.
    const { repo, env } = setup();
    runInit({ cwd: repo, env });

    const result = runTask({ cwd: repo, env }, { title: 'not an agent', which: '   ' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const root = resolveTrees(repo, env).projectPublic as string;
      const created = creationsIn(root).find((e) => e.subject === result.id);
      expect(created).toBeDefined();
      expect(created?.which).toBeUndefined();
    }
  });

  it('refuses WHO_IS_WHICH when the agent IS the authorizing identity, creating nothing', () => {
    const { repo, env } = setup();
    const { anchor } = runInit({ cwd: repo, env });

    const before = countCreations(repo, env);
    const result = runTask({ cwd: repo, env }, { title: 'self-authorized', which: anchor });
    expect(result).toEqual({
      ok: false,
      reason: 'REFUSED',
      code: 'WHO_IS_WHICH',
      message: 'the authorizing human and the executing agent must be different identities',
    });
    // Nothing was born, in any tree — the refusal is at the door.
    expect(countCreations(repo, env)).toBe(before);
  });

  /** How many tasks exist across every tree this env can see. */
  function countCreations(repo: string, env: DiscoveryEnv): number {
    const trees = resolveTrees(repo, env);
    return [trees.projectPublic, trees.projectPrivate, trees.global]
      .filter((root): root is string => root !== undefined)
      .reduce((total, root) => total + creationsIn(root).length, 0);
  }
});
