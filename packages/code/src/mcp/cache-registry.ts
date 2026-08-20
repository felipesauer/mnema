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
 * memory: the same cache, retained between calls.
 *
 * THAT SENTENCE USED TO SAY "the same cache, the same REBUILD, retained between
 * calls", and the second half is what a measurement took away. Retaining the cache
 * fixed the read and left the WRITE paying the whole bill: an append marks the cache,
 * the next read replayed the chain, and a channel that appends on every edit made the
 * next replay dearer than the last. Measured on this machine, the pair a push
 * actually performs — one signed append, then the read the next push is served from —
 * cost 6.1 ms on a 391 KB record and 17.8 ms on 871 KB, against 0.10 and 0.17 ms for
 * the same read with no write between it. Two hundred and eleven charges in a row
 * took 1.42 s, and the per-charge median ROSE 42% along the run as the record grew.
 *
 * So the cache brings itself forward instead ({@link ProjectionCache.refresh}): a
 * chain that only grew is caught up from what arrived, and only a chain that changed
 * some other way is replayed. The same run of 211 charges is 0.17 s, the pair is
 * 0.76-0.84 ms at every record size measured, and the median no longer rises. The
 * first open still replays and still costs what a replay costs — nothing here makes
 * the record cheaper to READ the first time.
 *
 * Two properties are what make it safe to retain:
 *
 *   1. **Keyed by chain root, never by scope.** A read does not always serve the
 *      session's own tree: `next_actions` and `guard` locate the ENTITY's home
 *      tree, which may be the public one while the session writes private, and the
 *      three reads keyed by an id span every project of the workspace. One shared
 *      cache would answer from whichever tree happened to be loaded first — the
 *      wrong projection, returned silently. A cache per root cannot make that
 *      mistake, and the roots are bounded by what the workspace holds: two trees
 *      per announced project plus the one global tree they share. So the map still
 *      has a ceiling by construction rather than by eviction policy — it is just no
 *      longer three.
 *
 *      That ceiling USED TO BE JUSTIFIED by the roots being *"all settled at the
 *      handshake"*, and that premise is gone: the server now re-reads the workspace
 *      whenever the client says it changed ({@link refreshWorkspace}). The ceiling
 *      survives it, and by the property that replaced the premise — the re-read is
 *      ADDITIVE, so the map only ever gains the trees of a project the client
 *      announced, and a client announces folders a person opened. What it is not any
 *      more is a ceiling fixed at one instant, and the entries a re-read does not
 *      reach are left exactly where they are: a cache belongs to the tree it was
 *      opened over, and that tree did not move.
 *
 *      Entries are opened LAZILY, one per tree actually read, which is what keeps
 *      the wider ceiling from being a cost anyone pays for nothing: a connection
 *      that never asks a question keyed by an id never opens a sibling project's
 *      tree, and a tree that has never been written replays as empty without being
 *      brought into being.
 *
 *   2. **Invalidated by the write, and CHECKED against the chain.** Two signals,
 *      because there are two ways a retained replay goes behind and only one of
 *      them this process knows about.
 *
 *      {@link invalidate} is called from the ONE place every MCP write passes
 *      through (the session's `writeContext`), so a tool cannot forget. That is
 *      the exact half: this connection KNOWS it appended.
 *
 *      It used to be the whole of it, on the premise that *the chain only
 *      changes when this process appends to it*. Use falsified that premise —
 *      three writers on one project is ordinary (a live MCP session, a headless
 *      run, a `mnema` command in a terminal), and measured against a session
 *      that read a record the CLI was writing to, the rule came out as *reading
 *      never heals, and writing heals only the tree it wrote to*. An agent that
 *      writes memories and observations writes PRIVATE, so nothing it does ever
 *      refreshed the tree that answers "what has this team decided" — the answer
 *      came back with a confident count and no sign it was a day old.
 *
 *      So {@link get} also OBSERVES, through {@link chainExtent}: one `stat` per
 *      tail before serving, of the only file a tail can be growing. Cheap enough
 *      to pay on every read, and it costs nothing on a chain that did not move.
 *      Still no clock — nothing here expires, and nothing watches. An extent is
 *      read when a caller asks for a cache and at no other moment.
 *
 *      The extent SUBSUMES the mark for correctness — an append this process
 *      makes grows a file exactly like anyone else's — and the mark is kept
 *      anyway, deliberately. It is knowledge rather than inference: it costs a
 *      boolean, it does not ask the disk anything, and it is therefore the half
 *      that holds where the inference could be wrong. A filesystem is allowed to
 *      answer a `stat` from a cached attribute (NFS does, for seconds at a time),
 *      and where that happens the extent can report a size that is already old.
 *      The connection's own write never depends on being observed.
 *
 * The reading HEALS rather than warns, and that is the whole shape of the fix. A
 * warning would hand the caller a fact it has no move to make about: it cannot
 * rebuild, and it has no other source to ask. The product does warn where the
 * author can act — which tree a write landed in, what a content door scrubbed —
 * and this is the other kind.
 *
 * Invalidation MARKS, it does not catch up. A session that writes five times and
 * then reads pays one catch-up, not five — and a session that writes without ever
 * reading again pays none. The cost of being wrong is asymmetric and the design
 * follows that: catching up needlessly costs a fraction of a millisecond, while a
 * missed catch-up hands the agent a record that no longer exists. That criterion did
 * not change; what changed is that it now applies to an append by ANY process, which
 * is where the expensive error was actually coming from — and that the cheap side of
 * the asymmetry got cheaper, which widens the margin rather than narrowing it.
 */

import {
  type ChainExtent,
  catalogUpcasters,
  chainExtent,
  type UpcasterRegistry,
} from '@mnema/chain';
import { ProjectionCache } from '@mnema/core';

/** A cache retained for one chain root, and whether it still matches the chain. */
interface Entry {
  readonly cache: ProjectionCache;
  /** True once a write went to this root: the next reader catches up before reading. */
  stale: boolean;
  /**
   * How far the chain reached when this projection was last brought into agreement
   * with it. A different extent now means somebody appended in between — this
   * process or another one — and the next reader catches up before being served.
   *
   * It stays the CHEAP question, and that is why it is still here beside the cache's
   * own frontier: an extent is one `readdir` and one `stat` per tail, so an unchanged
   * chain is served for nothing at all. The cache's frontier is what answers the
   * expensive question — what arrived, and does it follow — and it is only ever asked
   * once this one has said something moved.
   */
  extent: ChainExtent;
}

/** The session's warm caches, one per chain root it has read. */
export interface CacheRegistry {
  /**
   * The cache for a chain root, brought into agreement with the chain if this is
   * the first read, if a write marked it stale, or if the chain has grown since the
   * retained projection was replayed from it — so a caller always receives a cache
   * that agrees with the chain, and never has to know whether it was warm, or who
   * moved the record.
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
      // Read BEFORE the replay, and recorded as what the replay covers. An
      // append that lands DURING the rebuild is then attributed to nobody: the
      // entry remembers the smaller extent, so the next reader replays once more
      // for an event it may already hold. That is the direction the asymmetry
      // points — reading the extent afterwards would record coverage of a write
      // the replay might have missed, which is the expensive error wearing the
      // cheap one's clothes.
      const extent = chainExtent({ root: chainRoot });
      const existing = entries.get(chainRoot);
      if (existing !== undefined) {
        if (existing.stale || existing.extent !== extent) {
          // REFRESH, not rebuild, and the difference is the whole cost of this
          // module. A chain that only grew is brought forward from what arrived; a
          // chain that changed any other way is replayed whole. The cache decides
          // which, because it is the half that knows how far its own tables reach —
          // this side knows only that SOMETHING moved. Either way what comes back
          // agrees with the chain, so nothing above here reads differently.
          //
          // It runs BEFORE anything is recorded: a chain that fails to read throws
          // out of here with the entry still marked stale and still holding the
          // older extent, so the next reader tries again instead of being served
          // a cache we know is behind.
          existing.cache.refresh();
          existing.stale = false;
          existing.extent = extent;
        }
        return existing.cache;
      }
      const cache = ProjectionCache.open(chainRoot, { upcasters });
      cache.rebuild();
      entries.set(chainRoot, { cache, stale: false, extent });
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
