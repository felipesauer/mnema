/**
 * The session's projection caches: one per tree, kept warm for the connection.
 *
 * A projection cache is a materialized read model — opening one replays the
 * whole chain. The CLI pays that once per process and exits, so it never
 * mattered there. The MCP server does not exit: it stays up for the length of a
 * session while an agent reads from it over and over, and every read used to
 * open a cache from scratch and throw it away. The replay is linear in the
 * chain, so the cost grows with the record — exactly when the product is
 * working. This registry is the fix, and it is nothing more than process
 * memory: the same cache, the same rebuild, retained between calls.
 *
 * Two properties are what make it safe to retain:
 *
 *   1. **Keyed by chain root, never by scope.** A session sees up to three trees
 *      and a read does not always serve the session's own: `next_actions` and
 *      `guard` locate the ENTITY's home tree, which may be the public one while
 *      the session writes private. One shared cache would answer from whichever
 *      tree happened to be loaded first — the wrong projection, returned
 *      silently. A cache per root cannot make that mistake, and the roots are
 *      bounded by the session's resolved trees (at most three), so the map has
 *      a ceiling by construction rather than by eviction policy.
 *
 *   2. **Invalidated by the write, not by a clock.** {@link invalidate} is
 *      called from the ONE place every MCP write passes through (the session's
 *      `writeContext`), so a tool cannot forget. Nothing here watches mtimes or
 *      expires on a timer: the chain only changes when this process appends to
 *      it, and that append is observable at its single door.
 *
 * Invalidation MARKS, it does not rebuild. A session that writes five times and
 * then reads pays one replay, not five — and a session that writes without ever
 * reading again pays none. The cost of being wrong is asymmetric and the design
 * follows that: a needless rebuild costs milliseconds, while a missed one hands
 * the agent a record that no longer exists.
 */

import { catalogUpcasters, type UpcasterRegistry } from '@mnema/chain';
import { ProjectionCache } from '@mnema/core';

/** A cache retained for one chain root, and whether it still matches the chain. */
interface Entry {
  readonly cache: ProjectionCache;
  /** False once a write went to this root: the next reader rebuilds before reading. */
  stale: boolean;
}

/** The session's warm caches, one per chain root it has read. */
export interface CacheRegistry {
  /**
   * The cache for a chain root, rebuilt if this is the first read or if a write
   * marked it stale — so a caller always receives a cache that agrees with the
   * chain, and never has to know whether it was warm.
   */
  get(chainRoot: string): ProjectionCache;
  /**
   * Marks the cache for a chain root stale. A root with no cache yet is a no-op:
   * there is nothing to be wrong, and the cache it eventually opens replays the
   * chain as it stands then.
   */
  invalidate(chainRoot: string): void;
  /** Closes every retained database and forgets them. Called when the session ends. */
  closeAll(): void;
}

/**
 * Creates an empty registry. One belongs to one session — its lifetime is the
 * connection's, which is what makes the caches warm and what bounds them.
 */
export function createCacheRegistry(): CacheRegistry {
  const entries = new Map<string, Entry>();
  // One upcaster registry for the session, shared by every cache it opens: the
  // catalog is the same for all trees, and building it per read was pure waste.
  const upcasters: UpcasterRegistry = catalogUpcasters();

  return {
    get(chainRoot: string): ProjectionCache {
      const existing = entries.get(chainRoot);
      if (existing !== undefined) {
        if (existing.stale) {
          // Rebuild BEFORE clearing the flag: a chain that fails to read throws
          // out of here with the entry still marked stale, so the next reader
          // tries again instead of being served a cache we know is behind.
          existing.cache.rebuild();
          existing.stale = false;
        }
        return existing.cache;
      }
      const cache = ProjectionCache.open(chainRoot, { upcasters });
      cache.rebuild();
      entries.set(chainRoot, { cache, stale: false });
      return cache;
    },

    invalidate(chainRoot: string): void {
      const existing = entries.get(chainRoot);
      if (existing !== undefined) existing.stale = true;
    },

    closeAll(): void {
      for (const entry of entries.values()) entry.cache.close();
      entries.clear();
    },
  };
}
