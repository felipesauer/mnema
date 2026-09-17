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
  firstLinkBreakFrom,
  type LinkBreak,
  listTails,
  orderedSegments,
  readTail,
  readTailSince,
  type TailBoundary,
  type UpcasterRegistry,
} from '@mnema/chain';

/**
 * One tail's events in proven (`seq`) order, plus a read cursor. `key` is what
 * ties break on across tails; it is total and deterministic within one merge.
 * For a single chain it is the tail id; across trees it is qualified by tree
 * (see {@link streamsOf}) so two trees that happen to share a tail id — the same
 * person's key installs into each — still merge to one stable order.
 */
/**
 * What a reading of one tail contributed, and where it left off — the shape both the
 * resumed reading and the whole one answer in, so {@link chainArrivals} has one case.
 */
interface ReadSoFar {
  readonly arrivals: readonly Entry[];
  readonly boundary: TailBoundary | undefined;
}

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
  /**
   * The hash of the last entry read from this tail, or null for a tail that held none —
   * what the next entry has to name as its `prev`. It rides along for the same reason
   * `lastSeq` does: the reading had it in hand.
   */
  readonly lastHash: string | null;
  /**
   * Where the reading of this tail stopped, in bytes — undefined for a tail that held
   * nothing. It rides along for the same reason `lastSeq` does: the reading had it.
   */
  readonly boundary?: TailBoundary;
  /** Where this tail stopped chaining, if it did — carried with the reading of it. */
  readonly linkBreak?: LinkBreak;
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
  /**
   * The last `seq` read from this tail, or -1 for a tail that held nothing.
   *
   * It says what the arrivals must CONTINUE from, and nothing else. It used to say
   * where to resume READING from as well, and that is the premise {@link boundary}
   * falsified — see there.
   */
  readonly lastSeq: number;
  /**
   * The hash of the last entry read from this tail, or null for a tail that held none —
   * what the FIRST arrival has to name as its `prev`.
   *
   * IT IS HERE BECAUSE THE SEQ IS ONLY TWO THIRDS OF THE RULE. A tail stops chaining in
   * three ways ({@link linkBreakAt}) — an entry stored under a tail it does not name, a
   * seq that does not follow, and a `prev` that names something other than the entry
   * before it — and the frontier used to carry what answers the first two. Measured, that
   * left the third invisible to every incremental reading: over a tail whose entry at the
   * boundary had been replaced by a DIFFERENT entry of the same seq, a fresh
   * {@link chainReplay} reported a `prev-hash break` and {@link chainArrivals} called the
   * same bytes a sound suffix. It is the same shape of hole {@link TailReach.boundary}
   * closed for duplicates, one rule over.
   *
   * The reading has it: the hash is on the entry it just parsed, so carrying it costs
   * nothing and asking for it later would cost a second reading of the tail.
   */
  readonly lastHash: string | null;
  /**
   * WHERE the reading stopped, in bytes — the position the arrivals are read from.
   * Undefined for a tail that held nothing, which has no position to name.
   *
   * THE SEQ USED TO BE BOTH, AND THAT WAS THE HOLE. Resuming from `lastSeq` means
   * asking the tail for the entries above it, and the walk that answers stops at the
   * first entry CARRYING that seq — which a duplicate of the boundary entry satisfies.
   * Measured, over a tail whose last entry was appended a second time, a full replay
   * reported ONE break while a resumed reading reported that nothing had arrived at
   * all. Resumed from the BYTE, that duplicate is past the boundary, so it is an
   * arrival like any other and {@link chainArrivals} rules on it with the same rule it
   * applies to everything else. `order.test.ts` ("a resumed reading sees a duplicate of
   * the boundary entry") holds it.
   */
  readonly boundary: TailBoundary | undefined;
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
  /**
   * The tails that do not chain — one entry per tail, the FIRST break in each.
   *
   * It rides on the replay rather than being asked for separately because that is
   * what keeps it from being optional in practice: the events and the fact that the
   * events do not add up come off the same reading, so a caller cannot take one and
   * forget the other existed. Empty on an intact record, which is every record the
   * product writes on its own.
   */
  readonly linkBreaks: readonly LinkBreak[];
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
      lastHash: stream.lastHash,
      boundary: stream.boundary,
      segments: orderedSegments(layout, stream.tail),
      latestAt: latestAt(stream.events),
    });
  }
  const events = mergeStreams(streams);
  const linkBreaks = streams
    .map((stream) => stream.linkBreak)
    .filter((broken): broken is LinkBreak => broken !== undefined);
  return { events, frontier: { tails, events: events.length }, linkBreaks };
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
      /**
       * Which of the three ways that happens, for the caller that reports it. The record
       * itself is intact in all three: a tail was removed, cut, or carries facts older
       * than what is already covered.
       */
      readonly why: 'A_TAIL_IS_GONE' | 'A_TAIL_WAS_CUT' | 'AN_ARRIVAL_IS_NOT_LATER';
    }
  | {
      /**
       * The arrivals do not run on from the frontier: the record's own proof is broken,
       * and this is the one refusal that is about the RECORD rather than about the shape
       * of the difference.
       */
      readonly suffix: false;
      readonly why: 'AN_ARRIVAL_DOES_NOT_CHAIN';
      /**
       * WHERE it stops chaining, in the verdict's own wording — an arm of its own so that
       * a caller holding one of the other three cannot reach for a break that is not
       * there, and one holding this cannot answer without it.
       *
       * It is the first break among the ARRIVALS of the first tail that has one, which is
       * narrower than {@link ChainReplay.linkBreaks} in two ways a reader has to know: a
       * break below the frontier — bytes a previous reading already accepted — is outside
       * it, and so is a second broken tail, because this stops at the first. The full
       * reading is what enumerates.
       */
      readonly broke: LinkBreak;
    };

/**
 * What the chain holds beyond `frontier` — as a SUFFIX of the order that frontier
 * covered, or a refusal saying no suffix describes it.
 *
 * It costs the arrivals and not the chain: per tail it reads only the entries past the
 * BYTE the frontier stopped at ({@link readTailSince}, whose cost is the entries
 * returned and not the file they sit in). A chain that did not move is one entry per
 * tail — the newest, which the backward walk reads before it reaches the boundary.
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
 *   - `AN_ARRIVAL_DOES_NOT_CHAIN` — the arrivals do not run contiguously on from where
 *     the frontier stopped. This one is NOT ordinary: it is a break in the record's own
 *     proof, and it is the arm that CARRIES the break, because the reading that found it
 *     is the one holding the entry. What it names is narrower than a full reading's
 *     verdict and the arm says how ({@link ChainArrivals}); a caller that wants every
 *     broken tail reads the whole chain again.
 *
 *     IT USED TO MISS TWO SHAPES OF BREAK, one found per delivery, and neither was this
 *     rule being lenient about what it was handed.
 *
 *     The first was WHERE THE ARRIVALS WERE READ FROM. A tail resumed from its last
 *     `seq` yields nothing when its boundary entry has been appended a second time —
 *     the duplicate carries that seq, so the walk stops on it and reports an empty
 *     suffix. Resumed from the boundary BYTE the duplicate is an arrival, this rule
 *     sees it, and the full reading follows. `order.test.ts` holds it.
 *
 *     The second was THE RULE HERE BEING TWO THIRDS OF THE VERDICT'S. This asked a seq
 *     test written in this file rather than {@link firstLinkBreakFrom}, because the
 *     frontier carried no hash for the `prev` half to be asked against. Measured, over a
 *     tail whose boundary entry had been replaced by a DIFFERENT entry of the same seq, a
 *     fresh {@link chainReplay} reported `prev-hash break` and this called the same bytes
 *     a sound suffix — so a live session refreshed straight past a break that the next
 *     process to open the record was told about. The frontier carries the hash now
 *     ({@link TailReach.lastHash}) and the question is the verifier's own function, asked
 *     of a run that starts at the boundary instead of at a tail's birth.
 *
 * The caller's move in the first three is the same and is not this function's to make:
 * read the whole chain again.
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
    // A tail nothing was read from — one that appeared, or one that was empty when the
    // frontier was taken — contributes all of itself: there is no position to resume
    // from, so this asks for the whole tail plainly.
    const since =
      covered === undefined || covered.boundary === undefined
        ? wholeTail(layout, tail, upcasters)
        : readTailSince(layout, tail, upcasters, covered.boundary);
    if (since === undefined) return { suffix: false, why: 'A_TAIL_WAS_CUT' };
    const entries = since.arrivals;
    // The arrivals have to run on from where the frontier stopped, by the verifier's own
    // rule and in the verifier's own function ({@link firstLinkBreakFrom}) — the same one
    // a whole-tail read asks, given a starting seq and a starting hash instead of a
    // tail's birth. It is asked over the ENTRIES PAST THE BOUNDARY BYTE, which is what
    // lets it see a duplicate of the boundary entry: read from the seq instead, that
    // duplicate would satisfy the boundary and never be an arrival at all (see
    // {@link TailReach.boundary}). What is still outside this question is a break BELOW
    // the boundary — bytes a previous reading already accepted — and that is the full
    // reading's to find, not this one's.
    const broke = firstLinkBreakFrom(
      tail,
      entries,
      (covered?.lastSeq ?? -1) + 1,
      covered?.lastHash ?? null,
    );
    if (broke !== undefined) return { suffix: false, why: 'AN_ARRIVAL_DOES_NOT_CHAIN', broke };
    const last = entries[entries.length - 1];
    const lastSeq = last === undefined ? (covered?.lastSeq ?? -1) : last.link.seq;
    const lastHash = last === undefined ? (covered?.lastHash ?? null) : last.link.hash;
    const fresh = entries.map((entry) => entry.event);
    reached.set(tail, {
      lastSeq,
      lastHash,
      boundary: since.boundary,
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
    streams.push({ key: tail, events: fresh, cursor: 0, tail, lastSeq, lastHash });
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
 * A tail read WHOLE, in the shape a resumed reading returns — for the tail that has no
 * boundary to resume from because the frontier found it empty, or did not find it.
 *
 * THIS REPLACED `aboveBoundary`, which took the tip a `seq`-anchored read returned and
 * sliced off the entry it stopped on, trusting that entry to be the one the frontier
 * had covered. That trust is what a duplicate of the boundary entry broke: the walk
 * stopped on the COPY, the slice removed it, and the real arrival — the copy itself —
 * was gone from the result. Anchored on a byte there is nothing to slice, so nothing to
 * trust: see {@link TailReach.boundary}.
 */
function wholeTail(layout: ChainLayout, tail: string, upcasters: UpcasterRegistry): ReadSoFar {
  const read = readTail(layout, tail, upcasters);
  // A tail that holds no entry has no position, so the frontier records `undefined`
  // for it and the reading after this one reads it whole again — which costs nothing,
  // because there is nothing there.
  return { arrivals: read.entries, boundary: read.boundary };
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
    lastHash: stream.lastHash,
    ...(stream.boundary !== undefined ? { boundary: stream.boundary } : {}),
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
    // `readTail` rather than `readTailEntries`: the same bytes, plus what the read
    // had to notice about them. A reading that took only the entries is how a chain
    // the verifier refuses was served by every read with no word about it.
    const read = readTail(layout, tail, upcasters);
    const entries = read.entries;
    return {
      key: `${prefix}${tail}`,
      events: entries.map((entry) => entry.event),
      cursor: 0,
      tail,
      lastSeq: entries.length === 0 ? -1 : (entries[entries.length - 1] as Entry).link.seq,
      lastHash: entries.length === 0 ? null : (entries[entries.length - 1] as Entry).link.hash,
      ...(read.boundary !== undefined ? { boundary: read.boundary } : {}),
      ...(read.linkBreak !== undefined ? { linkBreak: read.linkBreak } : {}),
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
