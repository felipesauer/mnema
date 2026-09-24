/**
 * The MCP project cascade: how the server picks which tree to work on.
 *
 * `resolveContext` is pure — it takes what the client said about its workspace and
 * the environment, and returns the tree. These tests drive the four rungs of the
 * cascade over a sandbox: an explicit config path, the client's roots, the server's
 * working directory for a client that declared no roots, and the global fallback —
 * plus what the walk every rung climbs passes over: the home directory's `.mnema/` and a
 * machine's data directory, for EVERY rung (the rule is the core's, `whyNoProjectRootAt`).
 *
 * EVERY CALL SAYS WHICH KIND OF CLIENT IT MODELS, `roots` or `cwd`, and that is the
 * shape the working-directory rung forced rather than tidiness. Two tests here used
 * to call the resolver with neither and were named for "no roots at all"; the input
 * could not say whether that meant a window with no folder or a client with no
 * `roots` capability, and after the rung existed the two answer differently. A call
 * with neither now fails outright instead of answering one of them in silence.
 *
 * The rungs are asserted SEPARATELY from the rung that refuses, and the split is the
 * shape of the rule rather than housekeeping: the cascade is what runs when nobody
 * said which project, and it still never refuses. Everything below `describe('an
 * explicitly configured project')` is about having been told.
 */

import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
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
  env = { home };
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

  it('rung 4: no config and no project among the roots falls back to GLOBAL', () => {
    const plain = join(sandbox, 'plain');
    mkdirSync(plain, { recursive: true });
    const ctx = resolveContext({ roots: [pathToFileURL(plain).href], env });
    expect(ctx.inProject).toBe(false);
    expect(ctx.trees.projectPublic).toBeUndefined();
    expect(ctx.trees.global).toContain('global');
  });

  it('rung 4: a client that DECLARED roots and listed none lands on GLOBAL — a window with no folder', () => {
    // THIS WAS "rung 3: no roots at all falls back to GLOBAL", called with no roots and
    // no working directory, and it stood for two clients that now answer differently.
    // This is the one that still lands on the global tree: a client that declared the
    // capability and listed nothing has SAID its workspace holds no folder. The other —
    // a client with no `roots` capability — is the working-directory rung below.
    const ctx = resolveContext({ roots: [], env });
    expect(ctx.inProject).toBe(false);
    expect(ctx.rung).toBe('global');
    expect(ctx.trees.projectPublic).toBeUndefined();
    expect(ctx.trees.global).toBeDefined();
  });

  it('rung 4 carries NO project even when home holds a `.mnema/`', () => {
    // The fallback resolves the global tree from home. THIS CASE USED TO SAY that walk-up
    // "would find one" — home's own `.mnema`, which with `$XDG_DATA_HOME` unset is the
    // machine's data directory — and that its project scopes were dropped here. The walk
    // no longer takes the home's `.mnema/` at all (`whyNoProjectRootAt`, `@mnema/core`);
    // the assertion stands, over a premise that is now the core's.
    mkdirSync(join(env.home, PROJECT_DIR), { recursive: true });
    const plain = join(sandbox, 'plain');
    mkdirSync(plain, { recursive: true });
    const ctx = resolveContext({ roots: [pathToFileURL(plain).href], env });
    expect(ctx.inProject).toBe(false);
    expect(ctx.trees.projectPublic).toBeUndefined();
    expect(ctx.trees.projectPrivate).toBeUndefined();
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

  it('says which rung it landed by — configured, roots, working directory, or none', () => {
    // The field the log line is printed from. Asserted per rung, because a cascade that
    // reported one rung for every landing would still land correctly and would make a
    // project inferred from a working directory read exactly like one a client named.
    const project = makeProject('p');
    const plain = join(sandbox, 'plain');
    mkdirSync(plain, { recursive: true });
    expect(resolveContext({ configProject: project, roots: [], env }).rung).toBe('configured');
    expect(resolveContext({ roots: [pathToFileURL(project).href], env }).rung).toBe('roots');
    expect(resolveContext({ cwd: project, env }).rung).toBe('cwd');
    expect(resolveContext({ cwd: plain, env }).rung).toBe('global');
    expect(resolveContext({ roots: [], env }).rung).toBe('global');
  });
});

/**
 * Rung 3: the server's working directory, for a client that declared no `roots`.
 *
 * The rung exists because a client measured in the field declares no `roots` capability
 * and starts the server in the workspace root, and the cascade used to send every
 * session of it to the machine-global tree — where a note taken in one project came
 * back in the opening of every other. The cases below are the rung's two halves: it
 * finds the project the way the roots rung does, and it never becomes a way to create
 * one or to adopt something that is not one.
 *
 * WHAT IS NOT HERE: the case the rung must NOT fire for — a client that declared `roots`
 * and listed none. That case cannot be written against this function: the working
 * directory exists only on the input for a client that declared nothing
 * (`ClientWorkspace`), so it is asserted where the capability is read, through a real
 * client (`a-client-that-names-no-workspace.test.ts`).
 */
describe('resolveContext — the working directory, for a client that declared no roots', () => {
  it('serves the project the working directory is in', () => {
    const project = makeProject('ws');
    const ctx = resolveContext({ cwd: project, env });
    expect(ctx.inProject).toBe(true);
    expect(ctx.project).toBe(project);
    expect(ctx.trees.projectPublic).toBe(join(project, PROJECT_DIR));
  });

  it('walks UP from it, as the roots rung does from a root', () => {
    // A host started in a package of a monorepo is working in the monorepo.
    const mono = makeProject('mono');
    const pkg = join(mono, 'packages', 'one');
    mkdirSync(pkg, { recursive: true });
    expect(resolveContext({ cwd: pkg, env }).project).toBe(mono);
  });

  it('is never read off the PROCESS — a client that listed no roots stays global inside a project', () => {
    // The type keeps a working directory off the input of a client that declared `roots`,
    // and that is not all of it: the resolver could still reach for this process's own
    // directory. So this runs from INSIDE a project, where a resolver that did would land.
    const project = makeProject('where-the-process-is');
    const before = process.cwd();
    process.chdir(project);
    try {
      const ctx = resolveContext({ roots: [], env });
      expect(ctx.inProject).toBe(false);
      expect(ctx.rung).toBe('global');
    } finally {
      process.chdir(before);
    }
  });

  it('lands on GLOBAL when no project is at or above it — and never refuses', () => {
    const plain = join(sandbox, 'plain');
    mkdirSync(plain, { recursive: true });
    const ctx = resolveContext({ cwd: plain, env });
    expect(ctx.inProject).toBe(false);
    expect(ctx.rung).toBe('global');
    expect(ctx.trees.projectPublic).toBeUndefined();
  });

  it('never CREATES a `.mnema/` — it uses one that is there, and only that', () => {
    // `mnema init` is the only verb that founds a project. A rung that made one at the
    // working directory would found a project in whatever directory a host happens to
    // start a process in.
    const plain = join(sandbox, 'plain');
    mkdirSync(plain, { recursive: true });
    const before = readdirSync(plain);
    resolveContext({ cwd: plain, env });
    expect(existsSync(join(plain, PROJECT_DIR))).toBe(false);
    expect(readdirSync(plain)).toEqual(before);
  });

  it('does not take THIS machine’s data directory for a project', () => {
    // With `$XDG_DATA_HOME` unset the global tree and the key root live in `~/.mnema`,
    // and a directory called `.mnema` is exactly what the walk-up looks for: a workspace
    // under home that was never initialized would resolve to home, a "project" whose
    // committed tree is this machine's private data. The key root is made the way the
    // first `mnema init` on a machine makes it.
    const home = join(sandbox, 'machine-home');
    const unsetXdg: DiscoveryEnv = { home };
    const keyRoot = join(home, PROJECT_DIR, 'identity');
    mkdirSync(join(keyRoot, 'keys'), { recursive: true });
    const workspace = join(home, 'code', 'never-initialized');
    mkdirSync(workspace, { recursive: true });

    const ctx = resolveContext({ cwd: workspace, env: unsetXdg });
    expect(ctx.inProject).toBe(false);
    expect(ctx.rung).toBe('global');
    expect(ctx).not.toHaveProperty('project');
  });

  it('does not take ANOTHER environment’s data directory for one either', () => {
    // `~/.mnema` keeps its key root after `$XDG_DATA_HOME` is set, and a sandboxed
    // environment under a real home finds the real one: the directory is not this
    // environment's data directory, and it is still no project's tree.
    const home = join(sandbox, 'machine-home');
    mkdirSync(join(home, PROJECT_DIR, 'identity', 'keys'), { recursive: true });
    const workspace = join(home, 'code', 'never-initialized');
    mkdirSync(workspace, { recursive: true });
    const elsewhere: DiscoveryEnv = { home };

    expect(resolveContext({ cwd: workspace, env: elsewhere }).inProject).toBe(false);
  });

  it('still serves a real project under such a home — the home is refused as a root, not the folders in it', () => {
    // Non-vacuity for the two above: a home holding a data directory can hold projects,
    // and a rule that refused every walk-up under it would pass both cases by serving
    // nothing. (It was named for "the guard refuses the directory, not the home"; the home
    // itself is now refused as a root too, and what this case holds is unchanged.)
    const home = join(sandbox, 'machine-home');
    mkdirSync(join(home, PROJECT_DIR, 'identity', 'keys'), { recursive: true });
    const app = join(home, 'code', 'app');
    mkdirSync(app, { recursive: true });
    ensureTree({ root: join(app, PROJECT_DIR) });

    expect(resolveContext({ cwd: app, env: { home } }).project).toBe(app);
  });

  it('the ROOTS rung does not take it either — the walk every rung climbs passes it by', () => {
    // THIS CASE WAS "is NOT applied by the roots rung — which still takes that directory
    // for a project", and it pinned a DEFECT: the guard lived in rung 3 alone, so a client
    // that declared `roots` and listed a folder under the home that nobody initialized was
    // served the home as its project, and told its writes were committed with a
    // repository. It was pinned so that the day it closed would be seen; it closed here,
    // by moving the rule into the core's walk, and the case is renamed with the answer so
    // nothing that leaned on the old one can go on passing under the old name.
    const home = join(sandbox, 'machine-home');
    mkdirSync(join(home, PROJECT_DIR, 'identity', 'keys'), { recursive: true });
    const workspace = join(home, 'code', 'never-initialized');
    mkdirSync(workspace, { recursive: true });

    const ctx = resolveContext({ roots: [pathToFileURL(workspace).href], env: { home } });
    expect(ctx.inProject).toBe(false);
    expect(ctx.rung).toBe('global');
    expect(ctx).not.toHaveProperty('project');
  });

  it('nor ANOTHER environment’s data directory — which only the key-root reading reaches', () => {
    // The home rule reaches the data directory of the environment asking; this one is
    // somebody else's — a sandboxed `HOME` whose root sits under a real home, `sudo` — so
    // only the key root inside it says what it is. Asked through the roots rung, because
    // the rule used to be the working-directory rung's alone.
    const theirs = join(sandbox, 'their-home');
    mkdirSync(join(theirs, PROJECT_DIR, 'identity', 'keys'), { recursive: true });
    const workspace = join(theirs, 'code', 'never-initialized');
    mkdirSync(workspace, { recursive: true });

    const ctx = resolveContext({ roots: [pathToFileURL(workspace).href], env });
    expect(ctx.inProject).toBe(false);
    expect(ctx.rung).toBe('global');
    expect(ctx.passedOver).toEqual([{ tree: join(theirs, PROJECT_DIR), why: 'data-directory' }]);
  });

  it('reports what the walks passed over once, however many roots climbed past it', () => {
    // Two folders under one home both climb past its `.mnema/`. The list is what the
    // server's log is written from, and a tree named twice would read as two.
    const home = join(sandbox, 'machine-home');
    mkdirSync(join(home, PROJECT_DIR, 'tails'), { recursive: true });
    const one = join(home, 'a');
    const two = join(home, 'b');
    mkdirSync(one, { recursive: true });
    mkdirSync(two, { recursive: true });
    const roots = [pathToFileURL(one).href, pathToFileURL(two).href];

    const ctx = resolveContext({ roots, env: { home } });
    expect(ctx.passedOver).toEqual([{ tree: join(home, PROJECT_DIR), why: 'home' }]);
    // And nothing at all where the walks met no such tree.
    expect(
      resolveContext({ roots: [pathToFileURL(makeProject('p')).href], env }).passedOver,
    ).toEqual([]);
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

  it('names the `.mnema/` it passed over instead of saying there is none — `--project ~`', () => {
    // The refusal used to say "no `.mnema/` is there or in any directory above it", and on
    // a machine whose home holds one that sentence became false the day the walk learned
    // to pass it by: the server would have denied a directory it had just looked at.
    const home = join(sandbox, 'machine-home');
    mkdirSync(join(home, PROJECT_DIR, 'tails'), { recursive: true });
    const thrown = (() => {
      try {
        resolveContext({ configProject: home, roots: [], env: { home } });
        return '';
      } catch (error) {
        return (error as Error).message;
      }
    })();
    expect(thrown).toContain(`"${home}" is not a project`);
    expect(thrown).toContain(
      `the \`.mnema/\` the walk reached, ${join(home, PROJECT_DIR)}, is passed over`,
    );
    expect(thrown).toContain('the home directory is never a project’s root');
    expect(thrown).not.toContain('no `.mnema/` is there');
  });

  it('says what to do about a path that is no project — init it, or drop the flag', () => {
    // The operator is reading this in a host's log with no other account of what
    // happened, so the sentence has to carry the fix as well as the fault.
    const plain = join(sandbox, 'plain');
    mkdirSync(plain, { recursive: true });
    expect(() => resolveContext({ configProject: plain, roots: [], env })).toThrow(
      '`mnema init` has been run in, or drop the flag',
    );
  });

  it('refuses a RELATIVE path, whether or not it would have resolved', () => {
    // `.` resolves against this process's working directory — which is the test
    // runner's, and in production is whatever the host spawned the server with. The
    // refusal does not depend on what is there: a relative path that resolves by
    // accident is the case this exists to stop.
    expect(() => resolveContext({ configProject: '.', roots: [], env })).toThrow(
      '"." is not an absolute path',
    );
    expect(() => resolveContext({ configProject: 'repo', roots: [], env })).toThrow(
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
    const ctx = resolveContext({ configProject: pkg, roots: [], env });
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
          resolveContext({ configProject: configured, roots: [], env });
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
      expect(resolveContext({ configProject: spelling, roots: [], env }).project).toBe(mono);
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

  it('is empty when the client listed no roots', () => {
    // THIS WAS "is empty with no roots at all", and like the rung-4 case above it stood
    // for two clients. A client that listed none knows of no project; a client with no
    // `roots` capability knows of the one its working directory resolves to (below).
    expect(resolveContext({ roots: [], env }).workspaceProjects).toEqual([]);
  });

  it('names the project the working directory resolved to, for a client that declared no roots', () => {
    // No root announced it — there are none — and it is still where the session writes,
    // which is the rule `landedInProject` applies to a configured path as well.
    const project = makeProject('here');
    expect(dirsOf(resolveContext({ cwd: project, env }))).toEqual([project]);
  });
});
