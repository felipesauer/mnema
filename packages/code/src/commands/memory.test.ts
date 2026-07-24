import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalogUpcasters, verify } from '@mnema/chain';
import { type DiscoveryEnv, orderedEvents, projectKnowledge, resolveTrees } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInit } from './init.js';
import { runMemory } from './memory.js';

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-memory-'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function setup(): { repo: string; env: DiscoveryEnv } {
  const repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  return { repo, env: { xdgDataHome: join(sandbox, 'data'), home: join(sandbox, 'home') } };
}

/** Reads the memories projected from a tree root. */
function memoriesOf(root: string) {
  return projectKnowledge(orderedEvents({ root }, catalogUpcasters()));
}

describe('mnema memory', () => {
  it('captures a memory, returning its minted id', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });

    const result = runMemory({ cwd: repo, env }, { content: 'the auth flow uses PKCE' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // A minted v7 uuid — the canonical id.
      expect(result.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      // It really landed in the public tree with the given content.
      const root = resolveTrees(repo, env).projectPublic as string;
      const m = memoriesOf(root).get(result.id);
      expect(m?.content).toBe('the auth flow uses PKCE');
    }
  });

  it('a CLI capture is a human capture: no `which` is stamped', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const result = runMemory({ cwd: repo, env }, { content: 'a human note' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const root = resolveTrees(repo, env).projectPublic as string;
      const captured = orderedEvents({ root }, catalogUpcasters()).find(
        (e) => e.kind === 'memory.captured' && e.subject === result.id,
      );
      // A deliberate human capture carries no executing agent.
      expect(captured?.which).toBeUndefined();
    }
  });

  it('leaves the tree fully signed after capturing a memory', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    runMemory({ cwd: repo, env }, { content: 'a fact' });
    const root = resolveTrees(repo, env).projectPublic as string;
    const verdict = verify(root);
    expect(verdict.ok).toBe(true);
    expect(verdict.fullySigned).toBe(true);
  });

  it('refuses with NO_PROJECT when there is no project here', () => {
    const { repo, env } = setup();
    const orphan = join(repo, 'nowhere');
    mkdirSync(orphan, { recursive: true });
    const result = runMemory({ cwd: orphan, env }, { content: 'homeless' });
    expect(result).toEqual({ ok: false, reason: 'NO_PROJECT' });
  });

  it('--scope private is honored: the memory is born in the private tree', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const result = runMemory(
      { cwd: repo, env },
      { content: 'this machine only', scope: 'private' },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const trees = resolveTrees(repo, env);
      expect(memoriesOf(trees.projectPrivate as string).has(result.id)).toBe(true);
      expect(memoriesOf(trees.projectPublic as string).has(result.id)).toBe(false);
    }
  });

  it('an omitted scope defaults to public (the provisional default)', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const result = runMemory({ cwd: repo, env }, { content: 'default' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const root = resolveTrees(repo, env).projectPublic as string;
      expect(memoriesOf(root).has(result.id)).toBe(true);
    }
  });

  it('--scope global works with no project (global needs no project)', () => {
    const { repo, env } = setup();
    const orphan = join(repo, 'nowhere');
    mkdirSync(orphan, { recursive: true });
    const result = runMemory({ cwd: orphan, env }, { content: 'cross-project', scope: 'global' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const trees = resolveTrees(orphan, env);
      expect(memoriesOf(trees.global).has(result.id)).toBe(true);
    }
  });

  it('--scope public with no project refuses NO_PROJECT (guard is on the resolved scope)', () => {
    const { repo, env } = setup();
    const orphan = join(repo, 'nowhere');
    mkdirSync(orphan, { recursive: true });
    const result = runMemory({ cwd: orphan, env }, { content: 'no home', scope: 'public' });
    expect(result).toEqual({ ok: false, reason: 'NO_PROJECT' });
  });
});
