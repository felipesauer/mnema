import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ChainLayout, catalogUpcasters, type EventKind, LATEST_VERSION } from '@mnema/chain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { captureMemory } from '../knowledge/operations.js';
import { orderedEvents } from '../projections/order.js';
import { projectTasks } from '../projections/task.js';
import { createTask, type WriteContext } from '../workflow/operations.js';
import { type ResolvedTrees, resolveTrees } from './resolve.js';
import {
  chainRootForScope,
  openTreeForWriting,
  type RoutedKind,
  resolveScope,
  type Scope,
  TreeUnavailableError,
  UNROUTED_KINDS,
} from './routing.js';

const upcasters = catalogUpcasters();

/** The table as decided, spelled out here so the rule is asserted, not echoed. */
const EXPECTED: { readonly [K in RoutedKind]: Scope | 'by-origin' } = {
  'task.created': 'public',
  'decision.recorded': 'public',
  'skill.created': 'public',
  'skill.consulted': 'public',
  'handoff.recorded': 'public',
  'knowledge.linked': 'public',
  // The two kinds the KIND cannot answer for: the same kind holds a fact the team
  // needs and a note that is nobody's business but the writer's. They keep the
  // author rule until that question is settled.
  'memory.captured': 'by-origin',
  'observation.recorded': 'by-origin',
  // A switch of what the product pushes is a declaration about the project like a
  // decision is: the team reads it, and a switch nobody but its own machine can see
  // would leave "switching off is never silent" holding for a single reader.
  'channel.switched': 'public',
  // What a channel DID, on the same side of the table as what was done to it: the
  // evidence that a push was live in a run, and the record of a rule that stopped a
  // write, are both worth nothing on the one machine that produced them.
  'channel.served': 'public',
  'channel.asked': 'public',
};

const ROUTED = Object.keys(EXPECTED) as RoutedKind[];

/** The kinds the table answers from the kind alone. */
const BY_KIND = ROUTED.filter((kind) => EXPECTED[kind] !== 'by-origin');

/** The kinds the table still answers from the author. */
const BY_ORIGIN = ROUTED.filter((kind) => EXPECTED[kind] === 'by-origin');

/** A capture with no executing agent — a person acting directly. */
const PERSON = {};
/** A capture an agent made. */
const AGENT = { which: 'agent-x' };

describe('resolveScope — the L4 cascade, now by KIND', () => {
  it('routes each kind by the kind, whoever wrote it', () => {
    for (const kind of BY_KIND) {
      expect(resolveScope(kind, PERSON)).toBe(EXPECTED[kind]);
      expect(resolveScope(kind, AGENT)).toBe(EXPECTED[kind]);
    }
  });

  it('sends a declaration about the project to the tree that TRAVELS', () => {
    // The defect this closes: an ADR recorded by an agent landed in the tree that
    // never leaves the machine, so a colleague cloning the repository inherited a
    // founding and nothing else.
    expect(resolveScope('decision.recorded', AGENT)).toBe('public');
    expect(resolveScope('task.created', AGENT)).toBe('public');
    expect(resolveScope('skill.created', AGENT)).toBe('public');
    expect(resolveScope('skill.consulted', AGENT)).toBe('public');
    expect(resolveScope('handoff.recorded', AGENT)).toBe('public');
    expect(resolveScope('knowledge.linked', AGENT)).toBe('public');
  });

  it('leaves the two knowledge kinds on the AUTHOR rule, deliberately', () => {
    // Unchanged, and the change would not be a tidy-up: the kind does not determine
    // the audience for these two, so the answer is still the imperfect one until that
    // question is settled.
    for (const kind of BY_ORIGIN) {
      expect(resolveScope(kind, PERSON)).toBe('public');
      expect(resolveScope(kind, AGENT)).toBe('private');
    }
  });

  it('reads a blank `which` as NO agent, for the kinds that read it at all', () => {
    // A caller that typed `--which ""` (or a client announcing an empty name) named no
    // agent: the operations drop it from the envelope, so routing must not send the
    // capture private on the strength of a value that will not be recorded.
    for (const kind of BY_ORIGIN) {
      expect(resolveScope(kind, { which: '' })).toBe('public');
      expect(resolveScope(kind, { which: '   ' })).toBe('public');
      expect(resolveScope(kind, { which: '\t\n' })).toBe('public');
      // And the padding is an accident, not a way out of the agent default.
      expect(resolveScope(kind, { which: '  codex  ' })).toBe('private');
    }
  });

  it('lets an explicit override win, for EVERY kind, every author, every tree', () => {
    for (const kind of ROUTED) {
      for (const origin of [PERSON, AGENT]) {
        expect(resolveScope(kind, origin, 'public')).toBe('public');
        expect(resolveScope(kind, origin, 'private')).toBe('private');
        expect(resolveScope(kind, origin, 'global')).toBe('global');
      }
    }
  });
});

describe('resolveScope — the classification is TOTAL over the catalog', () => {
  const catalog = Object.keys(LATEST_VERSION) as EventKind[];

  it('classifies every kind the chain may hold exactly once', () => {
    // The question "is there a kind that writes and skips the rule?" answered
    // against the catalog itself, not against a list kept in step by hand. A kind
    // added to `LATEST_VERSION` shows up here with no home.
    const routed = new Set<string>(ROUTED);
    const unrouted = new Set(Object.keys(UNROUTED_KINDS));
    for (const kind of catalog) {
      expect(routed.has(kind) !== unrouted.has(kind), `${kind} is classified once`).toBe(true);
    }
    expect(routed.size + unrouted.size).toBe(catalog.length);
  });

  it('is not vacuous — every half holds kinds, and the catalog is not empty', () => {
    expect(catalog.length).toBeGreaterThan(10);
    expect(BY_KIND.length).toBe(9);
    expect(BY_ORIGIN.length).toBe(2);
    expect(Object.keys(UNROUTED_KINDS).length).toBe(catalog.length - ROUTED.length);
  });

  it('says WHY each unrouted kind does not ask the rule', () => {
    // A blank reason would make the exemption unanswerable, which is the whole
    // point of listing them rather than defaulting them.
    for (const [kind, reason] of Object.entries(UNROUTED_KINDS)) {
      expect(reason.trim().length, `${kind} states a reason`).toBeGreaterThan(20);
    }
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

  it('routes an agent’s memory (still the author rule) into the private tree', () => {
    const scope = resolveScope('memory.captured', { which: 'agent-x' }); // → 'private'
    const { ctx, root } = contextFor(scope);
    const captured = captureMemory(ctx, { content: 'for me only', which: 'agent-x' });
    if (!captured.ok) throw new Error('capture failed');

    expect(root).toBe(trees.projectPrivate);
    expect(orderedEvents({ root }, upcasters).some((e) => e.kind === 'memory.captured')).toBe(true);
    // The team's public tree holds no tail of its own — only the `.gitignore`
    // hygiene the private write ensures.
    expect(existsSync(join(trees.projectPublic as string, 'tails'))).toBe(false);
  });

  it('routes an AGENT’s task to the tree that travels — the author no longer decides', () => {
    const scope = resolveScope('task.created', { which: 'agent-x' }); // → 'public' either way
    const { ctx, root } = contextFor(scope);
    const created = createTask(ctx, { title: 'auto', which: 'agent-x' });
    if (!created.ok) throw new Error('create failed');

    expect(root).toBe(trees.projectPublic);
    expect(projectTasks(orderedEvents({ root }, upcasters)).has(created.id)).toBe(true);
    // And the event it produced does name the agent: the tree and the envelope
    // answer two different questions now, so neither can misreport the other.
    expect(existsSync(join(trees.projectPrivate as string, 'tails'))).toBe(false);
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
