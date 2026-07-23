import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalogUpcasters, openChainForWriting } from '@mnema/chain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { projectKnowledge } from '../projections/knowledge.js';
import { orderedEvents } from '../projections/order.js';
import { type ResolvedTrees, resolveTrees } from '../topology/resolve.js';
import {
  chainRootForScope,
  openTreeForWriting,
  resolveScope,
  type Scope,
} from '../topology/routing.js';
import type { WriteContext } from '../workflow/operations.js';
import { captureMemory } from './operations.js';

const upcasters = catalogUpcasters();

describe('captureMemory — the operation', () => {
  let chainRoot: string;

  beforeEach(() => {
    chainRoot = mkdtempSync(join(tmpdir(), 'mnema-capture-'));
  });

  afterEach(() => {
    rmSync(chainRoot, { recursive: true, force: true });
  });

  // A minimal single-tree writer (keyRoot == chainRoot) for the unit-level
  // assertions that do not need the three-tree topology.
  function ctxFor(root: string): WriteContext {
    const writer = openChainForWriting(root, { keyRoot: root });
    return { writer, layout: { root }, upcasters };
  }

  it('mints the memory id — the caller never supplies it', () => {
    const ctx = ctxFor(chainRoot);
    const a = captureMemory(ctx, { content: 'first' });
    const b = captureMemory(ctx, { content: 'second' });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    // Two captures, two DISTINCT minted ids (v7: timestamp + randomness).
    expect(a.id).not.toBe(b.id);
    // A v7 UUID shape: 8-4-4-4-12 hex with version nibble 7.
    expect(a.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('appends exactly ONE event — a point-in-time fact, no birth pair, no state', () => {
    const ctx = ctxFor(chainRoot);
    const captured = captureMemory(ctx, { content: 'a lone fact' });
    if (!captured.ok) throw new Error('capture failed');

    const events = orderedEvents({ root: chainRoot }, upcasters);
    const memoryEvents = events.filter((e) => e.kind === 'memory.captured');
    expect(memoryEvents).toHaveLength(1);
    // The projection sees the memory with the derived `who`, not a supplied one.
    const memories = projectKnowledge(events);
    const memory = memories.get(captured.id);
    expect(memory?.content).toBe('a lone fact');
    expect(memory?.who).toBe(ctx.writer.anchor);
  });

  it('derives `who` from the writer key, never from the caller', () => {
    const ctx = ctxFor(chainRoot);
    const captured = captureMemory(ctx, { content: 'x', which: 'claude' });
    if (!captured.ok) throw new Error('capture failed');
    const memory = projectKnowledge(orderedEvents({ root: chainRoot }, upcasters)).get(captured.id);
    // `who` is the anchor; `which` (the agent) never becomes the author.
    expect(memory?.who).toBe(ctx.writer.anchor);
    expect(memory?.who).not.toBe('claude');
  });
});

describe('captureMemory — routing across the three trees (PoC)', () => {
  let sandbox: string;
  let trees: ResolvedTrees;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'mnema-capture-route-'));
    mkdirSync(join(sandbox, 'repo', '.mnema'), { recursive: true });
    trees = resolveTrees(join(sandbox, 'repo'), {
      xdgDataHome: join(sandbox, 'data'),
      home: join(sandbox, 'home'),
    });
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  function ctxFor(scope: Scope): { ctx: WriteContext; root: string } {
    const writer = openTreeForWriting(trees, scope);
    const root = chainRootForScope(trees, scope) as string;
    return { ctx: { writer, layout: { root }, upcasters }, root };
  }

  it('routes a public-scoped capture into the public tree and nowhere else', () => {
    const { ctx, root } = ctxFor('public');
    const captured = captureMemory(ctx, { content: 'team-visible' });
    if (!captured.ok) throw new Error('capture failed');

    expect(projectKnowledge(orderedEvents({ root }, upcasters)).has(captured.id)).toBe(true);
    expect(existsSync(join(trees.projectPrivate as string, 'tails'))).toBe(false);
    expect(existsSync(join(trees.global, 'tails'))).toBe(false);
  });

  it('routes an automatic agent capture (a `which`) into the PRIVATE tree', () => {
    const scope = resolveScope({ which: 'agent-x' }); // → 'private'
    const { ctx, root } = ctxFor(scope);
    const captured = captureMemory(ctx, { content: 'auto-note', which: 'agent-x' });
    if (!captured.ok) throw new Error('capture failed');

    expect(root).toBe(trees.projectPrivate);
    expect(projectKnowledge(orderedEvents({ root }, upcasters)).has(captured.id)).toBe(true);
    // The team's public tree stays clean — a private capture never leaks.
    expect(existsSync(join(trees.projectPublic as string, 'tails'))).toBe(false);
  });

  it('routes a global-scoped capture into the global tree (transversal to projects)', () => {
    const { ctx, root } = ctxFor('global');
    const captured = captureMemory(ctx, { content: 'personal knowledge' });
    if (!captured.ok) throw new Error('capture failed');

    expect(root).toBe(trees.global);
    expect(projectKnowledge(orderedEvents({ root }, upcasters)).has(captured.id)).toBe(true);
  });

  it('a private capture does NOT leak into the public tree', () => {
    const priv = ctxFor('private');
    const captured = captureMemory(priv.ctx, { content: 'secret' });
    if (!captured.ok) throw new Error('capture failed');

    // The public tree, read on its own, has no such memory.
    const publicRoot = trees.projectPublic as string;
    const publicMemories = existsSync(join(publicRoot, 'tails'))
      ? projectKnowledge(orderedEvents({ root: publicRoot }, upcasters))
      : new Map();
    expect(publicMemories.has(captured.id)).toBe(false);
  });
});
