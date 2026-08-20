/**
 * Reading every tail of a chain into ONE deterministic, total order of events —
 * the input a projection replays.
 *
 * The chain is per-tail by design: each machine appends to its own tail, and
 * there is NO global causal order across tails (that is what makes an offline
 * merge a no-op instead of a conflict). Two rules govern the merge:
 *
 *   - WITHIN a tail, `seq` is the true order and the hash chain proves it. That
 *     order is NEVER reordered — not even when a tail's own `at` values are not
 *     monotonic (a clock that steps back between two appends must not move a
 *     later-sequenced fact earlier). The proof, not the wall-clock, defines
 *     within-tail order.
 *   - ACROSS tails, no true order exists, so the merge picks a convention. The
 *     only thing a cache needs is that it is TOTAL and DETERMINISTIC: the same
 *     tails always fold to the same order, so a rebuild reproduces the same
 *     state every time.
 *
 * So this is a k-way merge of per-tail streams, each already in `seq` order. At
 * each step it takes the tail whose next event has the smallest `at`, breaking
 * ties by tail id then `seq`. `at` is only ever compared BETWEEN the heads of
 * different tails — an approximate, human-legible interleaving hint — and never
 * within a tail, so it can never override the proven order. A plain global sort
 * by `(at, tail, seq)` would break that: a non-monotonic `at` inside one tail
 * would reorder that tail against its own proof.
 *
 * What this order does NOT do: decide who "wins" when two tails concurrently
 * move the same entity. That is a real race, and resolving it (last-writer,
 * merge policy, conflict surfacing) is the domain's concern, layered on top.
 * This only guarantees the replay is deterministic and faithful to each tail's
 * proven order.
 */

import {
  type CatalogEvent,
  type ChainLayout,
  type Entry,
  listTails,
  orderedSegments,
  readTailEntries,
  readTailTip,
  type UpcasterRegistry,
} from '@mnema/chain';

/**
 * One tail's events in proven (`seq`) order, plus a read cursor. `key` is what
 * ties break on across tails; it is total and deterministic within one merge.
 * For a single chain it is the tail id; across trees it is qualified by tree
 * (see {@link streamsOf}) so two trees that happen to share a tail id — the same
 * person's key installs into each — still merge to one stable order.
 */
interface TailStream {
  readonly key: string;
  readonly events: readonly CatalogEvent[];
  cursor: number;
  /**
   * The tail this stream came from, and the last `seq` it held when it was read.
   * The merge reads neither — they are what {@link ChainFrontier} is made of, and
   * they ride along here so learning them costs no second reading of the tail.
   * `lastSeq` is -1 for a tail that holds nothing.
   */
  readonly tail: string;
  readonly lastSeq: number;
}

/**
 * Reads all tails and merges them into one total, deterministic order. This is
 * the single bridge from the chain to a projection: a projection consumes this
 * ordered stream and never reads tails itself.
 */
export function orderedEvents(layout: ChainLayout, upcasters: UpcasterRegistry): CatalogEvent[] {
  return chainReplay(layout, upcasters).events;
}

/**
 * How far one tail was read: the last position proven, and the segment files that
 * held it.
 *
 * BOTH, because they answer different questions and only one of them is about
 * growth. `lastSeq` says where to resume from, and -1 says the tail held nothing.
 * `segments` is what catches the chain SHRINKING: a tail's earlier segments are
 * sealed and never reopened, so the list only ever gains entries at the end — and a
 * list that is no longer a prefix of the tail's list is a tail that was cut, which is
 * the one change no suffix can describe.
 *
 * That second half also closes a hole the growth probe next door cannot see: an
 * extent names each tail's LAST segment and its size ({@link chainExtent}, "what it
 * does not see"), so removing a sealed earlier segment leaves the extent identical.
 * A retained replay measured only against the extent would go on serving events the
 * chain no longer holds.
 */
export interface TailReach {
  /** The last `seq` read from this tail, or -1 for a tail that held nothing. */
  readonly lastSeq: number;
  /** The tail's segment files, in order, as they stood when it was read. */
  readonly segments: readonly string[];
  /**
   * The greatest `at` among the events read from THIS tail, or the empty string for
   * a tail that held none. Per tail and not for the order as a whole, because the
   * only comparison the merge makes is between heads of DIFFERENT tails — see the
   * suffix test in {@link chainArrivals}.
   */
  readonly latestAt: string;
}

/**
 * How far a replay reached — the mark a later reading of the same chain measures
 * itself against.
 *
 * It is what makes "what arrived since?" answerable without reading the chain
 * again: the proven position of every tail at the moment the order was built, plus
 * the two facts {@link chainArrivals} needs to decide whether the new events form a
 * SUFFIX of that order rather than an interleave into the middle of it.
 */
export interface ChainFrontier {
  /** How far each tail was read, by tail id. */
  readonly tails: ReadonlyMap<string, TailReach>;
  /** How many events the order held — the base position of the next arrival. */
  readonly events: number;
}

/** One reading of a chain: the order it produced, and how far it reached. */
export interface ChainReplay {
  readonly events: CatalogEvent[];
  readonly frontier: ChainFrontier;
}

/**
 * Reads all tails, merges them, AND reports how far the reading reached.
 *
 * The frontier is a by-product rather than a second pass: each tail's last `seq`
 * is in hand the moment its entries are parsed, so learning it costs nothing.
 * {@link orderedEvents} is this function with the frontier dropped — one merge,
 * one reading, one order, so a caller that wants both cannot get two.
 */
export function chainReplay(layout: ChainLayout, upcasters: UpcasterRegistry): ChainReplay {
  const streams = streamsOf(layout, upcasters, '');
  const tails = new Map<string, TailReach>();
  for (const stream of streams) {
    // One `readdir` per tail beside the reading of it. A replay parses every line of
    // every segment, so listing their names again is not a cost worth avoiding — and
    // the list is what a later reading needs to know the chain did not shrink.
    tails.set(stream.tail, {
      lastSeq: stream.lastSeq,
      segments: orderedSegments(layout, stream.tail),
      latestAt: latestAt(stream.events),
    });
  }
  const events = mergeStreams(streams);
  return { events, frontier: { tails, events: events.length } };
}

/** What a chain holds beyond a frontier, when that can be said as a suffix. */
export type ChainArrivals =
  | {
      /** The order the frontier covered is a PREFIX of the order now — these follow it. */
      readonly suffix: true;
      /** The arrivals, in the same merge the whole order would have put them in. */
      readonly events: readonly CatalogEvent[];
      /** How far the chain reaches now: the frontier a caller records after using these. */
      readonly frontier: ChainFrontier;
    }
  | {
      /** No suffix describes the difference — the whole order has to be read again. */
      readonly suffix: false;
      /** Which of the three ways that happens, for the caller that reports it. */
      readonly why: 'A_TAIL_IS_GONE' | 'A_TAIL_WAS_CUT' | 'AN_ARRIVAL_IS_NOT_LATER';
    };

/**
 * What the chain holds beyond `frontier` — as a SUFFIX of the order that frontier
 * covered, or a refusal saying no suffix describes it.
 *
 * It costs the arrivals and not the chain: per tail it reads only the entries above
 * the proven position the frontier recorded ({@link readTailTip}, whose cost is the
 * entries returned and not the file they sit in). A chain that did not move is one
 * boundary entry per tail.
 *
 * WHY A SUFFIX AND NOT JUST "THE NEW EVENTS". The merge places an event by its `at`
 * against the heads of every other tail, so a tail that arrives holding an OLDER
 * event lands in the middle of the order and every position after it shifts. A
 * caller that has already materialized the covered order by position — the reference
 * index is one row per position — would then be holding rows that name the wrong
 * events.
 *
 * SO THE TEST IS THE MERGE'S OWN COMPARISON, and it is per TAIL rather than over the
 * order as a whole. Within one tail nothing has to be tested at all: `seq` is the
 * order and an arrival's `seq` is above everything covered, so it follows by proof
 * whatever its `at` says — which is the same reason the merge never compares two
 * events of one tail. What has to be tested is an arrival against the covered events
 * of the OTHER tails, and there the comparison is `(at, tail)`, exactly as
 * {@link headPrecedes} makes it.
 *
 * That distinction is not a refinement, it is what makes the fast path reachable.
 * The first version of this test compared every arrival against the greatest `at` in
 * the whole order and refused a tie — and a tie is the COMMON case: `at` has
 * millisecond resolution, and a session appending twice inside one millisecond ties
 * with itself. Measured, that refused the suffix on a run of appends to a single tail
 * and replayed the chain every time, which is the whole cost this was built to avoid.
 * A one-tail chain — one machine, one key, which is most of them — now always has a
 * suffix.
 *
 * Three ways the answer is no, and each is a real thing that happens rather than a
 * defensive branch:
 *   - `A_TAIL_IS_GONE` — a tail the replay covered is not there any more. The chain
 *     did not grow, it changed.
 *   - `A_TAIL_WAS_CUT` — the tail lost a segment it had, or no longer holds the entry
 *     the replay ended on. A cut is what `mnema tail prune` authorizes and what a
 *     person then carries out, and it removes SEALED segments — so it is caught by
 *     the segment list rather than by the resume point, which sits above it and would
 *     see nothing.
 *   - `AN_ARRIVAL_IS_NOT_LATER` — an arrival does not follow the covered events of the
 *     other tails under the merge's own comparison. Ordinary in a pulled clone, whose
 *     tail carries a colleague's older facts, and ordinary from a clock that stepped
 *     back.
 *
 * The caller's move in all three is the same and is not this function's to make: read
 * the whole chain again.
 */
export function chainArrivals(
  layout: ChainLayout,
  upcasters: UpcasterRegistry,
  frontier: ChainFrontier,
): ChainArrivals {
  const tails = listTails(layout);
  const present = new Set(tails);
  for (const tail of frontier.tails.keys()) {
    if (!present.has(tail)) return { suffix: false, why: 'A_TAIL_IS_GONE' };
  }

  const streams: TailStream[] = [];
  const reached = new Map(frontier.tails);
  for (const tail of tails) {
    const covered = frontier.tails.get(tail);
    const segments = orderedSegments(layout, tail);
    if (covered !== undefined && !startsWith(segments, covered.segments)) {
      return { suffix: false, why: 'A_TAIL_WAS_CUT' };
    }
    // A tail nothing was read from — one that appeared, or one that was empty when
    // the frontier was taken — contributes all of itself. `readTailTip` would do the
    // same walk with no boundary to stop at, so this asks for the whole tail plainly.
    const entries =
      covered === undefined || covered.lastSeq < 0
        ? readTailEntries(layout, tail, upcasters)
        : aboveBoundary(readTailTip(layout, tail, upcasters, covered.lastSeq), covered.lastSeq);
    if (entries === undefined) return { suffix: false, why: 'A_TAIL_WAS_CUT' };
    const lastSeq =
      entries.length === 0
        ? (covered?.lastSeq ?? -1)
        : (entries[entries.length - 1] as Entry).link.seq;
    const fresh = entries.map((entry) => entry.event);
    reached.set(tail, {
      lastSeq,
      segments,
      latestAt: greater(covered?.latestAt ?? '', latestAt(fresh)),
    });
    if (fresh.length === 0) continue;
    // The arrivals of this tail must follow the covered events of every OTHER tail,
    // under the comparison the merge makes between heads. Nothing is asked about this
    // tail's own covered events: `seq` already settles those.
    for (const event of fresh) {
      for (const [other, reach] of frontier.tails) {
        if (other === tail || reach.latestAt === '') continue;
        if (reach.latestAt > event.at) return { suffix: false, why: 'AN_ARRIVAL_IS_NOT_LATER' };
        // The tie the merge breaks on the tail id: an arrival that ties with a covered
        // event of a tail that sorts LATER would be placed before it.
        if (reach.latestAt === event.at && other > tail) {
          return { suffix: false, why: 'AN_ARRIVAL_IS_NOT_LATER' };
        }
      }
    }
    streams.push({ key: tail, events: fresh, cursor: 0, tail, lastSeq });
  }

  // The SAME merge the whole order goes through, over the arrivals alone. It is the
  // same function and the same keys, which is what makes the result the tail of the
  // order rather than a second convention for interleaving.
  const events = mergeStreams(streams);
  return {
    suffix: true,
    events,
    frontier: { tails: reached, events: frontier.events + events.length },
  };
}

/** The greater of two instants — the per-tail high-water mark, carried forward. */
function greater(a: string, b: string): string {
  return a > b ? a : b;
}

/** Whether `list` begins with `prefix` — the segment test, and nothing more. */
function startsWith(list: readonly string[], prefix: readonly string[]): boolean {
  if (prefix.length > list.length) return false;
  return prefix.every((name, index) => list[index] === name);
}

/**
 * The entries of a tip strictly above the boundary, or undefined when the tip does
 * not hold the boundary at all.
 *
 * {@link readTailTip} keeps the entry it stopped on, and that kept entry is the
 * PROOF the tail still holds what was covered: seqs are contiguous along a tail, so
 * the only way an entry at exactly `covered` is missing is that the tail was cut
 * below it. Its absence is therefore a fact and not an edge case.
 */
function aboveBoundary(tip: readonly Entry[], covered: number): Entry[] | undefined {
  if (tip.length === 0) return undefined;
  if ((tip[0] as Entry).link.seq !== covered) return undefined;
  return tip.slice(1);
}

/** The greatest `at` in an order, or the empty string when it holds nothing. */
function latestAt(events: readonly CatalogEvent[]): string {
  let latest = '';
  for (const event of events) {
    if (event.at > latest) latest = event.at;
  }
  return latest;
}

/** Several chains ordered two ways, from ONE reading of their tails. */
export interface RecordOrder {
  /**
   * Each chain on its own, in the order {@link orderedEvents} gives it — the view
   * of a question whose answer is a property of ONE chain rather than of the
   * record as a whole. One entry per layout, in the caller's order; a chain with
   * no tails contributes an empty entry rather than dropping out, so the entries
   * still line up with the layouts.
   */
  readonly chains: readonly (readonly CatalogEvent[])[];
  /**
   * ALL of the chains' tails in one total, deterministic order — the union a person
   * sees across their trees (project-public, project-private, global). Every tail
   * from every chain joins ONE k-way merge, so there is no cross-tree precedence:
   * an event's place is decided by its own `at` against every other head, the same
   * rule that orders tails within a chain. Two trees never collide on the same
   * event id (ids are minted v7), so this is a plain interleave with no
   * de-duplication.
   */
  readonly across: readonly CatalogEvent[];
}

/**
 * Reads the tails of `layouts` ONCE and orders them both ways: each chain by
 * itself, and all of them together.
 *
 * BOTH, from one reading, because reading is the expensive half and the callers that
 * want the union want the chains too. A question about the record as a whole folds
 * `across`; a question whose answer is a property of one chain — the `ADR-<n>` label,
 * numbered from the writer's view of a single chain — folds `chains`. The second order
 * is a walk over streams already in memory, so it costs a walk rather than a second
 * parse of every segment.
 *
 * It replaced a narrower `orderedEventsAcross` that gave the union alone. When the
 * audit came to need both views, that function's every production caller became a
 * caller of this one, and a public value with no caller is the defect the workspace
 * guards against — so the union kept its behaviour and lost its own name. What guards
 * that behaviour now is `topology/compose.test.ts`, which asserts the interleave, the
 * determinism and the absence of id collisions over three trees.
 *
 * Each layout is tagged with an index so tie-breaking stays deterministic even when
 * two trees share a tail id (one key installed into each). Absent or empty chains
 * contribute no streams — a caller can pass every candidate tree and let the ones
 * that do not exist drop out — but they still hold their place in `chains`.
 *
 * A chain's own order is the one {@link orderedEvents} gives it, and that is asserted
 * rather than assumed (`order.test.ts`, "orders each chain exactly as `orderedEvents`
 * does"). The per-chain tie-break key is qualified here where that function leaves it
 * bare, which cannot change a within-chain order: every stream of one chain gets the
 * same qualifier, so their keys compare exactly as their tail ids do.
 */
export function orderedEventsOfRecord(
  layouts: readonly ChainLayout[],
  upcasters: UpcasterRegistry,
): RecordOrder {
  const perChain = layouts.map((layout, index) => streamsOf(layout, upcasters, `${index}:`));
  return {
    chains: perChain.map((streams) => mergeStreams(rewound(streams))),
    across: mergeStreams(rewound(perChain.flat())),
  };
}

/**
 * The same streams with fresh cursors — one read, several merges. It copies the
 * cursor and SHARES the events, because draining a stream is what consumes it and
 * the events are what cost something to obtain.
 */
function rewound(streams: readonly TailStream[]): TailStream[] {
  return streams.map((stream) => ({
    key: stream.key,
    events: stream.events,
    cursor: 0,
    tail: stream.tail,
    lastSeq: stream.lastSeq,
  }));
}

/**
 * Builds the per-tail streams of one chain. `prefix` qualifies each stream's
 * tie-break key so streams from different trees never share a key even when they
 * share a tail id. Within one chain the prefix is empty, preserving the exact
 * single-chain order (tail id alone).
 */
function streamsOf(layout: ChainLayout, upcasters: UpcasterRegistry, prefix: string): TailStream[] {
  return listTails(layout).map((tail) => {
    const entries = readTailEntries(layout, tail, upcasters);
    return {
      key: `${prefix}${tail}`,
      events: entries.map((entry) => entry.event),
      cursor: 0,
      tail,
      lastSeq: entries.length === 0 ? -1 : (entries[entries.length - 1] as Entry).link.seq,
    };
  });
}

/** Drains streams into one order by repeatedly taking the earliest head. */
function mergeStreams(streams: TailStream[]): CatalogEvent[] {
  const merged: CatalogEvent[] = [];
  for (;;) {
    const next = pickNextStream(streams);
    if (next === undefined) break;
    merged.push(next.events[next.cursor] as CatalogEvent);
    next.cursor += 1;
  }
  return merged;
}

/**
 * Chooses the stream to take the next event from: the one whose head has the
 * smallest `at`, ties broken by stream key (deterministic). Returns undefined
 * when every stream is drained. Consuming heads in this way preserves each
 * tail's `seq` order untouched — only heads of DIFFERENT tails are compared.
 */
function pickNextStream(streams: readonly TailStream[]): TailStream | undefined {
  let chosen: TailStream | undefined;
  for (const stream of streams) {
    if (stream.cursor >= stream.events.length) continue;
    if (chosen === undefined || headPrecedes(stream, chosen)) {
      chosen = stream;
    }
  }
  return chosen;
}

/** True if `a`'s head should come before `b`'s: by `at`, then stream key. */
function headPrecedes(a: TailStream, b: TailStream): boolean {
  const atA = (a.events[a.cursor] as CatalogEvent).at;
  const atB = (b.events[b.cursor] as CatalogEvent).at;
  if (atA !== atB) return atA < atB;
  return a.key < b.key;
}
