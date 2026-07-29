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
import { type ResolvedContext, resolveContext } from '../src/mcp/context.js';

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

/**
 * The second answer: WHICH projects, which the cascade cannot give because it
 * returns at the first one. The rule is deliberately not the cascade's — it does
 * not walk up — and every test here is a case where walking up would put a project
 * in the list that nobody opened, or where two spellings of one project would list
 * it twice.
 *
 * The identities are asserted and not only the count, because a write can now name
 * one of them: a list of the right LENGTH holding the wrong directory would route a
 * fact into a project the caller did not ask for, and count the same either way.
 */
describe('resolveContext — which projects the workspace holds', () => {
  /** The project directories the context names, in order. */
  function dirsOf(ctx: ResolvedContext): string[] {
    return ctx.workspaceProjects.map((project) => project.dir);
  }

  /** Makes `<parent>/<name>` with no `.mnema/` of its own, returns its path. */
  function makeFolder(parent: string, name: string): string {
    const dir = join(parent, name);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  it('names the projects among the roots, in order, and lands on the first', () => {
    const a = makeProject('a');
    const b = makeProject('b');
    const c = makeProject('c');
    const ctx = resolveContext({
      roots: [a, b, c].map((p) => pathToFileURL(p).href),
      env,
    });
    expect(ctx.project).toBe(a);
    expect(dirsOf(ctx)).toEqual([a, b, c]);
  });

  it('does NOT inflate for a folder that merely SITS INSIDE another project', () => {
    // The case the root rule exists for. A notes directory checked out inside
    // another repository resolves — by walk-up — to that repository, so listing
    // "roots that resolve" would name two projects for a workspace holding one
    // project and one folder. The session lands on `app`; `legacy` is not a project
    // this workspace opened, it is a repository something else happens to sit in —
    // and listing it would offer a write a destination nobody opened.
    const app = makeProject('app');
    const legacy = makeProject('legacy');
    const notes = makeFolder(legacy, 'notes');

    const ctx = resolveContext({
      roots: [pathToFileURL(app).href, pathToFileURL(notes).href],
      env,
    });
    expect(ctx.project).toBe(app);
    expect(dirsOf(ctx)).toEqual([app]);
  });

  it('names a project the roots reach only by walking up — the one it landed on', () => {
    // The same shape with nothing else beside it, and now the walk-up IS the
    // session: it is writing into `legacy`, so a list that left it out would say
    // "no projects" about a connection that has one. Both cases obey the same rule
    // — a root is a project of its own only when it is one — and the project the
    // session resolved to is in the list because that is where its writes land.
    const legacy = makeProject('legacy');
    const notes = makeFolder(legacy, 'notes');

    const ctx = resolveContext({ roots: [pathToFileURL(notes).href], env });
    expect(ctx.project).toBe(legacy);
    expect(dirsOf(ctx)).toEqual([legacy]);
  });

  it('names the project it landed on AND the one a root announced, when they differ', () => {
    // The case that makes the list worth reporting. The host announced a folder
    // inside `legacy` first, so the walk-up puts the session in `legacy` — and it
    // also announced `app`, a project of its own. The name alone would say "you are
    // in legacy" and leave the reader to guess whether anything else was on offer;
    // with the list, the reader can tell that landing in `legacy` was a choice the
    // cascade made, and a write can say it belongs in `app` instead.
    const legacy = makeProject('legacy');
    const notes = makeFolder(legacy, 'notes');
    const app = makeProject('app');

    const ctx = resolveContext({
      roots: [pathToFileURL(notes).href, pathToFileURL(app).href],
      env,
    });
    expect(ctx.project).toBe(legacy);
    // `app` is the announced one, `legacy` the one the walk-up reached: the order is
    // the host's, and the project the session landed on comes last when no root named it.
    expect(dirsOf(ctx)).toEqual([app, legacy]);
  });

  it('names two roots of ONE project once', () => {
    // The monorepo shape: a host with two packages open announces two roots, and
    // both resolve to the same `.mnema/`. One project, whatever the host opened.
    const mono = makeProject('mono');
    const one = makeFolder(mono, 'packages/one');
    const two = makeFolder(mono, 'packages/two');

    const ctx = resolveContext({
      roots: [one, two].map((p) => pathToFileURL(p).href),
      env,
    });
    expect(ctx.project).toBe(mono);
    expect(dirsOf(ctx)).toEqual([mono]);
  });

  it('names the same root announced twice, and with a trailing slash, once', () => {
    const project = makeProject('twice');
    const ctx = resolveContext({
      roots: [pathToFileURL(project).href, `${pathToFileURL(project).href}/`],
      env,
    });
    expect(dirsOf(ctx)).toEqual([project]);
  });

  it('names a configured project that no root announced', () => {
    // The operator named a project directly. It is not among the roots — there are
    // none — and it is still the project this session works in.
    const project = makeProject('configured');
    const ctx = resolveContext({ configProject: project, roots: [], env });
    expect(ctx.project).toBe(project);
    expect(dirsOf(ctx)).toEqual([project]);
  });

  it('names the projects a configured path did not win over', () => {
    // Both are real: the operator pointed at one, and the workspace holds another.
    // The session works in the configured one and knows of two.
    const configured = makeProject('configured');
    const opened = makeProject('opened');
    const ctx = resolveContext({
      configProject: configured,
      roots: [pathToFileURL(opened).href],
      env,
    });
    expect(ctx.project).toBe(configured);
    expect(dirsOf(ctx)).toEqual([opened, configured]);
  });

  it('is empty when the workspace holds no project at all', () => {
    const plain = makeFolder(sandbox, 'plain');
    const ctx = resolveContext({ roots: [pathToFileURL(plain).href], env });
    expect(ctx.inProject).toBe(false);
    expect(dirsOf(ctx)).toEqual([]);
  });

  it('is empty with no roots at all', () => {
    expect(resolveContext({ env }).workspaceProjects).toEqual([]);
  });
});
