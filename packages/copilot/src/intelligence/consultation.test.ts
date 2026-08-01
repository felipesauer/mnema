/**
 * The consultation count: what it counts, and what it refuses to double-count.
 *
 * Two of these cases are unreachable from any one surface, which is why they are
 * here. A pattern consulted by one session in TWO trees is two facts and one
 * session, and the command line reads one project so it can never build that
 * fixture; a fact with no run is what a writer outside the serving read would
 * leave. Both decide whether the number a person reads is true.
 */

import { rmSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { type Bench, birthSkill, consultSkill, makeBench } from '../../tests/support/chain.js';
import type { ScopedCache } from '../sources.js';
import { consultationsByRun } from './consultation.js';

describe('consultationsByRun — how many sessions were served each pattern', () => {
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

  it('counts one session once, however many times it was served', () => {
    const b = bench();
    birthSkill(b, 'sk-1', 'Small PRs', 'adopted');
    consultSkill(b, 'sk-1', { run: 'run-a' });
    consultSkill(b, 'sk-1', { run: 'run-a' });
    consultSkill(b, 'sk-1', { run: 'run-b' });

    expect(consultationsByRun([source(b)])).toEqual(new Map([['sk-1', 2]]));
  });

  it('counts one session once across TWO trees — two facts, one session', () => {
    // A session that works in two trees records the fact in each; summing the
    // per-tree counts would report one person's session as two.
    const one = bench();
    const two = bench();
    birthSkill(one, 'sk-1', 'Small PRs', 'adopted');
    consultSkill(one, 'sk-1', { run: 'run-a' });
    consultSkill(two, 'sk-1', { run: 'run-a' });

    expect(consultationsByRun([source(one), source(two, 'private')])).toEqual(
      new Map([['sk-1', 1]]),
    );
  });

  it('counts a fact with NO run on its own — nothing says two were the same', () => {
    const b = bench();
    birthSkill(b, 'sk-1', 'Small PRs', 'adopted');
    consultSkill(b, 'sk-1');
    consultSkill(b, 'sk-1');
    consultSkill(b, 'sk-1', { run: 'run-a' });

    expect(consultationsByRun([source(b)])).toEqual(new Map([['sk-1', 3]]));
  });

  it('leaves a pattern nobody opened OUT of the map, which reads as the zero it is', () => {
    const b = bench();
    birthSkill(b, 'sk-1', 'Small PRs', 'adopted');
    birthSkill(b, 'sk-2', 'Ship on Fridays', 'proposed');
    consultSkill(b, 'sk-1', { run: 'run-a' });

    const counts = consultationsByRun([source(b)]);
    expect(counts.get('sk-1')).toBe(1);
    expect(counts.has('sk-2')).toBe(false);
  });

  it('is empty over a record that has never served a pattern', () => {
    const b = bench();
    birthSkill(b, 'sk-1', 'Small PRs', 'adopted');
    expect(consultationsByRun([source(b)])).toEqual(new Map());
  });
});
