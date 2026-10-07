/**
 * What a gated write reads of the record, taken from the projection the tree keeps rather than
 * from a replay of the whole chain.
 *
 * A write reads state (what a decision is in, how many there are) and a replay of the chain is
 * linear in the record: measured at 100 thousand events a numbered `decision record` cost about
 * 1 s and every transition 2-3 s, and a holder that has to read again under the lock for
 * `onTheRecordAsItStands` held it for a whole replay, which is what let a third session run out of
 * the lock's wait (`TAIL_BUSY`). The projection is brought forward to the chain as it stands NOW
 * (`ProjectionCache.refresh`, which reads only what arrived) before it is asked, so it is the
 * reading the lock needs: the second one costs the arrivals, not the record.
 *
 * It answers what a replay would, and that is held by the same comparison every advance is
 * (`projections/advance.test.ts`); a cache that cannot be had is built in memory and answers the
 * same, slower.
 */

import { existsSync } from 'node:fs';
import type { ChainLayout, UpcasterRegistry } from '@mnema/chain';
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
 * Who counts for an identity, as the chain has it now — what a write asks before it appends.
 *
 * It is asked UNDER THE LOCK, so what it costs is how long every other writer waits: a replay of
 * the record there held it for 2.2 s at 100 thousand events. This is the kept projection's
 * membership plus what arrived since ({@link ProjectionCache.rosterAsOfNow}), which is the fold a
 * replay runs over the same events; with nothing kept it is the replay, as before.
 */
export function rosterAsTheChainIs(ctx: ReadsTheRecord, anchor: string): ReadonlySet<string> {
  // A projection that is not there is not made for this: the question is asked by `init` and by
  // every first write too, and a tree they leave has to be the one they found. With none kept it
  // is the replay, as before — the first reading that keeps one (`asTheChainIs`) is the one that
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
 * The entities named, as they stand — a map of just those ids, so the reading is a snapshot a
 * later reading can be compared with.
 */
export function standing<T>(
  ctx: ReadsTheRecord,
  ids: readonly (string | undefined)[],
  get: (cache: ProjectionCache, id: string) => T | null,
): Map<string, T> {
  return asTheChainIs(ctx, (cache) => {
    const found = new Map<string, T>();
    for (const id of ids) {
      if (id === undefined) continue;
      const one = get(cache, id);
      if (one !== null) found.set(id, one);
    }
    return found;
  });
}
