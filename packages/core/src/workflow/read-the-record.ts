/**
 * What a gated write reads of the record.
 *
 * A write reads two kinds of thing, and they come from two places.
 *
 * THE SUBJECT A GATE JUDGES — the state a decision, a task or a skill is in, whether a run is still
 * open, whether the subject (or a supersede's successor) exists at all — comes from the CHAIN
 * ({@link standing}, by `subjectEvents`). It used to come from the projection the tree keeps,
 * brought forward to the chain before it was asked, and that is not the chain: the projection is a
 * file beside the record that nothing signs, and it is brought forward from what it already says.
 * Measured on the built binary, a row of it edited by hand let every one of the four machines
 * append a move its own gate refuses: signed, and passed by `verify`. A replay of the whole record
 * would have been the chain too, and it is what a write cost before: about 1 s at 100 thousand
 * events, and a holder that had to read again under the lock held it for a whole replay, which is
 * what let a third session run out of the lock's wait (`TAIL_BUSY`). Reading only the lines that
 * name the subject is the chain at the price of reading its bytes once.
 *
 * WHAT A WRITE ONLY NUMBERS OR COUNTS: how many decisions there are, for the next `ADR-<n>` label;
 * who counts for an identity: still comes from the projection, brought forward to the chain as it
 * stands NOW (`ProjectionCache.refresh`, which reads only what arrived). Neither is a gate on a
 * move: a label a wrong count repeats is a collision the reader already names and the ids never
 * collide, and a key the roster wrongly admits is one `verify` refuses.
 */

import { existsSync } from 'node:fs';
import {
  type CatalogEvent,
  type ChainLayout,
  subjectEvents,
  type UpcasterRegistry,
} from '@mnema/chain';
import { rosterOf } from '../identity/membership.js';
import { ProjectionCache } from '../projections/cache.js';
import { keptCachePath } from '../projections/cache-home.js';

/** Where a write reads from. */
export interface ReadsTheRecord {
  readonly layout: ChainLayout;
  readonly upcasters: UpcasterRegistry;
}

/** Runs `ask` over a cache brought forward to the chain as it is now, and closes it. */
export function asTheChainIs<T>(ctx: ReadsTheRecord, ask: (cache: ProjectionCache) => T): T {
  const cache = ProjectionCache.open(ctx.layout.root, { upcasters: ctx.upcasters, persist: true });
  try {
    cache.refresh();
    return ask(cache);
  } finally {
    cache.close();
  }
}

/**
 * Who counts for an identity, as the chain has it now: what a write asks before it appends.
 *
 * It is asked UNDER THE LOCK, so what it costs is how long every other writer waits: a replay of
 * the record there held it for 2.2 s at 100 thousand events. This is the kept projection's
 * membership plus what arrived since ({@link ProjectionCache.rosterAsOfNow}), which is the fold a
 * replay runs over the same events; with nothing kept it is the replay, as before.
 */
export function rosterAsTheChainIs(ctx: ReadsTheRecord, anchor: string): ReadonlySet<string> {
  // A projection that is not there is not made for this: the question is asked by `init` and by
  // every first write too, and a tree they leave has to be the one they found. With none kept it
  // is the replay, as before: the first reading that keeps one (`asTheChainIs`) is the one that
  // makes the next of these cheap.
  if (!existsSync(keptCachePath(ctx.layout))) {
    return rosterOf({ tree: ctx.layout.root, upcasters: ctx.upcasters }, anchor);
  }
  const cache = ProjectionCache.open(ctx.layout.root, { upcasters: ctx.upcasters, persist: true });
  try {
    return cache.rosterAsOfNow(anchor);
  } finally {
    cache.close();
  }
}

/**
 * The subjects named, as the chain has them: a map of just those ids, folded by `fold` from their
 * own events in the order a replay folds them, so the reading is a snapshot a later reading can be
 * compared with. An id the chain has no complete subject for is absent from the map.
 *
 * `fold` is the projection's own (`projectDecisions`, `projectTasks`, …), handed only the events
 * whose subject is the id. What a gate reads of what it returns (the state, whether a run is open,
 * whether the subject exists) is folded from those events alone; a field another subject's event
 * sets (the `supersedes` a successor is given) is not in it, and no gate reads one.
 */
export function standing<T>(
  ctx: ReadsTheRecord,
  ids: readonly (string | undefined)[],
  fold: (events: readonly CatalogEvent[]) => ReadonlyMap<string, T>,
): Map<string, T> {
  const named = ids.filter((id): id is string => id !== undefined);
  const events = subjectEvents(ctx.layout, ctx.upcasters, named);
  const found = new Map<string, T>();
  for (const id of named) {
    const one = fold(events.get(id) ?? []).get(id);
    if (one !== undefined) found.set(id, one);
  }
  return found;
}
