/**
 * The MCP project cascade: how the server picks which tree to work on.
 *
 * `resolveContext` is pure — it takes already-listed roots and the environment
 * and returns the tree. These tests drive the three rungs of the cascade over a
 * sandbox: an explicit config path, the client's roots, and the global
 * fallback, plus the guard that a stray project above home never leaks in.
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ensureTree } from '@mnema/chain';
import { type DiscoveryEnv, PROJECT_DIR } from '@mnema/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveContext } from '../src/mcp/context.js';

let sandbox: string;
let env: DiscoveryEnv;

/** Makes a directory that IS a project (has a `.mnema/` tree), returns its path. */
function makeProject(name: string): string {
  const dir = join(sandbox, name);
  mkdirSync(dir, { recursive: true });
  ensureTree({ root: join(dir, PROJECT_DIR) });
  return dir;
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-mcp-ctx-'));
  // home is a plain, project-free directory so the global fallback is clean.
  const home = join(sandbox, 'home');
  mkdirSync(home, { recursive: true });
  env = { home, xdgDataHome: join(sandbox, 'data') };
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe('resolveContext — the project cascade', () => {
  it('rung 1: an explicit config project wins', () => {
    const project = makeProject('explicit');
    const ctx = resolveContext({ configProject: project, roots: [], env });
    expect(ctx.inProject).toBe(true);
    expect(ctx.trees.projectPublic).toBe(join(project, PROJECT_DIR));
  });

  it('rung 2: the first root that resolves to a project', () => {
    const notAProject = join(sandbox, 'plain');
    mkdirSync(notAProject, { recursive: true });
    const project = makeProject('workspace');
    const ctx = resolveContext({
      roots: [pathToFileURL(notAProject).href, pathToFileURL(project).href],
      env,
    });
    expect(ctx.inProject).toBe(true);
    expect(ctx.trees.projectPublic).toBe(join(project, PROJECT_DIR));
  });

  it('rung 3: no config and no project among the roots falls back to GLOBAL', () => {
    const plain = join(sandbox, 'plain');
    mkdirSync(plain, { recursive: true });
    const ctx = resolveContext({ roots: [pathToFileURL(plain).href], env });
    expect(ctx.inProject).toBe(false);
    expect(ctx.trees.projectPublic).toBeUndefined();
    expect(ctx.trees.global).toContain('global');
  });

  it('rung 3: no roots at all falls back to GLOBAL (never refuses)', () => {
    const ctx = resolveContext({ env });
    expect(ctx.inProject).toBe(false);
    expect(ctx.trees.projectPublic).toBeUndefined();
    expect(ctx.trees.global).toBeDefined();
  });

  it('a non-file root URI is skipped, not resolved', () => {
    const project = makeProject('ws');
    const ctx = resolveContext({
      roots: ['https://example.com/repo', pathToFileURL(project).href],
      env,
    });
    // The http root is skipped; the file root behind it still resolves.
    expect(ctx.inProject).toBe(true);
  });

  it('an explicit config path that is NOT a project does not stick — the cascade continues', () => {
    const plain = join(sandbox, 'plain');
    mkdirSync(plain, { recursive: true });
    const project = makeProject('ws');
    const ctx = resolveContext({
      configProject: plain,
      roots: [pathToFileURL(project).href],
      env,
    });
    // config did not resolve to a project, so the root wins.
    expect(ctx.inProject).toBe(true);
    expect(ctx.trees.projectPublic).toBe(join(project, PROJECT_DIR));
  });
});
