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

import type { ChainLayout, UpcasterRegistry } from '@mnema/chain';
import { ProjectionCache } from '../projections/cache.js';

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
