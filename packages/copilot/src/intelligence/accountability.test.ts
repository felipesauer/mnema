import { rmSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type Bench,
  birthTask,
  endRun,
  makeBench,
  moveTask,
  startRun,
} from '../../tests/support/chain.js';
import { accountability } from './accountability.js';

describe('accountability — who authorized what, which agent executed', () => {
  let bench: Bench;
  afterEach(() => {
    if (bench) rmSync(bench.root, { recursive: true, force: true });
  });

  it('counts every fact and attributes it to its authorizing who', () => {
    bench = makeBench();
    birthTask(bench, 'task-1', 'a'); // 2 events (created + birth transition)
    moveTask(bench, 'task-1', 'DRAFT', 'READY', 'submit'); // 1
    const acc = accountability(bench.events());
    expect(acc.total).toBe(3);
    expect(acc.byWho).toHaveLength(1);
    const mine = acc.byWho[0];
    expect(mine?.who).toBe(bench.who);
    expect(mine?.total).toBe(3);
    // The counts by kind sum to the total.
    expect(mine?.byKind.reduce((n, k) => n + k.count, 0)).toBe(3);
    expect(mine?.byKind).toEqual([
      { kind: 'task.created', count: 1 },
      { kind: 'task.transitioned', count: 2 },
    ]);
  });

  it('separates the human (who) from the executing agent (which)', () => {
    // A run stamps `which` = the agent; a plain task move has no agent. Both are
    // authorized by the same human, so the who≠which split shows under one who.
    bench = makeBench();
    startRun(bench, 'run-1', { agent: 'claude' }); // which = claude
    endRun(bench, 'run-1'); // no which
    const mine = accountability(bench.events()).byWho[0];
    expect(mine?.who).toBe(bench.who);
    expect(mine?.byWhich).toEqual([
      { which: 'claude', count: 1 },
      { which: null, count: 1 },
    ]);
  });

  it('ranks authors by count for a stable shape, without a verdict', () => {
    // Two authors sharing the tail: the projection replays `who` as written.
    bench = makeBench();
    startRun(bench, 'r-a1', { agent: 'claude', who: 'alice' });
    startRun(bench, 'r-a2', { agent: 'claude', who: 'alice' });
    startRun(bench, 'r-b1', { agent: 'claude', who: 'bob' });
    const acc = accountability(bench.events());
    // Alice (2) before Bob (1) — a deterministic order, not a claim of importance.
    expect(acc.byWho.map((w) => [w.who, w.total])).toEqual([
      ['alice', 2],
      ['bob', 1],
    ]);
  });

  it('cuts by an inclusive from/to window and echoes it back', () => {
    bench = makeBench();
    // now() ticks a second per call. The birth PAIR shares one envelope stamp
    // (one now() call in the helper), so: created+birth at :00, submit at :01,
    // start at :02.
    birthTask(bench, 'task-1', 'a'); // :00 (both birth events)
    moveTask(bench, 'task-1', 'DRAFT', 'READY', 'submit'); // :01
    moveTask(bench, 'task-1', 'READY', 'IN_PROGRESS', 'start'); // :02
    const from = '2026-01-01T00:00:01.000Z';
    const to = '2026-01-01T00:00:02.000Z';
    const acc = accountability(bench.events(), { from, to });
    expect(acc.from).toBe(from);
    expect(acc.to).toBe(to);
    // Only submit (:01) and start (:02) fall in the inclusive window; the birth
    // pair at :00 is below `from`.
    expect(acc.total).toBe(2);
  });

  it('filters by who and by which', () => {
    bench = makeBench();
    startRun(bench, 'r-a', { agent: 'claude', who: 'alice' });
    startRun(bench, 'r-b', { agent: 'gpt', who: 'bob' });
    expect(accountability(bench.events(), { who: 'alice' }).total).toBe(1);
    expect(accountability(bench.events(), { which: 'gpt' }).total).toBe(1);
    expect(accountability(bench.events(), { who: 'alice', which: 'gpt' }).total).toBe(0);
  });

  it('is a zero account for an empty stream', () => {
    bench = makeBench();
    const acc = accountability(bench.events());
    expect(acc).toEqual({ total: 0, byWho: [] });
  });
});
