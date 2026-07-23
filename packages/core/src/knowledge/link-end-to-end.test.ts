/**
 * The vertical proof of knowledge.linked — the first RELATIONAL fact, across the
 * four publics of the study, with the cross-tree case as the crux.
 *
 * A link is written into one tree by a writer that sees only that tree, yet its
 * target may live in another. So the demanding claims are:
 *   - the PERSON, seeing the union of all three trees, resolves a link whose
 *     subject is in one tree and whose target is in another — the relation is
 *     answerable from both directions;
 *   - the link is written WITHOUT refusing the dangling target (the difference
 *     from a supersede), so a private memory can point at a public task;
 *   - the CLONE of the tree that holds the link reconstructs the edge from the
 *     events alone and verifies — even though the target is not in that clone.
 *
 * If a cross-tree link survives reconstruction and verification, the relational
 * fact serves every public exactly as a point-in-time fact does.
 */

import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ChainLayout, catalogUpcasters, verify } from '@mnema/chain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { projectKnowledge, projectLinks } from '../projections/knowledge.js';
import { orderedEvents, orderedEventsAcross } from '../projections/order.js';
import { type ResolvedTrees, resolveTrees } from '../topology/resolve.js';
import { chainRootForScope, openTreeForWriting, type Scope } from '../topology/routing.js';
import type { WriteContext } from '../workflow/operations.js';
import { captureMemory, linkKnowledge } from './operations.js';

const upcasters = catalogUpcasters();

describe('knowledge.linked — end to end, the four publics (cross-tree)', () => {
  let sandbox: string;
  let trees: ResolvedTrees;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'mnema-link-e2e-'));
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

  const layout = (root: string): ChainLayout => ({ root });

  it('P2 — the PERSON resolves a cross-tree link from both directions over the union', () => {
    // A public task-like memory (a stand-in target) lives in the public tree; a
    // private note links to it. The link is written in the PRIVATE tree, whose
    // writer never sees the public target.
    const pub = ctxFor('public');
    const target = captureMemory(pub.ctx, { content: 'the public thing' });
    pub.ctx.writer.checkpoint();

    const prv = ctxFor('private');
    const source = captureMemory(prv.ctx, { content: 'my private note' });
    linkKnowledge(prv.ctx, { subject: source.id, target: target.id, rel: 'relates-to' });
    prv.ctx.writer.checkpoint();

    const union = orderedEventsAcross([layout(pub.root), layout(prv.root)], upcasters);
    const edges = projectLinks(union);
    expect(edges).toHaveLength(1);
    // Answerable from the subject side (the note) and the target side (the thing).
    expect(edges.filter((e) => e.subject === source.id)).toHaveLength(1);
    expect(edges.filter((e) => e.target === target.id)).toHaveLength(1);
    // And both endpoints resolve against the union of memories.
    const memories = projectKnowledge(union);
    expect(memories.has(source.id)).toBe(true);
    expect(memories.has(target.id)).toBe(true);
  });

  it('the link is written WITHOUT refusing the dangling target (unlike a supersede)', () => {
    // The private writer records a link to a target it cannot see. Read on the
    // PRIVATE tree alone, the edge stands but its target is not present — honest
    // dangling, resolved on read against the union, never refused at write.
    const prv = ctxFor('private');
    const source = captureMemory(prv.ctx, { content: 'note pointing outward' });
    const ok = linkKnowledge(prv.ctx, {
      subject: source.id,
      target: 'not-in-this-tree',
      rel: 'relates-to',
    });
    expect(ok.ok).toBe(true);

    const privateView = projectLinks(orderedEvents(layout(prv.root), upcasters));
    expect(privateView).toHaveLength(1);
    expect(privateView[0]?.target).toBe('not-in-this-tree');
    // The target has no memory in this tree — dangling, but the edge is kept.
    expect(
      projectKnowledge(orderedEvents(layout(prv.root), upcasters)).has('not-in-this-tree'),
    ).toBe(false);
  });

  it('P3 — the TEAM (public tree only) never sees the private link', () => {
    const pub = ctxFor('public');
    const target = captureMemory(pub.ctx, { content: 'public target' });
    pub.ctx.writer.checkpoint();

    const prv = ctxFor('private');
    const source = captureMemory(prv.ctx, { content: 'private source' });
    linkKnowledge(prv.ctx, { subject: source.id, target: target.id, rel: 'relates-to' });
    prv.ctx.writer.checkpoint();

    // The public tree carries the target but NOT the link (the link is private).
    const teamLinks = projectLinks(orderedEvents(layout(pub.root), upcasters));
    expect(teamLinks).toHaveLength(0);
  });

  it('P4 — the CLONE of the linking tree reconstructs the edge and verifies', () => {
    const prv = ctxFor('private');
    const source = captureMemory(prv.ctx, { content: 'a note the clone recovers' });
    // Link to a target that will NOT be in the clone — the cross-tree case.
    linkKnowledge(prv.ctx, { subject: source.id, target: 'target-elsewhere', rel: 'derived-from' });
    prv.ctx.writer.checkpoint();

    const clone = mkdtempSync(join(tmpdir(), 'mnema-link-clone-'));
    try {
      cpSync(prv.root, clone, { recursive: true });

      // The edge reconstructs from the events alone — no cache was copied.
      const edges = projectLinks(orderedEvents(layout(clone), upcasters));
      expect(edges).toHaveLength(1);
      expect(edges[0]).toMatchObject({
        subject: source.id,
        target: 'target-elsewhere',
        rel: 'derived-from',
      });

      // And the anonymous verifier accepts the chain: the founding, the memory,
      // and the link are all signature-covered by a key valid for the anchor.
      const verdict = verify(clone);
      expect(verdict.ok).toBe(true);
      expect(verdict.fullySigned).toBe(true);
    } finally {
      rmSync(clone, { recursive: true, force: true });
    }
  });
});
