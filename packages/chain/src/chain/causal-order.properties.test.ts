/**
 * The order citations give, held as PROPERTIES over generated tails — the sentences FORMAT.md
 * writes under "Reading many tails", each against a model a few lines long written here.
 *
 * WHAT IS DRAWN. A history of writes: each write lands on a drawn tail of a drawn tree, at a
 * drawn instant from a small range (ties are the case the tie-break exists for, and an instant
 * drawn freely is a clock that disagrees with every other), and may cite the heads the other
 * tails of its tree had at that moment — what the product's writer does. So every citation
 * names an entry that existed before the entry citing it, and the instants say nothing about
 * that.
 *
 * WHAT EACH CASE NAMES:
 *   - R1, an entry is never taken before what it cites, whatever the instants;
 *   - R2, with no citation the order is exactly the selection of heads by `at` that it was
 *     before citations existed;
 *   - R3, adding a citation moves nothing that does not depend on the citing entry;
 *   - R4, a citation of a hash the tree does not hold changes nothing;
 *   - R8, merging trees is merging each tree and then the trees, by the same comparison.
 *
 * Pure: no disk, so the runs are many. The seed is fixed (`FC_SEED` explores another).
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { causalOrder, type OrderKeys, type TailToOrder } from './causal-order.js';

const SEED = Number(process.env.FC_SEED ?? 20_261_007);
const RUNS = 300;

/** One entry as drawn: its instant, its hash, and what it cites. */
interface Drawn {
  readonly at: string;
  readonly hash: string;
  readonly after?: readonly string[];
}

interface DrawnTail {
  readonly tree: number;
  readonly tail: string;
  readonly entries: Drawn[];
}

const instant = (second: number): string =>
  new Date(Date.UTC(2026, 9, 7, 10, 0, second)).toISOString();

/** One write: which tree, which tail of it, when by the writer's clock, and whether it cites. */
interface Write {
  readonly tree: number;
  readonly tail: number;
  readonly at: number;
  readonly cites: boolean;
}

const writeArb: fc.Arbitrary<Write> = fc.record({
  tree: fc.nat({ max: 1 }),
  tail: fc.nat({ max: 2 }),
  at: fc.nat({ max: 5 }),
  cites: fc.boolean(),
});

/** Plays a history of writes into tails, each citing the heads it saw when it chose to. */
function play(writes: readonly Write[]): DrawnTail[] {
  const tails = new Map<string, DrawnTail>();
  let n = 0;
  for (const write of writes) {
    const id = `t${write.tail}`;
    const key = `${write.tree}:${id}`;
    let tail = tails.get(key);
    if (tail === undefined) {
      tail = { tree: write.tree, tail: id, entries: [] };
      tails.set(key, tail);
    }
    const heads = write.cites
      ? [...tails.values()]
          .filter((other) => other !== tail && other.tree === write.tree)
          .map((other) => other.entries.at(-1)?.hash)
          .filter((hash): hash is string => hash !== undefined)
          .sort()
      : [];
    n += 1;
    tail.entries.push({
      at: instant(write.at),
      hash: `${String(n).padStart(4, '0')}${'0'.repeat(60)}`,
      ...(heads.length > 0 ? { after: heads } : {}),
    });
  }
  return [...tails.values()];
}

const historyArb = fc.array(writeArb, { maxLength: 18 }).map(play);

const keysOf = (tails: readonly DrawnTail[]): OrderKeys => ({
  at: (tail, position) => (tails[tail] as DrawnTail).entries[position]?.at as string,
  hash: (tail, position) => (tails[tail] as DrawnTail).entries[position]?.hash as string,
  after: (tail, position) => (tails[tail] as DrawnTail).entries[position]?.after,
});

const shapes = (tails: readonly DrawnTail[]): TailToOrder[] =>
  tails.map(({ tree, tail, entries }) => ({ tree, tail, length: entries.length }));

/** The order as hashes. */
function ordered(tails: readonly DrawnTail[]): string[] {
  const cursors = tails.map(() => 0);
  return causalOrder(shapes(tails), keysOf(tails)).steps.map((step) => {
    const at = cursors[step] as number;
    cursors[step] = at + 1;
    return (tails[step] as DrawnTail).entries[at]?.hash as string;
  });
}

/**
 * THE MODEL of the order before citations: re-sort the heads at every step by `at`, then
 * tree as a number, then tail id; take the first. Quadratic, and nothing like a cursor walk.
 */
function selectionByAt(tails: readonly DrawnTail[]): string[] {
  const queues = tails.map((tail) => ({ ...tail, left: [...tail.entries] }));
  const out: string[] = [];
  for (;;) {
    const live = queues.filter((queue) => queue.left.length > 0);
    if (live.length === 0) return out;
    live.sort((a, b) => {
      const atA = (a.left[0] as Drawn).at;
      const atB = (b.left[0] as Drawn).at;
      if (atA !== atB) return atA < atB ? -1 : 1;
      if (a.tree !== b.tree) return a.tree - b.tree;
      return a.tail < b.tail ? -1 : a.tail > b.tail ? 1 : 0;
    });
    out.push(((live[0] as (typeof live)[number]).left.shift() as Drawn).hash);
  }
}

const withoutCitations = (tails: readonly DrawnTail[]): DrawnTail[] =>
  tails.map((tail) => ({
    ...tail,
    entries: tail.entries.map(({ at, hash }) => ({ at, hash })),
  }));

function holds<T>(arbitrary: fc.Arbitrary<T>, predicate: (value: T) => void): void {
  fc.assert(fc.property(arbitrary, predicate), { seed: SEED, numRuns: RUNS });
}

describe('the order a citation gives', () => {
  it('R1: an entry is never taken before what it cites, whatever the instants say', () => {
    holds(historyArb, (tails) => {
      const order = ordered(tails);
      const place = new Map(order.map((hash, index) => [hash, index]));
      for (const tail of tails) {
        for (const entry of tail.entries) {
          for (const cited of entry.after ?? []) {
            expect(place.get(cited) as number).toBeLessThan(place.get(entry.hash) as number);
          }
        }
      }
    });
  });

  it('R2: with no citation, the order is exactly the selection of heads by at of before', () => {
    holds(historyArb, (drawn) => {
      const tails = withoutCitations(drawn);
      expect(ordered(tails)).toEqual(selectionByAt(tails));
    });
  });

  it('R3: a citation added to an entry moves nothing that does not depend on that entry', () => {
    holds(fc.tuple(historyArb, fc.nat(), fc.nat()), ([tails, pickCiting, pickCited]) => {
      const all = tails.flatMap((tail, t) => tail.entries.map((entry, p) => ({ t, p, entry })));
      if (all.length < 2) return;
      const citing = all[pickCiting % all.length] as (typeof all)[number];
      const earlier = all.filter(
        (other) =>
          other.t !== citing.t &&
          (tails[other.t] as DrawnTail).tree === (tails[citing.t] as DrawnTail).tree &&
          other.entry.hash < citing.entry.hash,
      );
      if (earlier.length === 0) return;
      const cited = earlier[pickCited % earlier.length] as (typeof earlier)[number];
      const after = [...new Set([...(citing.entry.after ?? []), cited.entry.hash])].sort();
      const changed = tails.map((tail, t) => ({
        ...tail,
        entries: tail.entries.map((entry, p) =>
          t === citing.t && p === citing.p ? { ...entry, after } : entry,
        ),
      }));
      // What depends on the citing entry: it, what follows it on its tail, and whatever cites
      // any of those — closed, since a dependant's own tail followers depend on it too.
      const moved = new Set<string>();
      const grow = (t: number, from: number) => {
        for (const entry of (changed[t] as DrawnTail).entries.slice(from)) moved.add(entry.hash);
      };
      grow(citing.t, citing.p);
      for (let grew = true; grew; ) {
        grew = false;
        changed.forEach((tail, t) => {
          tail.entries.forEach((entry, p) => {
            if (moved.has(entry.hash)) return;
            if ((entry.after ?? []).some((hash) => moved.has(hash))) {
              grow(t, p);
              grew = true;
            }
          });
        });
      }
      const rest = (order: string[]) => order.filter((hash) => !moved.has(hash));
      const before = ordered(tails);
      const now = ordered(changed);
      expect(rest(now)).toEqual(rest(before));
      // And nothing that depends on it comes earlier than it did.
      for (const hash of moved) {
        expect(now.indexOf(hash)).toBeGreaterThanOrEqual(before.indexOf(hash));
      }
    });
  });

  it('R4: a citation of a hash the tree does not hold changes nothing, and is returned', () => {
    holds(fc.tuple(historyArb, fc.nat()), ([tails, pick]) => {
      const all = tails.flatMap((tail, t) => tail.entries.map((_, p) => ({ t, p })));
      if (all.length === 0) return;
      const { t, p } = all[pick % all.length] as (typeof all)[number];
      const missing = 'f'.repeat(64);
      const changed = tails.map((tail, i) => ({
        ...tail,
        entries: tail.entries.map((entry, j) =>
          i === t && j === p
            ? { ...entry, after: [...(entry.after ?? []), missing].sort() }
            : entry,
        ),
      }));
      expect(ordered(changed)).toEqual(ordered(tails));
      const merged = causalOrder(shapes(changed), keysOf(changed));
      expect(merged.notHeld).toContainEqual({ tail: t, position: p, hash: missing });
    });
  });

  it('R8: merging the trees is merging each tree and then the trees, by at and then position', () => {
    holds(historyArb, (tails) => {
      // A citation of another tree is not one a writer makes, and the order ignores it: a hash
      // is looked up in its own tree. Plant one, so a merge that looked across trees would
      // tell itself apart here.
      const crossed = tails.map((tail) => {
        const other = tails.find((candidate) => candidate.tree !== tail.tree);
        const foreign = other?.entries[0]?.hash;
        if (foreign === undefined || tail.entries.length === 0) return tail;
        const [first, ...rest] = tail.entries as [Drawn, ...Drawn[]];
        return {
          ...tail,
          entries: [{ ...first, after: [...(first.after ?? []), foreign].sort() }, ...rest],
        };
      });
      const union = ordered(crossed);
      const trees = [...new Set(crossed.map((tail) => tail.tree))].sort((a, b) => a - b);
      const perTree = trees.map((tree) => {
        const own = crossed.filter((tail) => tail.tree === tree);
        const at = new Map(
          own.flatMap((tail) => tail.entries.map((entry) => [entry.hash, entry.at])),
        );
        return { tree, left: ordered(own), at };
      });
      const joined: string[] = [];
      for (;;) {
        const live = perTree.filter((part) => part.left.length > 0);
        if (live.length === 0) break;
        live.sort((a, b) => {
          const atA = a.at.get(a.left[0] as string) as string;
          const atB = b.at.get(b.left[0] as string) as string;
          if (atA !== atB) return atA < atB ? -1 : 1;
          return a.tree - b.tree;
        });
        joined.push((live[0] as (typeof live)[number]).left.shift() as string);
      }
      expect(union).toEqual(joined);
    });
  });
});
