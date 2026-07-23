/**
 * The vertical proof of memory.captured — the four publics of the study, end to
 * end. A capture is routed by scope through the merged tree topology, then:
 *   - the PERSON sees the union of all three trees, each memory attributed to
 *     its `who`;
 *   - the TEAM (the public tree alone) never sees the private or global memory;
 *   - the CLONE (a copy of the tree's directory, with no SQLite cache and no
 *     private key) reconstructs the memory from the events alone and verifies.
 *
 * The clone case is the most demanding: knowledge is an EVENT, recoverable and
 * verifiable, not a cache and not committed markdown. If that holds, a
 * point-in-time fact serves every public.
 */

import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ChainLayout, catalogUpcasters, verify } from '@mnema/chain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { projectKnowledge } from '../projections/knowledge.js';
import { orderedEvents, orderedEventsAcross } from '../projections/order.js';
import { type ResolvedTrees, resolveTrees } from '../topology/resolve.js';
import { chainRootForScope, openTreeForWriting, type Scope } from '../topology/routing.js';
import type { WriteContext } from '../workflow/operations.js';
import { captureMemory } from './operations.js';

const upcasters = catalogUpcasters();

describe('memory.captured — end to end, the four publics', () => {
  let sandbox: string;
  let trees: ResolvedTrees;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'mnema-mem-e2e-'));
    mkdirSync(join(sandbox, 'repo', '.mnema'), { recursive: true });
    trees = resolveTrees(join(sandbox, 'repo'), {
      xdgDataHome: join(sandbox, 'data'),
      home: join(sandbox, 'home'),
    });
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  /** Captures into `scope`'s tree, checkpointing so the tail is fully signed. */
  function captureInto(scope: Scope, content: string): { id: string; root: string } {
    const writer = openTreeForWriting(trees, scope);
    const root = chainRootForScope(trees, scope) as string;
    const ctx: WriteContext = { writer, layout: { root }, upcasters };
    const captured = captureMemory(ctx, { content });
    if (!captured.ok) throw new Error('capture failed');
    // Checkpoint so an anonymous verify sees the tail fully signed (the founding
    // and the fact are both covered by a signature over a recomputable root).
    writer.checkpoint();
    return { id: captured.id, root };
  }

  const layout = (root: string): ChainLayout => ({ root });

  it('P2 — the PERSON sees the union of all three trees, attributed to who', () => {
    const pub = captureInto('public', 'a public note');
    const prv = captureInto('private', 'a private note');
    const glb = captureInto('global', 'a global note');

    const union = orderedEventsAcross(
      [layout(pub.root), layout(prv.root), layout(glb.root)],
      upcasters,
    );
    const memories = projectKnowledge(union);
    expect(memories.size).toBe(3);
    expect(memories.get(pub.id)?.content).toBe('a public note');
    expect(memories.get(prv.id)?.content).toBe('a private note');
    expect(memories.get(glb.id)?.content).toBe('a global note');
    // One identity across the three trees → the same `who` on all.
    const authors = new Set([...memories.values()].map((m) => m.who));
    expect(authors.size).toBe(1);
  });

  it('P3 — the TEAM (public tree only) never sees the private or global memory', () => {
    const pub = captureInto('public', 'team-visible');
    const prv = captureInto('private', 'machine-only');
    const glb = captureInto('global', 'personal');

    const teamView = projectKnowledge(orderedEvents(layout(pub.root), upcasters));
    expect(teamView.has(pub.id)).toBe(true);
    expect(teamView.has(prv.id)).toBe(false);
    expect(teamView.has(glb.id)).toBe(false);
  });

  it('P4 — the CLONE reconstructs the memory from events alone, and verifies', () => {
    const pub = captureInto('public', 'a fact the team pulls');

    // A clone is a copy of the public tree's directory: the events and the
    // materialized PUBLIC key, but no SQLite cache and no private key.
    const clone = mkdtempSync(join(tmpdir(), 'mnema-clone-'));
    try {
      cpSync(pub.root, clone, { recursive: true });

      // Reconstruct the memory from the chain alone — no cache was copied.
      const memories = projectKnowledge(orderedEvents(layout(clone), upcasters));
      expect(memories.get(pub.id)?.content).toBe('a fact the team pulls');

      // And the anonymous verifier accepts the chain: the founding + the fact are
      // signature-covered, and the signer is a key valid for its anchor.
      const verdict = verify(clone);
      expect(verdict.ok).toBe(true);
      expect(verdict.fullySigned).toBe(true);
    } finally {
      rmSync(clone, { recursive: true, force: true });
    }
  });

  it('P4 — the clone has NO private key, proving recovery needs only the public material', () => {
    const pub = captureInto('public', 'recoverable');
    const clone = mkdtempSync(join(tmpdir(), 'mnema-clone-nokey-'));
    try {
      cpSync(pub.root, clone, { recursive: true });
      // The clone verifies with only what the public tree carries. (The private
      // key lives in the key root, which is never part of the public tree.)
      expect(verify(clone).fullySigned).toBe(true);
    } finally {
      rmSync(clone, { recursive: true, force: true });
    }
  });
});
