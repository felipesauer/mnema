/**
 * The rule that binds every composed read: TWO TREES IN THE SAME ROLE ARE TWO
 * TREES.
 *
 * A scope is a role, not a name for one tree, and a read that spans projects
 * holds several trees standing in the same one. So the rule has as many points
 * as there are readers over a list of trees, and this file spends one test on
 * each of them: the same shape every time — two benches, the same scope, one
 * fact each — asked to report both.
 *
 * The point of writing them together is that a reader added later has an
 * obvious place to be counted, and a reader that gets this wrong fails HERE,
 * next to the ones that get it right, rather than in its own file where a short
 * answer reads like the answer.
 */

import { rmSync } from 'node:fs';
import type { ProjectionCache, Scope } from '@mnema/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type Bench,
  birthSkill,
  capture,
  link,
  makeBench,
  observe,
} from '../tests/support/chain.js';
import { readRecord, searchRecords } from './context/search.js';
import { adoptedSkills } from './context/skills.js';
import { accountability } from './intelligence/accountability.js';
import { exposure } from './intelligence/exposure.js';
import { patternProvenance } from './intelligence/provenance.js';
import { references } from './intelligence/references.js';
import { timeline } from './intelligence/timeline.js';
import type { ScopedCache } from './sources.js';

let benches: Bench[] = [];
let caches: ProjectionCache[] = [];

afterEach(() => {
  for (const c of caches) c.close();
  for (const b of benches) rmSync(b.root, { recursive: true, force: true });
  caches = [];
  benches = [];
});

/** A fresh tree standing in `scope` — two calls give two trees, same role. */
function tree(scope: Scope = 'public'): { bench: Bench; source: ScopedCache } {
  const bench = makeBench();
  benches.push(bench);
  return {
    bench,
    get source(): ScopedCache {
      const cache = bench.cache();
      caches.push(cache);
      return { scope, chainRoot: bench.root, cache };
    },
  };
}

describe('two trees in the same role are two trees', () => {
  it('searchRecords — hits from both', () => {
    const first = tree();
    capture(first.bench, 'mem-a', 'the shared word here');
    const second = tree();
    capture(second.bench, 'mem-b', 'the shared word too');

    const found = searchRecords([first.source, second.source], { text: 'shared' });
    expect(found.hits.map((h) => h.id).sort()).toEqual(['mem-a', 'mem-b']);
    expect(found.total).toBe(2);
  });

  it('readRecord — the holder answers, whichever of the two it is', () => {
    const first = tree();
    capture(first.bench, 'mem-a', 'in the first');
    const second = tree();
    capture(second.bench, 'mem-b', 'in the second');
    const sources = [first.source, second.source];

    expect(readRecord(sources, 'mem-a')?.id).toBe('mem-a');
    // The second tree is not shadowed by the first having been asked already.
    expect(readRecord(sources, 'mem-b')?.id).toBe('mem-b');
  });

  it('timeline — the entity’s story merged across both', () => {
    const first = tree();
    observe(first.bench, 'obs-a', 'task-1', 'seen from here');
    const second = tree();
    observe(second.bench, 'obs-b', 'task-1', 'and from here');

    const story = timeline([first.source, second.source], 'task-1');
    expect(story.map((e) => e.subject).sort()).toEqual(['obs-a', 'obs-b']);
  });

  it('accountability — the facts of both are counted', () => {
    const first = tree();
    capture(first.bench, 'mem-a', 'one fact');
    const second = tree();
    capture(second.bench, 'mem-b', 'another fact');

    const account = accountability([first.source, second.source]);
    expect(account.total).toBe(2);
  });

  it('patternProvenance — patterns from both', () => {
    const first = tree();
    birthSkill(first.bench, 'skill-a', 'a pattern');
    const second = tree();
    birthSkill(second.bench, 'skill-b', 'b pattern');

    const provenance = patternProvenance([first.source, second.source]);
    expect(provenance.map((p) => p.id)).toEqual(['skill-a', 'skill-b']);
  });

  it('references — the edges of both', () => {
    const first = tree();
    capture(first.bench, 'mem-a', 'a note');
    link(first.bench, 'mem-a', 'hub', 'relates-to');
    const second = tree();
    capture(second.bench, 'mem-b', 'another note');
    link(second.bench, 'mem-b', 'hub', 'relates-to');

    const graph = references([first.source, second.source], { id: 'hub' });
    expect(graph.links).toHaveLength(2);
  });

  it('exposure — the streams of both are scanned', () => {
    const first = tree();
    capture(first.bench, 'mem-a', 'a note');
    const second = tree();
    capture(second.bench, 'mem-b', 'another note');

    const scan = exposure([
      { scope: 'public', events: first.bench.events() },
      { scope: 'public', events: second.bench.events() },
    ]);
    expect(scan.scanned).toBe(first.bench.events().length + second.bench.events().length);
  });

  it('adoptedSkills — every cache, and no scope to collapse in the first place', () => {
    // This reader takes bare caches: it never sees a scope, so it cannot mistake
    // one for a tree. The test is here to keep it counted among the points.
    const first = tree();
    birthSkill(first.bench, 'skill-a', 'a pattern', 'adopted');
    const second = tree();
    birthSkill(second.bench, 'skill-b', 'b pattern', 'adopted');

    const adopted = adoptedSkills([first.source.cache, second.source.cache]);
    expect(adopted.map((s) => s.id)).toEqual(['skill-a', 'skill-b']);
  });
});
