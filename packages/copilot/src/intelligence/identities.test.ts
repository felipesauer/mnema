/**
 * Who the record knows: the set two halves of the surface must agree on.
 *
 * The properties that matter are about the SET, not about any one identity — one
 * person writing in two trees is one identity, and an identity with a single fact
 * is in the list exactly as one with many. Get either wrong and a form shortened
 * here would be ambiguous, or refused, over there.
 */

import { rmSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { type Bench, birthTask, consultSkill, makeBench } from '../../tests/support/chain.js';
import type { ScopedCache } from '../sources.js';
import { knownAnchors } from './identities.js';

describe('knownAnchors — every identity that authorized a fact', () => {
  let benches: Bench[] = [];
  let open: ScopedCache[] = [];
  afterEach(() => {
    for (const source of open) source.cache.close();
    for (const b of benches) rmSync(b.root, { recursive: true, force: true });
    open = [];
    benches = [];
  });

  function bench(): Bench {
    const b = makeBench();
    benches.push(b);
    return b;
  }

  function source(b: Bench, scope: ScopedCache['scope'] = 'public'): ScopedCache {
    const s: ScopedCache = { scope, chainRoot: b.root, cache: b.cache() };
    open.push(s);
    return s;
  }

  it('names an identity once, however much it wrote', () => {
    const b = bench();
    birthTask(b, 'tk-1', 'one');
    birthTask(b, 'tk-2', 'two');
    expect(knownAnchors([source(b)])).toEqual([b.who]);
  });

  it('unions the trees, and one identity writing in two is still one', () => {
    const one = bench();
    const two = bench();
    birthTask(one, 'tk-1', 'in the team tree');
    // The SAME identity, writing into the other tree.
    consultSkill(two, 'sk-1', { who: one.who, run: 'run-a' });
    birthTask(two, 'tk-2', 'in this machine’s tree');

    expect(knownAnchors([source(one), source(two, 'private')])).toEqual([one.who, two.who].sort());
  });

  it('counts an identity with ONE fact exactly as one with many', () => {
    // Presence, not volume: a form that was legible until a newcomer's first write
    // would be a form the reads print and the flags then refuse.
    const one = bench();
    const two = bench();
    for (let i = 0; i < 20; i++) birthTask(one, `tk-${i}`, 'busy');
    consultSkill(two, 'sk-1', { who: two.who, run: 'run-a' });

    expect(knownAnchors([source(one), source(two, 'private')])).toHaveLength(2);
  });

  it('is empty over a record nobody has written to', () => {
    expect(knownAnchors([source(bench())])).toEqual([]);
  });
});
