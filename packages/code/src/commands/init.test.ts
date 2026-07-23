import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalogUpcasters, verify } from '@mnema/chain';
import { type DiscoveryEnv, listProjects, orderedEvents } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInit } from './init.js';

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-init-'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** A repo directory and the discovery env pointing at the sandbox. */
function setup(): { repo: string; env: DiscoveryEnv } {
  const repo = join(sandbox, 'repo');
  mkdirSync(repo, { recursive: true });
  return { repo, env: { xdgDataHome: join(sandbox, 'data'), home: join(sandbox, 'home') } };
}

describe('mnema init', () => {
  it('creates .mnema at the exact cwd, founds identity, and registers', () => {
    const { repo, env } = setup();
    const result = runInit({ cwd: repo, env });

    expect(result.created).toBe(true);
    expect(result.root).toBe(join(repo, '.mnema'));
    expect(result.anchor.startsWith('mnid:')).toBe(true);
    // The tree is really there, at the cwd — with its own .gitignore.
    expect(statSync(join(repo, '.mnema')).isDirectory()).toBe(true);
    expect(existsSync(join(repo, '.mnema', '.gitignore'))).toBe(true);
    // Registered in the index.
    expect(listProjects(env).map((p) => p.root)).toEqual([join(repo, '.mnema')]);
  });

  it('is born verifiable: verify is ok and fully signed right after init', () => {
    const { repo, env } = setup();
    const result = runInit({ cwd: repo, env });
    const verdict = verify(result.root);
    expect(verdict.ok).toBe(true);
    expect(verdict.fullySigned).toBe(true);
  });

  it('creates the tree at the EXACT cwd, never walking up to a parent .mnema', () => {
    const { repo, env } = setup();
    runInit({ cwd: repo, env });
    const sub = join(repo, 'packages', 'inner');
    mkdirSync(sub, { recursive: true });
    const result = runInit({ cwd: sub, env });
    // A fresh tree at the subdir, not a reuse of the parent's.
    expect(result.created).toBe(true);
    expect(result.root).toBe(join(sub, '.mnema'));
  });

  it('refuses to re-found on a second init, but keeps the index entry', () => {
    const { repo, env } = setup();
    const first = runInit({ cwd: repo, env });
    const before = orderedEvents({ root: first.root }, catalogUpcasters()).length;

    const second = runInit({ cwd: repo, env });
    expect(second.created).toBe(false);
    expect(second.root).toBe(first.root);
    expect(second.anchor).toBe(first.anchor);
    // No second founding — the chain is untouched.
    expect(orderedEvents({ root: second.root }, catalogUpcasters()).length).toBe(before);
    // The index still carries the project exactly once.
    expect(listProjects(env).map((p) => p.root)).toEqual([first.root]);
  });

  it('re-registers a project whose index entry was lost, without re-founding', () => {
    const { repo, env } = setup();
    const first = runInit({ cwd: repo, env });
    const before = orderedEvents({ root: first.root }, catalogUpcasters()).length;
    // Simulate a lost cache: the tree stays, the index is wiped.
    rmSync(join(sandbox, 'data'), { recursive: true, force: true });
    expect(listProjects(env)).toEqual([]);

    const second = runInit({ cwd: repo, env });
    expect(second.created).toBe(false);
    expect(listProjects(env).map((p) => p.root)).toEqual([first.root]);
    expect(orderedEvents({ root: second.root }, catalogUpcasters()).length).toBe(before);
  });
});
