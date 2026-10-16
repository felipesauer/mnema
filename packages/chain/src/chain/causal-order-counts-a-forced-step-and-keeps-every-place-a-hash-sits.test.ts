/**
 * THE MERGE COUNTS THE STEP IT HAD TO FORCE, AND KEEPS EVERY PLACE A CITED HASH SITS.
 *
 * `causal-order.properties.test.ts` draws histories in which every citation names an entry that
 * existed first, so no draw ever forces a step and no draw holds one hash in two places. Both
 * are cases the module documents and a reader prints, so each is built by hand here.
 */

import { describe, expect, it } from 'vitest';
import { causalOrder, type OrderKeys, type TailToOrder } from './causal-order.js';

interface Entry {
  readonly at: string;
  readonly hash: string;
  readonly after?: readonly string[];
}

/** Tails of hand-written entries, as the arrays the merge asks position by position. */
function merge(tails: readonly { tree?: number; tail: string; entries: readonly Entry[] }[]) {
  const order: TailToOrder[] = tails.map(({ tree = 0, tail, entries }) => ({
    tree,
    tail,
    length: entries.length,
  }));
  const entryAt = (tail: number, position: number): Entry =>
    (tails[tail] as { entries: readonly Entry[] }).entries[position] as Entry;
  const keys: OrderKeys = {
    at: (tail, position) => entryAt(tail, position).at,
    hash: (tail, position) => entryAt(tail, position).hash,
    after: (tail, position) => entryAt(tail, position).after,
  };
  return causalOrder(order, keys);
}

describe('a cycle of citations is stepped through, and counted', () => {
  it('forces the smallest instant when each head waits on the other, once', () => {
    const merged = merge([
      { tail: 'a', entries: [{ at: '2026-10-01T00:00:01.000Z', hash: 'ha', after: ['hb'] }] },
      { tail: 'b', entries: [{ at: '2026-10-01T00:00:02.000Z', hash: 'hb', after: ['ha'] }] },
    ]);
    expect(merged.steps).toEqual([0, 1]);
    expect(merged.forced).toBe(1);
  });

  it('forces nothing when every citation can be honoured', () => {
    const merged = merge([
      { tail: 'a', entries: [{ at: '2026-10-01T00:00:05.000Z', hash: 'ha' }] },
      { tail: 'b', entries: [{ at: '2026-10-01T00:00:01.000Z', hash: 'hb', after: ['ha'] }] },
    ]);
    expect(merged.steps).toEqual([0, 1]);
    expect(merged.forced).toBe(0);
  });

  it('forces a step for each cycle, and a tail that is done is not forced', () => {
    const merged = merge([
      {
        tail: 'a',
        entries: [
          { at: '2026-10-01T00:00:01.000Z', hash: 'a0', after: ['b0'] },
          { at: '2026-10-01T00:00:03.000Z', hash: 'a1', after: ['b1'] },
        ],
      },
      {
        tail: 'b',
        entries: [
          { at: '2026-10-01T00:00:02.000Z', hash: 'b0', after: ['a0'] },
          { at: '2026-10-01T00:00:04.000Z', hash: 'b1', after: ['a1'] },
        ],
      },
    ]);
    expect(merged.steps).toEqual([0, 1, 0, 1]);
    expect(merged.forced).toBe(2);
  });
});

describe('a hash that sits in two places is cited at both', () => {
  it('holds one citation for each place the hash is, in the tree of the citing entry', () => {
    const merged = merge([
      { tail: 'a', entries: [{ at: '2026-10-01T00:00:01.000Z', hash: 'same' }] },
      { tail: 'b', entries: [{ at: '2026-10-01T00:00:02.000Z', hash: 'same' }] },
      { tail: 'c', entries: [{ at: '2026-10-01T00:00:00.000Z', hash: 'hc', after: ['same'] }] },
    ]);
    expect(merged.held).toEqual([
      { tail: 2, position: 0, citedTail: 0, citedPosition: 0 },
      { tail: 2, position: 0, citedTail: 1, citedPosition: 0 },
    ]);
    // The citing entry waits for both, though its instant is the earliest.
    expect(merged.steps).toEqual([0, 1, 2]);
    expect(merged.notHeld).toEqual([]);
  });

  it('does not find a hash in another tree', () => {
    const merged = merge([
      { tree: 0, tail: 'a', entries: [{ at: '2026-10-01T00:00:01.000Z', hash: 'far' }] },
      {
        tree: 1,
        tail: 'b',
        entries: [{ at: '2026-10-01T00:00:00.000Z', hash: 'hb', after: ['far'] }],
      },
    ]);
    expect(merged.held).toEqual([]);
    expect(merged.notHeld).toEqual([{ tail: 1, position: 0, hash: 'far' }]);
    expect(merged.steps).toEqual([1, 0]);
  });
});
