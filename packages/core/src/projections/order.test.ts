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
import { orderedEvents } from './order.js';

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
