import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ChainLayout, catalogUpcasters } from '@mnema/chain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { orderedEvents } from '../projections/order.js';
import { projectTasks } from '../projections/task.js';
import { createTask, type WriteContext } from '../workflow/operations.js';
import { type ResolvedTrees, resolveTrees } from './resolve.js';
import {
  chainRootForScope,
  openTreeForWriting,
  resolveScope,
  type Scope,
  TreeUnavailableError,
} from './routing.js';

const upcasters = catalogUpcasters();

describe('resolveScope — the L4 default-by-origin cascade', () => {
  it('defaults a deliberate human capture (no `which`) to public', () => {
    expect(resolveScope({})).toBe('public');
    expect(resolveScope({ which: undefined })).toBe('public');
  });

  it('defaults an automatic agent capture (a `which` is present) to private', () => {
    expect(resolveScope({ which: 'agent-x' })).toBe('private');
  });

  it('lets an explicit override win over the origin default, both ways', () => {
    expect(resolveScope({ which: 'agent-x' }, 'public')).toBe('public');
    expect(resolveScope({}, 'private')).toBe('private');
    expect(resolveScope({}, 'global')).toBe('global');
  });
});

describe('chainRootForScope', () => {
  const trees: ResolvedTrees = {
    projectPublic: '/repo/.mnema',
    projectPrivate: '/repo/.mnema/private',
    global: '/data/mnema/global',
    keyRoot: '/data/mnema/identity',
  };

  it('maps each scope to its tree', () => {
    expect(chainRootForScope(trees, 'public')).toBe('/repo/.mnema');
    expect(chainRootForScope(trees, 'private')).toBe('/repo/.mnema/private');
    expect(chainRootForScope(trees, 'global')).toBe('/data/mnema/global');
  });

  it('returns undefined for a project scope outside a project', () => {
    const noProject: ResolvedTrees = { global: '/data/g', keyRoot: '/data/i' };
    expect(chainRootForScope(noProject, 'public')).toBeUndefined();
    expect(chainRootForScope(noProject, 'private')).toBeUndefined();
    expect(chainRootForScope(noProject, 'global')).toBe('/data/g');
  });
});

describe('openTreeForWriting — routing a write to the right tree', () => {
  let sandbox: string;
  let trees: ResolvedTrees;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'mnema-route-'));
    // A project at sandbox/repo, XDG global under sandbox/data.
    mkdirSync(join(sandbox, 'repo', '.mnema'), { recursive: true });
    trees = resolveTrees(join(sandbox, 'repo'), {
      xdgDataHome: join(sandbox, 'data'),
      home: join(sandbox, 'home'),
    });
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  /** A write context over the writer for `scope`, reading from the same root. */
  function contextFor(scope: Scope): { ctx: WriteContext; root: string } {
    const writer = openTreeForWriting(trees, scope);
    const root = chainRootForScope(trees, scope) as string;
    const layout: ChainLayout = { root };
    return { ctx: { writer, layout, upcasters }, root };
  }

  it('writes a public-scoped task into the public tree and nowhere else', () => {
    const { ctx, root } = contextFor('public');
    const created = createTask(ctx, { title: 'work item' });
    if (!created.ok) throw new Error('create failed');

    // The task is in the public tree...
    expect(projectTasks(orderedEvents({ root }, upcasters)).has(created.id)).toBe(true);
    // ...and the private/global trees have no tails at all.
    expect(existsSync(join(trees.projectPrivate as string, 'tails'))).toBe(false);
    expect(existsSync(join(trees.global, 'tails'))).toBe(false);
  });

  it('routes an automatic agent capture (private default) into the private tree', () => {
    const scope = resolveScope({ which: 'agent-x' }); // → 'private'
    const { ctx, root } = contextFor(scope);
    const created = createTask(ctx, { title: 'auto', which: 'agent-x' });
    if (!created.ok) throw new Error('create failed');

    expect(root).toBe(trees.projectPrivate);
    expect(projectTasks(orderedEvents({ root }, upcasters)).has(created.id)).toBe(true);
    // The team's public tree stays clean.
    expect(existsSync(join(trees.projectPublic as string, 'tails'))).toBe(false);
  });

  it('signs every tree with the ONE key root (referenced, never copied)', () => {
    // Writing to two different trees must not put a private key in either chain.
    openTreeForWriting(trees, 'public');
    openTreeForWriting(trees, 'global');
    const noPrivateKeyIn = (root: string): boolean => {
      const keysDir = join(root, 'keys');
      if (!existsSync(keysDir)) return true;
      return !readdirSync(keysDir).some((f) => f.endsWith('.key'));
    };
    expect(noPrivateKeyIn(trees.projectPublic as string)).toBe(true);
    expect(noPrivateKeyIn(trees.global)).toBe(true);
    // The private key lives in the key root, once.
    expect(existsSync(join(trees.keyRoot, 'keys'))).toBe(true);
    expect(readdirSync(join(trees.keyRoot, 'keys')).some((f) => f.endsWith('.key'))).toBe(true);
  });

  it('throws when a project scope is used outside a project', () => {
    const noProject = resolveTrees(join(sandbox, 'elsewhere'), {
      xdgDataHome: join(sandbox, 'data'),
      home: join(sandbox, 'home'),
    });
    expect(() => openTreeForWriting(noProject, 'public')).toThrow(TreeUnavailableError);
    // The global scope still works with no project.
    expect(() => openTreeForWriting(noProject, 'global')).not.toThrow();
  });
});

describe('openTreeForWriting — .gitignore protects private/ before any public write', () => {
  let sandbox: string;
  let trees: ResolvedTrees;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'mnema-hyg-'));
    mkdirSync(join(sandbox, 'repo', '.mnema'), { recursive: true });
    trees = resolveTrees(join(sandbox, 'repo'), {
      xdgDataHome: join(sandbox, 'data'),
      home: join(sandbox, 'home'),
    });
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  it('a FIRST write that is PRIVATE still creates the public .gitignore hiding private/', () => {
    // The gap this closes: an early private capture must not leave private/
    // unprotected until some later public write happens to write the .gitignore.
    openTreeForWriting(trees, 'private');
    const ignore = join(trees.projectPublic as string, '.gitignore');
    expect(existsSync(ignore)).toBe(true);
  });

  it('NEUTRALIZATION — without the .gitignore, private/ would sit unignored in the public tree', () => {
    // Prove the guard matters: the private tree is a subdirectory of the public
    // tree, so absent the ignore rule its tails would be tracked by the project.
    // (We assert the geometry that makes the guard necessary, then that the guard
    // is present.)
    expect((trees.projectPrivate as string).startsWith(trees.projectPublic as string)).toBe(true);
    openTreeForWriting(trees, 'private');
    // With the guard, the ignore rule for the subtree exists.
    const ignore = join(trees.projectPublic as string, '.gitignore');
    expect(existsSync(ignore)).toBe(true);
  });
});
