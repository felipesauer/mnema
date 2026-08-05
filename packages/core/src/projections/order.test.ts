import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  catalogUpcasters,
  openChainForWriting,
  taskBirth,
  taskCreated,
  taskTransitioned,
} from '@mnema/chain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { orderedEvents, orderedEventsOfRecord } from './order.js';

let rootA: string;
let rootB: string;

beforeEach(() => {
  rootA = mkdtempSync(join(tmpdir(), 'mnema-order-a-'));
  rootB = mkdtempSync(join(tmpdir(), 'mnema-order-b-'));
});

afterEach(() => {
  rmSync(rootA, { recursive: true, force: true });
  rmSync(rootB, { recursive: true, force: true });
});

const upcasters = catalogUpcasters();
const env = (subject: string, at: string) => ({ at, who: 'felipe', signerFp: 'fp-1', subject });

/** Copies tail B's directory and public key into A's chain (an offline merge). */
function mergeTails(from: string, into: string): void {
  cpSync(join(from, 'tails'), join(into, 'tails'), { recursive: true });
  cpSync(join(from, 'keys'), join(into, 'keys'), { recursive: true });
}

describe('orderedEvents — single tail preserves seq order', () => {
  it('returns events in the order they were appended', () => {
    const w = openChainForWriting(rootA, { keyRoot: rootA });
    w.append(taskCreated(env('t-1', '2026-07-21T00:00:00.000Z'), { title: 'first' }));
    w.append(taskCreated(env('t-2', '2026-07-21T00:00:01.000Z'), { title: 'second' }));
    w.append(taskCreated(env('t-3', '2026-07-21T00:00:02.000Z'), { title: 'third' }));
    const events = orderedEvents({ root: rootA }, upcasters);
    expect(events.map((e) => e.subject)).toEqual(['t-1', 't-2', 't-3']);
  });
});

describe('orderedEvents — multi-tail is total and deterministic', () => {
  it('interleaves two tails by timestamp', () => {
    const a = openChainForWriting(rootA, { keyRoot: rootA });
    a.append(taskCreated(env('a-1', '2026-07-21T00:00:00.000Z'), { title: 'a1' }));
    a.append(taskCreated(env('a-2', '2026-07-21T00:00:02.000Z'), { title: 'a2' }));
    const b = openChainForWriting(rootB, { keyRoot: rootB });
    b.append(taskCreated(env('b-1', '2026-07-21T00:00:01.000Z'), { title: 'b1' }));
    mergeTails(rootB, rootA);

    const events = orderedEvents({ root: rootA }, upcasters);
    // Ordered by `at`: a-1 (t0), b-1 (t1), a-2 (t2).
    expect(events.map((e) => e.subject)).toEqual(['a-1', 'b-1', 'a-2']);
  });

  it('breaks an `at` tie deterministically by tail then seq, not by read order', () => {
    // Both events share the SAME timestamp. The order must still be total and
    // must not depend on which tail happened to be read first.
    const sameAt = '2026-07-21T00:00:00.000Z';
    const a = openChainForWriting(rootA, { keyRoot: rootA });
    a.append(taskCreated(env('a-1', sameAt), { title: 'a1' }));
    const b = openChainForWriting(rootB, { keyRoot: rootB });
    b.append(taskCreated(env('b-1', sameAt), { title: 'b1' }));
    mergeTails(rootB, rootA);

    const first = orderedEvents({ root: rootA }, upcasters);
    // Deterministic: the same chain always folds to the same order.
    const second = orderedEvents({ root: rootA }, upcasters);
    expect(first.map((e) => e.subject)).toEqual(second.map((e) => e.subject));
    // The two subjects are both present, in an order fixed by the tail id.
    expect([...first.map((e) => e.subject)].sort()).toEqual(['a-1', 'b-1']);
  });

  it('never reorders within a tail even when timestamps are equal', () => {
    // Three events in one tail with identical `at`: seq is the tie-break, so
    // append order is preserved (the hash chain proves that order).
    const sameAt = '2026-07-21T00:00:00.000Z';
    const a = openChainForWriting(rootA, { keyRoot: rootA });
    a.append(taskCreated(env('a-1', sameAt), { title: 'a1' }));
    a.append(taskCreated(env('a-2', sameAt), { title: 'a2' }));
    a.append(taskCreated(env('a-3', sameAt), { title: 'a3' }));
    const events = orderedEvents({ root: rootA }, upcasters);
    expect(events.map((e) => e.subject)).toEqual(['a-1', 'a-2', 'a-3']);
  });
});

describe('orderedEvents — within-tail proven order beats a non-monotonic clock', () => {
  it('keeps seq order when a tail`s `at` steps backward between appends', () => {
    // A clock correction (NTP, VM resume) makes a later-sequenced event carry an
    // EARLIER `at` than the one before it. The proven order is seq2 then seq3;
    // the wall-clock says the opposite. `seq` must win — anything else lets the
    // cache contradict the chain it is derived from.
    const w = openChainForWriting(rootA, { keyRoot: rootA });
    const [c, b] = taskBirth(env('t-1', '2026-07-21T00:00:05.000Z'), {
      title: 't',
      initial: 'draft',
    });
    w.append(c);
    w.append(b);
    w.append(
      taskTransitioned(env('t-1', '2026-07-21T00:00:10.000Z'), {
        from: 'draft',
        to: 'in-progress',
        action: 'start',
      }),
    );
    w.append(
      taskTransitioned(env('t-1', '2026-07-21T00:00:08.000Z'), {
        from: 'in-progress',
        to: 'done',
        action: 'finish',
      }),
    );

    const tos = orderedEvents({ root: rootA }, upcasters)
      .filter((e) => e.kind === 'task.transitioned')
      .map((e) => (e.kind === 'task.transitioned' ? e.payload.to : ''));
    // Proven order, not clock order: draft (birth) → in-progress → done.
    expect(tos).toEqual(['draft', 'in-progress', 'done']);
  });
});

describe('orderedEventsOfRecord — the same tails, ordered two ways, read once', () => {
  /**
   * Two chains, each with two tails, and every `at` COLLIDING across them — so both
   * orders are decided by the tie-break rather than by the clock. On a fixture where
   * the instants differ, a merge that got the tie-break wrong still comes out right,
   * and the equivalence below would be asserting nothing.
   */
  function twoChainsOfTwoTails(): void {
    const sameAt = '2026-07-21T00:00:00.000Z';
    for (const [root, prefix] of [
      [rootA, 'a'],
      [rootB, 'b'],
    ] as const) {
      const first = openChainForWriting(root, { keyRoot: root });
      first.append(taskCreated(env(`${prefix}-1`, sameAt), { title: '1' }));
      first.append(taskCreated(env(`${prefix}-2`, sameAt), { title: '2' }));
      // A second tail of the SAME chain: another installation's key, its own file.
      const otherRoot = mkdtempSync(join(tmpdir(), `mnema-order-${prefix}-2nd-`));
      try {
        const second = openChainForWriting(otherRoot, { keyRoot: otherRoot });
        second.append(taskCreated(env(`${prefix}-3`, sameAt), { title: '3' }));
        mergeTails(otherRoot, root);
      } finally {
        rmSync(otherRoot, { recursive: true, force: true });
      }
    }
  }

  it('orders each chain exactly as `orderedEvents` does, and the union over all of them', () => {
    // The whole justification for this function is that it gives BOTH answers from one
    // reading. If either differed from the function it stands in for, the saving would
    // be a behaviour change wearing a performance argument.
    twoChainsOfTwoTails();
    const layouts = [{ root: rootA }, { root: rootB }];
    const { chains, across } = orderedEventsOfRecord(layouts, upcasters);

    expect(chains).toHaveLength(2);
    expect(chains[0]).toEqual(orderedEvents({ root: rootA }, upcasters));
    expect(chains[1]).toEqual(orderedEvents({ root: rootB }, upcasters));
    // The union is every chain's tails in one interleave: the same events, and each
    // chain's own order preserved inside it. What that order IS over several trees is
    // asserted in `topology/compose.test.ts`; what is asserted here is that asking for
    // both views does not cost either of them anything.
    expect([...across].sort(bySubject)).toEqual([...chains.flat()].sort(bySubject));
    for (const chain of chains) {
      expect(across.filter((e) => chain.includes(e))).toEqual(chain);
    }
    // Non-vacuity: the fixture really has two tails per chain and both orders have
    // something to get wrong — three events each, six in the union.
    expect(chains.map((chain) => chain.length)).toEqual([3, 3]);
    expect(across).toHaveLength(6);
  });

  it('keeps one entry per layout, empty for a chain nothing was written to', () => {
    // A named tree with no directory contributes nothing, and it must not shift the
    // entries: a caller pairs `chains[i]` with `layouts[i]`.
    const w = openChainForWriting(rootB, { keyRoot: rootB });
    w.append(taskCreated(env('only', '2026-07-21T00:00:00.000Z'), { title: 'only' }));
    const { chains, across } = orderedEventsOfRecord([{ root: rootA }, { root: rootB }], upcasters);
    expect(chains.map((chain) => chain.map((e) => e.subject))).toEqual([[], ['only']]);
    expect(across.map((e) => e.subject)).toEqual(['only']);
  });

  it('hands back arrays a caller may not disturb for the other view', () => {
    // Both views are drained from the same in-memory streams, so a merge that consumed
    // shared cursors would return one full answer and one truncated one. Asked in the
    // order that would expose it: the union is built last, and it is complete.
    twoChainsOfTwoTails();
    const { chains, across } = orderedEventsOfRecord([{ root: rootA }, { root: rootB }], upcasters);
    expect(across).toHaveLength(chains.reduce((total, chain) => total + chain.length, 0));
  });
});

/** Subject order, so two lists of the same events can be compared as sets. */
function bySubject(a: { subject: string }, b: { subject: string }): number {
  return a.subject < b.subject ? -1 : a.subject > b.subject ? 1 : 0;
}
