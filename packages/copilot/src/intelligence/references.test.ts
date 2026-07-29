import { rmSync } from 'node:fs';
import type { ProjectionCache, Scope } from '@mnema/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type Bench,
  birthDecision,
  birthTask,
  capture,
  link,
  makeBench,
  observe,
  supersedeDecision,
} from '../../tests/support/chain.js';
import type { ScopedCache } from '../sources.js';
import { effectiveDepth, REFERENCE_MAX_DEPTH, references } from './references.js';

let benches: Bench[] = [];
let caches: ProjectionCache[] = [];

afterEach(() => {
  for (const c of caches) c.close();
  for (const b of benches) rmSync(b.root, { recursive: true, force: true });
  caches = [];
  benches = [];
});

function bench(): Bench {
  const b = makeBench();
  benches.push(b);
  return b;
}

function tree(b: Bench, scope: Scope = 'public'): ScopedCache {
  const cache = b.cache();
  caches.push(cache);
  return { scope, chainRoot: b.root, cache };
}

/** The edges as `from role to`, sorted, so a test reads as a shape. */
function edges(graph: { links: readonly { from: string; role: string; to: string }[] }): string[] {
  return graph.links.map((l) => `${l.from} ${l.role} ${l.to}`).sort();
}

describe('references — the neighbourhood', () => {
  it('reports what points at an entity and what it points at', () => {
    const b = bench();
    birthTask(b, 'task-1', 'the work');
    observe(b, 'obs-1', 'task-1', 'a note'); // obs-1 --about--> task-1
    birthDecision(b, 'dec-1', 'a call');
    link(b, 'task-1', 'dec-1', 'derived-from'); // task-1 --target--> dec-1

    const graph = references([tree(b)], { id: 'task-1' });
    expect(edges(graph)).toEqual(['obs-1 about task-1', 'task-1 target dec-1']);
    expect(graph.direction).toBe('both');
    expect(graph.depth).toBe(1);
    expect(graph.truncated).toBe(false);
  });

  it('follows one direction when asked', () => {
    const b = bench();
    birthTask(b, 'task-1', 'the work');
    observe(b, 'obs-1', 'task-1', 'a note');
    birthDecision(b, 'dec-1', 'a call');
    link(b, 'task-1', 'dec-1', 'derived-from');
    const sources = [tree(b)];

    expect(edges(references(sources, { id: 'task-1', direction: 'out' }))).toEqual([
      'task-1 target dec-1',
    ]);
    expect(edges(references(sources, { id: 'task-1', direction: 'in' }))).toEqual([
      'obs-1 about task-1',
    ]);
  });

  it('resolves what each end IS, and says when it cannot', () => {
    const b = bench();
    capture(b, 'mem-1', 'a note worth keeping');
    link(b, 'mem-1', 'never-written', 'relates-to');

    const graph = references([tree(b, 'private')], { id: 'mem-1' });
    expect(graph.nodes).toEqual([
      { id: 'mem-1', depth: 0, resolved: true, kind: 'memory', scope: 'private' },
      // The far end is a fact of the record and the record cannot see it. Both
      // halves are reported; neither is invented.
      { id: 'never-written', depth: 1, resolved: false },
    ]);
    expect(edges(graph)).toEqual(['mem-1 target never-written']);
  });

  it("carries a link's relation label verbatim, and reads nothing into it", () => {
    const b = bench();
    capture(b, 'mem-1', 'a note');
    capture(b, 'mem-2', 'another');
    link(b, 'mem-1', 'mem-2', 'a relation nobody defined');

    const graph = references([tree(b)], { id: 'mem-1' });
    expect(graph.links[0]?.rel).toBe('a relation nobody defined');
    // The other roles have no label of their own, and none is invented for them.
    const b2 = bench();
    birthTask(b2, 'task-1', 'x');
    observe(b2, 'obs-1', 'task-1', 'note');
    expect(references([tree(b2)], { id: 'task-1' }).links[0]?.rel).toBeUndefined();
  });

  it('is an answer, not a refusal, for an entity nothing is tied to', () => {
    const b = bench();
    birthTask(b, 'task-1', 'alone');
    const graph = references([tree(b)], { id: 'task-1' });
    expect(graph.links).toEqual([]);
    expect(graph.nodes).toEqual([
      { id: 'task-1', depth: 0, resolved: true, kind: 'task', scope: 'public' },
    ]);
    expect(graph.truncated).toBe(false);
  });

  it('reports an id nothing ever authored as an unresolved origin', () => {
    const b = bench();
    birthTask(b, 'task-1', 'something else');
    const graph = references([tree(b)], { id: 'no-such-id' });
    expect(graph.nodes).toEqual([{ id: 'no-such-id', depth: 0, resolved: false }]);
  });
});

describe('references — the lineage', () => {
  it('walks the supersede chain the links table never held', () => {
    const b = bench();
    birthDecision(b, 'd1', 'first');
    birthDecision(b, 'd2', 'second');
    birthDecision(b, 'd3', 'third');
    supersedeDecision(b, 'd1', 'd2', 'PROPOSED');
    supersedeDecision(b, 'd2', 'd3', 'PROPOSED');

    const forward = references([tree(b)], { id: 'd1', direction: 'out', depth: 5 });
    expect(edges(forward)).toEqual(['d1 by d2', 'd2 by d3']);
    expect(forward.nodes.map((n) => [n.id, n.depth])).toEqual([
      ['d1', 0],
      ['d2', 1],
      ['d3', 2],
    ]);
    // …and backwards from the successor, the reading that did not exist before.
    const back = references([tree(b)], { id: 'd3', direction: 'in', depth: 5 });
    expect(back.nodes.map((n) => [n.id, n.depth])).toEqual([
      ['d3', 0],
      ['d2', 1],
      ['d1', 2],
    ]);
  });

  it('stops at the depth asked for AND says the answer was cut', () => {
    const b = bench();
    capture(b, 'a', 'a');
    capture(b, 'b', 'b');
    capture(b, 'c', 'c');
    link(b, 'a', 'b', 'relates-to');
    link(b, 'b', 'c', 'relates-to');
    const sources = [tree(b)];

    const one = references(sources, { id: 'a', direction: 'out', depth: 1 });
    expect(edges(one)).toEqual(['a target b']);
    expect(one.truncated).toBe(true);

    const two = references(sources, { id: 'a', direction: 'out', depth: 2 });
    expect(edges(two)).toEqual(['a target b', 'b target c']);
    // Nothing lies beyond, so the walk reached the end rather than being cut.
    expect(two.truncated).toBe(false);
  });

  it('terminates on a cycle and reports the edge that closes it', () => {
    const b = bench();
    capture(b, 'a', 'a');
    capture(b, 'b', 'b');
    link(b, 'a', 'b', 'relates-to');
    link(b, 'b', 'a', 'contradicts');

    const graph = references([tree(b)], { id: 'a', direction: 'out', depth: REFERENCE_MAX_DEPTH });
    // Each node once, at its shortest distance; the closing edge still reported.
    expect(graph.nodes.map((n) => [n.id, n.depth])).toEqual([
      ['a', 0],
      ['b', 1],
    ]);
    expect(edges(graph)).toEqual(['a target b', 'b target a']);
    expect(graph.truncated).toBe(false);
  });

  it('clamps the depth it was asked for', () => {
    expect(effectiveDepth(undefined)).toBe(1);
    expect(effectiveDepth(0)).toBe(1);
    expect(effectiveDepth(-3)).toBe(1);
    expect(effectiveDepth(999)).toBe(REFERENCE_MAX_DEPTH);
    const b = bench();
    capture(b, 'a', 'a');
    expect(references([tree(b)], { id: 'a', depth: 999 }).depth).toBe(REFERENCE_MAX_DEPTH);
  });
});

describe('references — across the trees', () => {
  it('finds an edge whose far end lives in another tree, with the right scopes', () => {
    const team = bench();
    const mine = bench();
    birthTask(team, 'task-1', 'the work'); // public
    capture(mine, 'mem-1', 'my note'); // global
    link(mine, 'mem-1', 'task-1', 'relates-to'); // the edge lives in GLOBAL

    const graph = references([tree(team, 'public'), tree(mine, 'global')], { id: 'task-1' });
    expect(edges(graph)).toEqual(['mem-1 target task-1']);
    // The assertion's tree and the far end's tree are different facts, and both
    // are reported: the link was written privately, the task lives in the team's.
    expect(graph.links[0]?.scope).toBe('global');
    expect(graph.nodes).toEqual([
      { id: 'task-1', depth: 0, resolved: true, kind: 'task', scope: 'public' },
      { id: 'mem-1', depth: 1, resolved: true, kind: 'memory', scope: 'global' },
    ]);
  });

  it('follows a path that changes tree at every hop, at its true depth', () => {
    // mem-1 (global) → dec-1 (public) → dec-2 (public, by a supersede). The
    // first edge exists only in the personal tree and the second only in the
    // team's, so a walk that asked one tree and stopped would find half of it.
    const team = bench();
    const mine = bench();
    birthDecision(team, 'dec-1', 'the call');
    birthDecision(team, 'dec-2', 'the newer call');
    supersedeDecision(team, 'dec-1', 'dec-2', 'PROPOSED');
    capture(mine, 'mem-1', 'why we chose it');
    link(mine, 'mem-1', 'dec-1', 'derived-from');
    const sources = [tree(team, 'public'), tree(mine, 'global')];

    const graph = references(sources, { id: 'mem-1', direction: 'out', depth: 2 });
    expect(edges(graph)).toEqual(['dec-1 by dec-2', 'mem-1 target dec-1']);
    expect(graph.nodes.map((n) => [n.id, n.depth])).toEqual([
      ['mem-1', 0],
      ['dec-1', 1],
      ['dec-2', 2],
    ]);
    // At one hop the cross-tree continuation is beyond the cap — and says so.
    const cut = references(sources, { id: 'mem-1', direction: 'out', depth: 1 });
    expect(edges(cut)).toEqual(['mem-1 target dec-1']);
    expect(cut.truncated).toBe(true);
  });
});

describe('references — every tree is walked', () => {
  /**
   * The counting tests. A walk over N trees that each assert one edge into the
   * same hub must report N edges: any tree left unwalked shows up as a number
   * that is short, which no assertion about the SHAPE of the answer would catch.
   */
  it('sums the edges of every tree, including several of the same scope', () => {
    // Two trees per scope — the multi-project read, where a scope stops being a
    // name for one tree.
    const scopes: Scope[] = ['public', 'public', 'private', 'private', 'global', 'global'];
    const sources = scopes.map((scope, index) => {
      const b = bench();
      if (index === 0) birthTask(b, 'hub', 'the work');
      capture(b, `mem-${index}`, `note ${index}`);
      link(b, `mem-${index}`, 'hub', 'relates-to');
      return tree(b, scope);
    });

    const graph = references(sources, { id: 'hub' });
    expect(graph.links).toHaveLength(scopes.length);
    expect(edges(graph)).toEqual(scopes.map((_s, index) => `mem-${index} target hub`).sort());
  });

  it('keeps two assertions apart when both are the same event position', () => {
    // The other half: an `ord` is a position in ONE tree's stream, so two trees
    // written the same way assert their edge at the same one. Identical scope,
    // identical ord, identical role — everything a key made of those three has.
    const first = bench();
    capture(first, 'mem-a', 'a note');
    link(first, 'mem-a', 'hub', 'relates-to');
    const second = bench();
    capture(second, 'mem-b', 'another note');
    link(second, 'mem-b', 'hub', 'relates-to');

    const graph = references([tree(first), tree(second)], { id: 'hub' });
    expect(graph.links).toHaveLength(2);
    expect(edges(graph)).toEqual(['mem-a target hub', 'mem-b target hub']);
  });

  it('reports one edge when the same tree is opened twice', () => {
    // A tree reached by two paths is still ONE tree, and its edge is one
    // assertion. Reporting it twice would put two facts in the graph where the
    // record holds one — a reader counts edges as evidence.
    const b = bench();
    capture(b, 'mem-1', 'a note');
    link(b, 'mem-1', 'hub', 'relates-to');

    const twoCaches = references([tree(b), tree(b)], { id: 'hub' });
    expect(twoCaches.links).toHaveLength(1);
    const sameCache = tree(b);
    expect(references([sameCache, sameCache], { id: 'hub' }).links).toHaveLength(1);
  });

  it('says it was cut when the hop past the cap lives in a sibling tree', () => {
    // a → b in one tree, b → c in another of the SAME scope. At one hop the
    // answer IS cut, and the proof of the cut is an edge in the second tree.
    const first = bench();
    capture(first, 'a', 'a');
    link(first, 'a', 'b', 'relates-to');
    const second = bench();
    capture(second, 'b', 'b');
    link(second, 'b', 'c', 'relates-to');
    const sources = [tree(first), tree(second)];

    const cut = references(sources, { id: 'a', direction: 'out', depth: 1 });
    expect(edges(cut)).toEqual(['a target b']);
    expect(cut.truncated).toBe(true);

    // …and stays quiet when nothing lies beyond: the same two trees, asked deep
    // enough to reach the end of what is connected.
    const whole = references(sources, { id: 'a', direction: 'out', depth: 2 });
    expect(edges(whole)).toEqual(['a target b', 'b target c']);
    expect(whole.truncated).toBe(false);
  });

  it('terminates on a cycle that closes through a sibling tree', () => {
    const first = bench();
    capture(first, 'a', 'a');
    link(first, 'a', 'b', 'relates-to');
    const second = bench();
    capture(second, 'b', 'b');
    link(second, 'b', 'a', 'contradicts');

    const graph = references([tree(first), tree(second)], {
      id: 'a',
      direction: 'out',
      depth: REFERENCE_MAX_DEPTH,
    });
    expect(edges(graph)).toEqual(['a target b', 'b target a']);
    expect(graph.nodes.map((n) => [n.id, n.depth])).toEqual([
      ['a', 0],
      ['b', 1],
    ]);
    expect(graph.truncated).toBe(false);
  });
});
