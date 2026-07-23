import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type DiscoveryEnv, resolveTrees } from './resolve.js';

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-resolve-'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** A home directory inside the sandbox, so the fallback resolves under it. */
function home(): string {
  const h = join(sandbox, 'home');
  mkdirSync(h, { recursive: true });
  return h;
}

describe('resolveTrees — global tree and key root', () => {
  it('uses $XDG_DATA_HOME/mnema when it is a non-empty absolute path', () => {
    const xdg = join(sandbox, 'xdg');
    const env: DiscoveryEnv = { xdgDataHome: xdg, home: home() };
    const trees = resolveTrees(sandbox, env);
    expect(trees.global).toBe(join(xdg, 'mnema', 'global'));
    expect(trees.keyRoot).toBe(join(xdg, 'mnema', 'identity'));
  });

  it('falls back to ~/.mnema when $XDG_DATA_HOME is unset', () => {
    const h = home();
    const trees = resolveTrees(sandbox, { home: h });
    expect(trees.global).toBe(join(h, '.mnema', 'global'));
    expect(trees.keyRoot).toBe(join(h, '.mnema', 'identity'));
  });

  it('treats an empty or relative $XDG_DATA_HOME as unset (spec requires absolute)', () => {
    const h = home();
    for (const xdgDataHome of ['', 'relative/data']) {
      const trees = resolveTrees(sandbox, { xdgDataHome, home: h });
      expect(trees.global).toBe(join(h, '.mnema', 'global'));
    }
  });
});

describe('resolveTrees — project discovery', () => {
  it('finds .mnema in the cwd itself', () => {
    mkdirSync(join(sandbox, '.mnema'), { recursive: true });
    const trees = resolveTrees(sandbox, { home: home() });
    expect(trees.projectPublic).toBe(join(sandbox, '.mnema'));
    expect(trees.projectPrivate).toBe(join(sandbox, '.mnema', 'private'));
  });

  it('finds .mnema by walking up from a deep subdirectory', () => {
    const repo = join(sandbox, 'repo');
    mkdirSync(join(repo, '.mnema'), { recursive: true });
    const deep = join(repo, 'a', 'b', 'c', 'd');
    mkdirSync(deep, { recursive: true });
    const trees = resolveTrees(deep, { home: home() });
    expect(trees.projectPublic).toBe(join(repo, '.mnema'));
    expect(trees.projectPrivate).toBe(join(repo, '.mnema', 'private'));
  });

  it('stops at the NEAREST .mnema when nested projects exist', () => {
    const outer = join(sandbox, 'outer');
    const inner = join(outer, 'inner');
    mkdirSync(join(outer, '.mnema'), { recursive: true });
    mkdirSync(join(inner, '.mnema'), { recursive: true });
    const deep = join(inner, 'x', 'y');
    mkdirSync(deep, { recursive: true });
    const trees = resolveTrees(deep, { home: home() });
    expect(trees.projectPublic).toBe(join(inner, '.mnema'));
  });

  it('has no project trees outside any project', () => {
    const trees = resolveTrees(sandbox, { home: home() });
    expect(trees.projectPublic).toBeUndefined();
    expect(trees.projectPrivate).toBeUndefined();
    // The global tree and key root still resolve — a person can capture with no project.
    expect(trees.global).toBeDefined();
    expect(trees.keyRoot).toBeDefined();
  });

  it('does not treat a .mnema FILE as a project tree', () => {
    // A file named `.mnema` is not a tree; discovery must walk past it.
    writeFileSync(join(sandbox, '.mnema'), 'not a tree', 'utf-8');
    const trees = resolveTrees(sandbox, { home: home() });
    expect(trees.projectPublic).toBeUndefined();
  });
});
