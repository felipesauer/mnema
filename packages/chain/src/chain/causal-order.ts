/**
 * The one order every reader of many tails folds: `seq` inside a tail, and across tails the
 * head with the smallest `at` among those whose citations have already been taken.
 *
 * WHY ONE FUNCTION. The rule used to live in three copies — the projection's merge, the
 * enrolment fold's, and the second reader's — and a rule in three places is three chances to
 * drift. The two in this language are this function now; the third is the second reader's,
 * held to this one by the differential tests.
 *
 * THE RULE (FORMAT.md, "Reading many tails"). Each tail is a queue read from `seq` 0. At every
 * step a tail's HEAD — its first unread entry — is READY when every entry it cites in `after`
 * has already been taken. Among the ready heads the one with the smallest `at` goes next; a
 * tie goes to the smaller tree position, compared as a NUMBER, and then to the smaller tail
 * id, compared as text. Nothing here ever compares two entries of one tail: `seq` has put
 * them in order, and that order is never overridden.
 *
 * WHAT A CITATION CAN AND CANNOT DO. It only ever holds its own event back — and with it the
 * rest of its tail — until what it cites has been taken; it never moves anything of anyone
 * else earlier. The writer already controls its own `at`, which moves its events either way,
 * so a citation gives no capability a writer did not have.
 *
 * A CITATION RESOLVES INSIDE ITS OWN TREE. A writer cites the heads of the tails of the record
 * it writes to, so a hash is looked up among the entries of the citing entry's tree and
 * nowhere else. That is what keeps merging several trees the same as merging each tree and
 * then the trees: a citation can only reorder a tree against itself.
 *
 * TWO THINGS THE ORDER IGNORES, AND SAYS.
 *   - A citation of a hash the tree does not hold (a clone that lacks a tail, a tail that was
 *     cut) is ignored, and returned in {@link CausalOrder.notHeld} for the census to say.
 *   - If no head is ready, the smallest `at` among all of them goes anyway. That takes a cycle
 *     of citations, and a cycle takes a SHA-256 collision: a cited hash existed before the
 *     entry citing it was written. It is counted in {@link CausalOrder.forced} all the same,
 *     because a reader needs an answer that does not depend on the impossible not happening.
 *
 * WITHOUT A SINGLE CITATION the order is exactly the one before citations existed, and it
 * costs what it cost: no hash is indexed, and the walk is the plain selection of heads.
 */

/** One tail as the merge reads it: where it sorts in a tie, and how many entries it holds. */
export interface TailToOrder {
  /** The position of the tree the tail was read from — first in a tie, compared as a number. */
  readonly tree: number;
  /** The tail id — second in a tie, compared as text (by UTF-16 code unit). */
  readonly tail: string;
  /** How many entries the tail holds, in `seq` order from position 0. */
  readonly length: number;
}

/**
 * What the merge needs of each entry, asked by the index of its tail and its position there:
 * its instant, its entry hash, and what it cites. By position, so a caller hands over the
 * arrays it already holds and nothing is built per entry.
 */
export interface OrderKeys {
  at(tail: number, position: number): string;
  hash(tail: number, position: number): string;
  after(tail: number, position: number): readonly string[] | undefined;
}

/** A citation the order ignored because its tree holds no entry with that hash. */
export interface CitationNotHeld {
  /** Index, into the tails handed in, of the tail whose entry cites. */
  readonly tail: number;
  /** Position of the citing entry inside its tail. */
  readonly position: number;
  /** The hash cited. */
  readonly hash: string;
}

/** A citation the order honoured: who cites, and the entry cited. */
export interface CitationHeld {
  readonly tail: number;
  readonly position: number;
  readonly citedTail: number;
  readonly citedPosition: number;
}

/** One merge of many tails. */
export interface CausalOrder {
  /**
   * The order, one step per entry: the index of the tail whose next entry is taken at that
   * step. A caller walks its own cursors with it, so the order costs one number per entry.
   */
  readonly steps: readonly number[];
  /** Every citation of a hash its tree does not hold, in tail order and then position. */
  readonly notHeld: readonly CitationNotHeld[];
  /** Every citation that named an entry of its tree, in tail order and then position. */
  readonly held: readonly CitationHeld[];
  /** How many steps took a head that was not ready, because none was. */
  readonly forced: number;
}

interface Located {
  readonly tail: number;
  readonly position: number;
}

/** Merges `tails` into one total, deterministic order, honouring every citation it can. */
export function causalOrder(tails: readonly TailToOrder[], keys: OrderKeys): CausalOrder {
  const cursors = tails.map(() => 0);
  const cited = new Set<string>();
  tails.forEach(({ length }, tail) => {
    for (let position = 0; position < length; position += 1) {
      for (const hash of keys.after(tail, position) ?? []) cited.add(hash);
    }
  });

  // What each head waits on, by tail index and position. Built only when something cites.
  const waits: (readonly (readonly Located[])[] | undefined)[] = tails.map(() => undefined);
  const notHeld: CitationNotHeld[] = [];
  const held: CitationHeld[] = [];
  if (cited.size > 0) {
    // Where each cited hash sits, per tree: a citation resolves in its own tree only.
    const where = new Map<string, Located[]>();
    tails.forEach(({ tree, length }, tail) => {
      for (let position = 0; position < length; position += 1) {
        const hash = keys.hash(tail, position);
        if (!cited.has(hash)) continue;
        const key = `${tree}:${hash}`;
        const found = where.get(key);
        if (found === undefined) where.set(key, [{ tail, position }]);
        else found.push({ tail, position });
      }
    });
    tails.forEach(({ tree, length }, tail) => {
      let any = false;
      const perEntry: Located[][] = [];
      for (let position = 0; position < length; position += 1) {
        const on: Located[] = [];
        for (const hash of keys.after(tail, position) ?? []) {
          const found = where.get(`${tree}:${hash}`);
          if (found === undefined) {
            notHeld.push({ tail, position, hash });
            continue;
          }
          for (const at of found) {
            on.push(at);
            held.push({ tail, position, citedTail: at.tail, citedPosition: at.position });
          }
        }
        if (on.length > 0) any = true;
        perEntry.push(on);
      }
      if (any) waits[tail] = perEntry;
    });
  }

  const ready = (tail: number): boolean => {
    const on = waits[tail]?.[cursors[tail] as number];
    if (on === undefined) return true;
    return on.every((at) => (cursors[at.tail] as number) > at.position);
  };

  // Without a citation that resolves, every head is ready, and the walk is the selection of
  // heads it always was — nothing asked per step that it did not ask before.
  const waiting = waits.some((on) => on !== undefined);
  const steps: number[] = [];
  let forced = 0;
  for (;;) {
    let chosen = pick(tails, cursors, keys, waiting ? ready : undefined);
    if (chosen < 0 && waiting) {
      chosen = pick(tails, cursors, keys, undefined);
      if (chosen >= 0) forced += 1;
    }
    if (chosen < 0) break;
    steps.push(chosen);
    cursors[chosen] = (cursors[chosen] as number) + 1;
  }
  return { steps, notHeld, held, forced };
}

/** The tail whose head goes next among those `ready` admits (all, when undefined), or -1. */
function pick(
  tails: readonly TailToOrder[],
  cursors: readonly number[],
  keys: OrderKeys,
  ready: ((tail: number) => boolean) | undefined,
): number {
  let chosen = -1;
  for (let tail = 0; tail < tails.length; tail += 1) {
    if ((cursors[tail] as number) >= (tails[tail] as TailToOrder).length) continue;
    if (ready !== undefined && !ready(tail)) continue;
    if (chosen < 0 || precedes(tails, cursors, keys, tail, chosen)) chosen = tail;
  }
  return chosen;
}

/** Whether the head of tail `a` goes before the head of tail `b`: `at`, then tree, then tail. */
function precedes(
  tails: readonly TailToOrder[],
  cursors: readonly number[],
  keys: OrderKeys,
  a: number,
  b: number,
): boolean {
  const atA = keys.at(a, cursors[a] as number);
  const atB = keys.at(b, cursors[b] as number);
  if (atA !== atB) return atA < atB;
  const ta = tails[a] as TailToOrder;
  const tb = tails[b] as TailToOrder;
  if (ta.tree !== tb.tree) return ta.tree < tb.tree;
  return ta.tail < tb.tail;
}
