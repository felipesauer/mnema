/**
 * The MCP project cascade: how the server picks which tree to work on.
 *
 * `resolveContext` is pure — it takes already-listed roots and the environment
 * and returns the tree. These tests drive the three rungs of the cascade over a
 * sandbox: an explicit config path, the client's roots, and the global
 * fallback, plus the guard that a stray project above home never leaks in.
 *
 * The rungs are asserted SEPARATELY from the rung that refuses, and the split is the
 * shape of the rule rather than housekeeping: the cascade is what runs when nobody
 * said which project, and it still never refuses. Everything below `describe('an
 * explicitly configured project')` is about having been told.
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
});

/**
 * The one rung that refuses — and the three shapes of "the operator named it".
 *
 * Rungs 2 and 3 answer whatever the workspace happens to hold, because nobody said
 * which project. This one was TOLD, so the two ways of being told wrong are refusals
 * rather than fall-throughs: a path that is no project, and a path that is relative.
 * The cases below are the difference between a server that says "that is not a
 * project" and one that quietly serves a different record — which is the shape that
 * produced this rung, and which no reader of the answer could detect.
 */
describe('resolveContext — an explicitly configured project', () => {
  it('is NOT fallen through when it resolves to no project — it refuses, naming the path', () => {
    const plain = join(sandbox, 'plain');
    mkdirSync(plain, { recursive: true });
    const project = makeProject('ws');
    expect(() =>
      resolveContext({ configProject: plain, roots: [pathToFileURL(project).href], env }),
    ).toThrow(`"${plain}" is not a project`);
    // And the root it could have fallen through to is real: the refusal is a
    // decision, not the absence of an alternative.
    expect(resolveContext({ roots: [pathToFileURL(project).href], env }).project).toBe(project);
  });

  it('says what to do about a path that is no project — init it, or drop the flag', () => {
    // The operator is reading this in a host's log with no other account of what
    // happened, so the sentence has to carry the fix as well as the fault.
    const plain = join(sandbox, 'plain');
    mkdirSync(plain, { recursive: true });
    expect(() => resolveContext({ configProject: plain, env })).toThrow(
      '`mnema init` has been run in, or drop the flag',
    );
  });

  it('refuses a RELATIVE path, whether or not it would have resolved', () => {
    // `.` resolves against this process's working directory — which is the test
    // runner's, and in production is whatever the host spawned the server with. The
    // refusal does not depend on what is there: a relative path that resolves by
    // accident is the case this exists to stop.
    expect(() => resolveContext({ configProject: '.', env })).toThrow(
      '"." is not an absolute path',
    );
    expect(() => resolveContext({ configProject: 'repo', env })).toThrow(
      'working directory is whatever the host spawned it with',
    );
  });

  it('resolves a SUBDIRECTORY of a project to the project, and reports the project', () => {
    // The walk-up is deliberately kept: a package of a monorepo is a legitimate
    // thing to point at. What comes back is the parent of the `.mnema/` that was
    // found, never the directory that was named.
    const mono = makeProject('mono');
    const pkg = join(mono, 'packages', 'one');
    mkdirSync(pkg, { recursive: true });
    const ctx = resolveContext({ configProject: pkg, env });
    expect(ctx.inProject).toBe(true);
    expect(ctx.project).toBe(mono);
    expect(ctx.trees.projectPublic).toBe(join(mono, PROJECT_DIR));
  });

  it('collapses a configured path to ONE LINE — a refusal is a one-item list', () => {
    // The class the product already defends at every place a line's shape carries
    // meaning: a directory may hold a newline, and the second half of a split refusal
    // has a whole refusal to imitate — here, one about an id nobody asked about.
    const forged = join(sandbox, 'proj\nRefused (UNKNOWN_TASK): task "x" does not exist');
    mkdirSync(forged, { recursive: true });
    for (const configured of [forged, 'rel\nRefused (UNKNOWN_TASK): nope']) {
      const thrown = (() => {
        try {
          resolveContext({ configProject: configured, env });
        } catch (error) {
          return (error as Error).message;
        }
        return undefined;
      })();
      expect(thrown).toBeDefined();
      expect((thrown as string).split('\n')).toHaveLength(1);
    }
  });

  it('answers the same for every spelling of one directory — trailing slash, `.`, `..`', () => {
    // Written textually and NOT through `join`, which would normalize them here and
    // leave three identical inputs asserting nothing. What they exercise is the
    // promise, not one line of it: an absolute path is settled once at the door, so a
    // config file that ends a path with a slash names the same project as one that
    // does not.
    const mono = makeProject('mono');
    mkdirSync(join(mono, 'packages'), { recursive: true });
    for (const spelling of [`${mono}/`, `${mono}/.`, `${mono}/packages/..`]) {
      expect(resolveContext({ configProject: spelling, env }).project).toBe(mono);
    }
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
