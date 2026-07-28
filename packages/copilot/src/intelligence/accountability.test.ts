import { rmSync } from 'node:fs';
import type { ProjectionCache, Scope } from '@mnema/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type Bench,
  birthTask,
  endRun,
  makeBench,
  moveTask,
  observe,
  startRun,
} from '../../tests/support/chain.js';
import type { ScopedCache } from '../sources.js';
import { accountability } from './accountability.js';

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
  return { scope, cache };
}

describe('accountability — who authorized what, which agent executed', () => {
  it('counts every fact and attributes it to its authorizing who', () => {
    const b = bench();
    birthTask(b, 'task-1', 'a'); // 2 events (created + birth transition)
    moveTask(b, 'task-1', 'DRAFT', 'READY', 'submit'); // 1
    const acc = accountability([tree(b)]);
    expect(acc.total).toBe(3);
    expect(acc.byWho).toHaveLength(1);
    const mine = acc.byWho[0];
    expect(mine?.who).toBe(b.who);
    expect(mine?.total).toBe(3);
    // The counts by kind sum to the total.
    expect(mine?.byKind.reduce((n, k) => n + k.count, 0)).toBe(3);
    expect(mine?.byKind).toEqual([
      { kind: 'task.created', count: 1 },
      { kind: 'task.transitioned', count: 2 },
    ]);
  });

  it('counts a fact ONCE however many entities it refers to', () => {
    // The index holds one row per (event, entity, role), so an observation
    // contributes two rows. Counting rows instead of events would inflate the
    // account of whoever writes the most relational facts.
    const b = bench();
    birthTask(b, 'task-1', 'a'); // 2 events
    observe(b, 'obs-1', 'task-1', 'a note'); // 1 event, 2 reference rows
    expect(accountability([tree(b)]).total).toBe(3);
  });

  it('separates the human (who) from the executing agent (which)', () => {
    // A run stamps `which` = the agent; a plain task move has no agent. Both are
    // authorized by the same human, so the who≠which split shows under one who.
    const b = bench();
    startRun(b, 'run-1', { agent: 'claude' }); // which = claude
    endRun(b, 'run-1'); // no which
    const mine = accountability([tree(b)]).byWho[0];
    expect(mine?.who).toBe(b.who);
    expect(mine?.byWhich).toEqual([
      { which: 'claude', count: 1 },
      { which: null, count: 1 },
    ]);
  });

  it('ranks authors by count for a stable shape, without a verdict', () => {
    // Two authors sharing the tail: the projection replays `who` as written.
    const b = bench();
    startRun(b, 'r-a1', { agent: 'claude', who: 'alice' });
    startRun(b, 'r-a2', { agent: 'claude', who: 'alice' });
    startRun(b, 'r-b1', { agent: 'claude', who: 'bob' });
    const acc = accountability([tree(b)]);
    // Alice (2) before Bob (1) — a deterministic order, not a claim of importance.
    expect(acc.byWho.map((w) => [w.who, w.total])).toEqual([
      ['alice', 2],
      ['bob', 1],
    ]);
  });

  it('cuts by an inclusive from/to window and echoes it back', () => {
    const b = bench();
    // now() ticks a second per call. The birth PAIR shares one envelope stamp
    // (one now() call in the helper), so: created+birth at :00, submit at :01,
    // start at :02.
    birthTask(b, 'task-1', 'a'); // :00 (both birth events)
    moveTask(b, 'task-1', 'DRAFT', 'READY', 'submit'); // :01
    moveTask(b, 'task-1', 'READY', 'IN_PROGRESS', 'start'); // :02
    const from = '2026-01-01T00:00:01.000Z';
    const to = '2026-01-01T00:00:02.000Z';
    const acc = accountability([tree(b)], { from, to });
    expect(acc.from).toBe(from);
    expect(acc.to).toBe(to);
    // Only submit (:01) and start (:02) fall in the inclusive window; the birth
    // pair at :00 is below `from`.
    expect(acc.total).toBe(2);
  });

  it('filters by who and by which', () => {
    const b = bench();
    startRun(b, 'r-a', { agent: 'claude', who: 'alice' });
    startRun(b, 'r-b', { agent: 'gpt', who: 'bob' });
    const sources = [tree(b)];
    expect(accountability(sources, { who: 'alice' }).total).toBe(1);
    expect(accountability(sources, { which: 'gpt' }).total).toBe(1);
    expect(accountability(sources, { who: 'alice', which: 'gpt' }).total).toBe(0);
  });

  it('sums the trees into one account per author', () => {
    const team = bench();
    const mine = bench();
    startRun(team, 'r-1', { agent: 'claude', who: 'alice' });
    startRun(mine, 'r-2', { agent: 'claude', who: 'alice' });
    const acc = accountability([tree(team, 'public'), tree(mine, 'global')]);
    expect(acc.total).toBe(2);
    expect(acc.byWho).toEqual([
      {
        who: 'alice',
        total: 2,
        byKind: [{ kind: 'run.started', count: 2 }],
        byWhich: [{ which: 'claude', count: 2 }],
      },
    ]);
  });

  it('is a zero account for an empty record', () => {
    const b = bench();
    expect(accountability([tree(b)])).toEqual({ total: 0, byWho: [] });
    expect(accountability([])).toEqual({ total: 0, byWho: [] });
  });
});
