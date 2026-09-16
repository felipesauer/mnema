import {
  appendFileSync,
  cpSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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
import {
  type ChainReplay,
  chainArrivals,
  chainReplay,
  orderedEvents,
  orderedEventsOfRecord,
} from './order.js';

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

/**
 * A RESUMED READING AND THE BOUNDARY IT RESUMES FROM.
 *
 * These hold the repair `TailReach.boundary` names. The frontier used to record the
 * `seq` each tail was read to, and the walk that resumes from a seq stops at the first
 * entry CARRYING it — which a duplicate of the boundary entry satisfies. Measured, a
 * full replay reported one break over such a tail and a resumed reading reported that
 * nothing had arrived. The frontier records the BYTE now.
 *
 * The plant is the tail's last line appended again: the same `seq`, the same `prev`,
 * byte for byte. Its DUPLICATES are the point — a shape whose bytes are identical to
 * something already read is exactly what a content hash cannot tell apart, which is why
 * the boundary is a position and not a hash.
 */
describe('chainArrivals — a break planted at the boundary', () => {
  /** The tail's last line, appended again. Returns the seqs the tail then holds. */
  function duplicateLastEntries(root: string, howMany: number): number[] {
    const tails = join(root, 'tails');
    const tail = readdirSync(tails)[0] as string;
    const file = join(tails, tail, '000001.jsonl');
    const lines = readFileSync(file, 'utf-8').trimEnd().split('\n');
    appendFileSync(file, `${lines.slice(lines.length - howMany).join('\n')}\n`, 'utf-8');
    return readFileSync(file, 'utf-8')
      .trimEnd()
      .split('\n')
      .map((line) => (JSON.parse(line) as { link: { seq: number } }).link.seq);
  }

  /** A chain of three facts on one tail, and the frontier a full reading of it leaves. */
  function seeded(): ChainReplay {
    const w = openChainForWriting(rootA, { keyRoot: rootA });
    w.append(taskCreated(env('t-1', '2026-07-21T00:00:00.000Z'), { title: 'first' }));
    w.append(taskCreated(env('t-2', '2026-07-21T00:00:01.000Z'), { title: 'second' }));
    w.append(taskCreated(env('t-3', '2026-07-21T00:00:02.000Z'), { title: 'third' }));
    return chainReplay({ root: rootA }, upcasters);
  }

  // THE CASE THE REPAIR EXISTS FOR, and it is asserted against the FULL reading of the
  // same bytes rather than against a number written here: the two used to disagree.
  it.each([
    ['the last entry', 1],
    ['the last two', 2],
    ['the last three', 3],
  ])('refuses a suffix when %s is duplicated, as the full reading sees a break', (_, many) => {
    const before = seeded();
    expect(before.linkBreaks).toHaveLength(0);

    const seqs = duplicateLastEntries(rootA, many);
    // The plant really is at or below the frontier — nothing NEW is above it.
    expect(Math.max(...seqs)).toBe(before.frontier.tails.values().next().value?.lastSeq);

    const arrived = chainArrivals({ root: rootA }, upcasters, before.frontier);
    expect(arrived.suffix).toBe(false);
    expect(arrived.suffix === false && arrived.why).toBe('AN_ARRIVAL_DOES_NOT_CHAIN');
    // And the full reading of those same bytes agrees there is exactly one break.
    expect(chainReplay({ root: rootA }, upcasters).linkBreaks).toHaveLength(1);
  });

  // THE VACUITY GUARD. Every case above would pass over a `chainArrivals` that refused
  // every suffix, which would replay the whole chain on every read and cost the hot
  // path the entire saving it exists for.
  it('still calls an intact tail a suffix, and a grown one too', () => {
    const before = seeded();
    const still = chainArrivals({ root: rootA }, upcasters, before.frontier);
    expect(still.suffix).toBe(true);
    expect(still.suffix === true && still.events).toHaveLength(0);

    const w = openChainForWriting(rootA, { keyRoot: rootA });
    w.append(taskCreated(env('t-4', '2026-07-21T00:00:03.000Z'), { title: 'fourth' }));
    const grown = chainArrivals({ root: rootA }, upcasters, before.frontier);
    expect(grown.suffix).toBe(true);
    expect(grown.suffix === true && grown.events.map((e) => e.subject)).toEqual(['t-4']);
    expect(chainReplay({ root: rootA }, upcasters).linkBreaks).toHaveLength(0);
  });

  // The boundary advances past the arrivals, so the NEXT resumed reading is anchored on
  // what this one read. Without this, a second refresh would hand back the same events.
  it('advances the boundary past what it read, so a second reading finds nothing', () => {
    const before = seeded();
    const w = openChainForWriting(rootA, { keyRoot: rootA });
    w.append(taskCreated(env('t-4', '2026-07-21T00:00:03.000Z'), { title: 'fourth' }));
    const first = chainArrivals({ root: rootA }, upcasters, before.frontier);
    expect(first.suffix === true && first.events).toHaveLength(1);

    const second = chainArrivals(
      { root: rootA },
      upcasters,
      first.suffix === true ? first.frontier : before.frontier,
    );
    expect(second.suffix).toBe(true);
    expect(second.suffix === true && second.events).toHaveLength(0);

    // …and a duplicate planted at the ADVANCED boundary is caught just the same.
    duplicateLastEntries(rootA, 1);
    const third = chainArrivals(
      { root: rootA },
      upcasters,
      first.suffix === true ? first.frontier : before.frontier,
    );
    expect(third.suffix === false && third.why).toBe('AN_ARRIVAL_DOES_NOT_CHAIN');
  });

  /**
   * THE DECLARED LIMIT, asserted so it cannot drift into a belief.
   *
   * A break BELOW the boundary is in bytes a previous reading already accepted, and a
   * resumed reading does not read them again — that is what makes it cost the arrivals
   * rather than the chain. So a live session is not told, and a connection opening
   * afterwards replays and IS told. Closing this would mean re-reading each tail whole
   * on every refresh, which is the entire cost the incremental path exists to avoid.
   */
  it('does NOT see a break below the boundary, which the full reading does see', () => {
    const before = seeded();
    const tails = join(rootA, 'tails');
    const tail = readdirSync(tails)[0] as string;
    const file = join(tails, tail, '000001.jsonl');
    const lines = readFileSync(file, 'utf-8').trimEnd().split('\n');
    // The FIRST entry written a second time, in the middle of the tail: every byte of
    // it is below the frontier, and the entries after it are untouched.
    writeFileSync(
      file,
      `${[...lines.slice(0, 1), lines[0] as string, ...lines.slice(1)].join('\n')}\n`,
      'utf-8',
    );

    const arrived = chainArrivals({ root: rootA }, upcasters, before.frontier);
    // The resumed reading says the tail did not move, and the full reading of the very
    // same bytes finds a break. THIS IS THE LIMIT, stated as the disagreement it is.
    expect(arrived.suffix).toBe(true);
    expect(arrived.suffix === true && arrived.events).toHaveLength(0);
    expect(chainReplay({ root: rootA }, upcasters).linkBreaks).toHaveLength(1);
  });

  /**
   * AND THE LIMIT NEVER BECOMES A WRONG ANSWER, which is the part that matters more.
   *
   * Inserting below the boundary shifts every entry after it forward, so entries a
   * previous reading already took can end up starting past the boundary byte. Handing
   * those back as arrivals would append events the order already holds — a projection
   * counting one fact twice, which is worse than not being told about a break. The
   * chaining rule is what stops it: their seqs do not continue from the frontier, so
   * the answer is a refusal and the caller replays.
   */
  it('never serves an entry it already read as an arrival', () => {
    const before = seeded();
    const tails = join(rootA, 'tails');
    const tail = readdirSync(tails)[0] as string;
    const file = join(tails, tail, '000001.jsonl');
    const lines = readFileSync(file, 'utf-8').trimEnd().split('\n');
    // The tail's OWN first entry, written many times over just after itself: real
    // stored lines, the way the product writes them, and enough of them that the shift
    // is guaranteed to push the tail's last entries past the boundary byte rather than
    // leaving them below it.
    const shift = Array.from({ length: 8 }, () => lines[0] as string);
    writeFileSync(
      file,
      `${[lines[0] as string, ...shift, ...lines.slice(1)].join('\n')}\n`,
      'utf-8',
    );

    const arrived = chainArrivals({ root: rootA }, upcasters, before.frontier);
    const served =
      arrived.suffix === true ? arrived.events.map((event) => event.subject) : ['<refused>'];
    // Whatever it answers, it does not hand back a subject the order already carries.
    expect(served).not.toContain('t-1');
    expect(served).not.toContain('t-2');
    expect(served).not.toContain('t-3');
  });

  // The boundary is a BYTE offset, so a tail carrying anything outside ASCII would put
  // it in the wrong place if the walk ever measured a line in characters.
  it('resumes correctly over a tail whose entries carry multi-byte text', () => {
    const w = openChainForWriting(rootA, { keyRoot: rootA });
    w.append(
      taskCreated(env('t-1', '2026-07-21T00:00:00.000Z'), { title: 'ação • 日本語 — ünïcodé' }),
    );
    const before = chainReplay({ root: rootA }, upcasters);
    w.append(taskCreated(env('t-2', '2026-07-21T00:00:01.000Z'), { title: 'segundo — 漢字' }));

    const arrived = chainArrivals({ root: rootA }, upcasters, before.frontier);
    expect(arrived.suffix).toBe(true);
    expect(arrived.suffix === true && arrived.events.map((e) => e.subject)).toEqual(['t-2']);
  });
});
