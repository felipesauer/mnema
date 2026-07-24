import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalogUpcasters, verify } from '@mnema/chain';
import { type DiscoveryEnv, orderedEvents, projectObservations, resolveTrees } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInit } from './init.js';
import { runObserve } from './observe.js';

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-observe-'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function setup(): { repo: string; env: DiscoveryEnv } {
  const repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  return { repo, env: { xdgDataHome: join(sandbox, 'data'), home: join(sandbox, 'home') } };
}

/** Reads the observations projected from a tree root. */
function observationsOf(root: string) {
  return projectObservations(orderedEvents({ root }, catalogUpcasters()));
}

describe('mnema observe', () => {
  it('records an observation about an entity, returning its OWN minted id', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });

    const result = runObserve(
      { cwd: repo, env },
      { about: 'some-task-id', topic: 'perf', text: 'this query is O(n^2)' },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      // The observation carries its OWN id, not the observed entity's.
      expect(result.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(result.id).not.toBe('some-task-id');
      const root = resolveTrees(repo, env).projectPublic as string;
      const o = observationsOf(root).get(result.id);
      expect(o?.about).toBe('some-task-id');
      expect(o?.topic).toBe('perf');
      expect(o?.text).toBe('this query is O(n^2)');
    }
  });

  it('does NOT validate the `about` reference: a dangling id is accepted, not refused', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    // No such entity exists anywhere — the observation is still recorded.
    const result = runObserve(
      { cwd: repo, env },
      { about: '00000000-0000-7000-8000-000000000000', topic: 't', text: 'about a ghost' },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const root = resolveTrees(repo, env).projectPublic as string;
      expect(observationsOf(root).get(result.id)?.about).toBe(
        '00000000-0000-7000-8000-000000000000',
      );
    }
  });

  it('two observations about the same entity are distinct rows, never colliding', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const first = runObserve({ cwd: repo, env }, { about: 'x', topic: 'a', text: 'first' });
    const second = runObserve({ cwd: repo, env }, { about: 'x', topic: 'b', text: 'second' });
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.id).not.toBe(second.id);
      const root = resolveTrees(repo, env).projectPublic as string;
      const obs = observationsOf(root);
      expect(obs.get(first.id)?.text).toBe('first');
      expect(obs.get(second.id)?.text).toBe('second');
    }
  });

  it('leaves the tree fully signed after recording an observation', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    runObserve({ cwd: repo, env }, { about: 'x', topic: 't', text: 'obs' });
    const root = resolveTrees(repo, env).projectPublic as string;
    const verdict = verify(root);
    expect(verdict.ok).toBe(true);
    expect(verdict.fullySigned).toBe(true);
  });

  it('refuses with NO_PROJECT when there is no project here', () => {
    const { repo, env } = setup();
    const orphan = join(repo, 'nowhere');
    mkdirSync(orphan, { recursive: true });
    const result = runObserve({ cwd: orphan, env }, { about: 'x', topic: 't', text: 'obs' });
    expect(result).toEqual({ ok: false, reason: 'NO_PROJECT' });
  });

  it('--scope private is honored: the observation is born in the private tree', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const result = runObserve(
      { cwd: repo, env },
      { about: 'x', topic: 't', text: 'private note', scope: 'private' },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const trees = resolveTrees(repo, env);
      expect(observationsOf(trees.projectPrivate as string).has(result.id)).toBe(true);
      expect(observationsOf(trees.projectPublic as string).has(result.id)).toBe(false);
    }
  });

  it('--scope public with no project refuses NO_PROJECT', () => {
    const { repo, env } = setup();
    const orphan = join(repo, 'nowhere');
    mkdirSync(orphan, { recursive: true });
    const result = runObserve(
      { cwd: orphan, env },
      { about: 'x', topic: 't', text: 'obs', scope: 'public' },
    );
    expect(result).toEqual({ ok: false, reason: 'NO_PROJECT' });
  });
});
