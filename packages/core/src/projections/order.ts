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
  listTails,
  readTailEntries,
  type UpcasterRegistry,
} from '@mnema/chain';

/** One tail's events in proven (`seq`) order, plus a read cursor. */
interface TailStream {
  readonly tail: string;
  readonly events: readonly CatalogEvent[];
  cursor: number;
}

/**
 * Reads all tails and merges them into one total, deterministic order. This is
 * the single bridge from the chain to a projection: a projection consumes this
 * ordered stream and never reads tails itself.
 */
export function orderedEvents(layout: ChainLayout, upcasters: UpcasterRegistry): CatalogEvent[] {
  const streams: TailStream[] = listTails(layout).map((tail) => ({
    tail,
    events: readTailEntries(layout, tail, upcasters).map((entry) => entry.event),
    cursor: 0,
  }));

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
 * smallest `at`, ties broken by tail id (deterministic). Returns undefined when
 * every stream is drained. Consuming heads in this way preserves each tail's
 * `seq` order untouched — only heads of DIFFERENT tails are ever compared.
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

/** True if `a`'s head should come before `b`'s: by `at`, then tail id. */
function headPrecedes(a: TailStream, b: TailStream): boolean {
  const atA = (a.events[a.cursor] as CatalogEvent).at;
  const atB = (b.events[b.cursor] as CatalogEvent).at;
  if (atA !== atB) return atA < atB;
  return a.tail < b.tail;
}
