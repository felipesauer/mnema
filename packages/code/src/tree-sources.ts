/**
 * Opening the record on the command line: one projection cache per visible tree,
 * for the length of one read.
 *
 * A composed read (`search`, `timeline`, `accountability`, `refs`) asks THE
 * RECORD, not one tree, so it needs a cache per tree paired with the scope it
 * stands for. So does the one read that asks about a SINGLE tree on purpose — the
 * `brief`, whose answer becomes a committed file and therefore carries the tree that
 * travels and no other: it is handed every tree and drops the rest itself, because
 * which trees a document carries is one rule and belongs in one place. The MCP server
 * keeps those caches warm for a connection; a command is a process that runs once and
 * exits, so it opens them, rebuilds from the chain, reads, and closes — every time.
 * That cost is the command line's, and it is the price of not leaving a derived
 * database behind between runs.
 *
 * The order the trees are opened in reaches no answer: every reader over these
 * orders by a property of the CONTENT precisely so the order cannot reshuffle
 * what comes back.
 */

import type { UpcasterRegistry } from '@mnema/chain';
import { catalogUpcasters } from '@mnema/chain';
import type { ScopedCache } from '@mnema/copilot';
import { chainRootForScope, ProjectionCache, type ResolvedTrees, type Scope } from '@mnema/core';
import type { ScopedLinkBreak } from './record-integrity.js';

/** The trees a composed read opens, in a fixed order. */
export const SCOPES: readonly Scope[] = ['public', 'private', 'global'];

/**
 * THE OPEN AND THE CLOSE ARE ONE CALL, AND THIS MODULE IS THE ONLY PLACE THAT WRITES
 * EITHER — the whole reason the three functions below exist rather than a `ProjectionCache.open`
 * at each door.
 *
 * Measured: of the six production sites that opened a cache directly, THREE never closed
 * it — `commands/guard.ts`, `commands/next-actions.ts` and `pinned-run.ts` each opened a
 * handle and returned. What that leaks today is a SQLite handle and the tables behind it,
 * in-memory (`CacheOptions.dbPath` has no production caller), in a process that exits a
 * moment later — so the cost measured on the machine is nothing, and the defect is the
 * shape rather than the bill. The day one of those three is called from the MCP server,
 * which stays up, it becomes a handle per request; and a reader had no way to tell the
 * three that leaked from the three that did not without reading every one of them.
 *
 * So the pairing is a function and the guard is structural: `the-record-is-opened-and-closed-
 * together.test.ts` fails if any module of this package writes `ProjectionCache.open(`
 * outside this file and the MCP's registry — the one place a cache is deliberately held
 * open past the call that made it.
 */

/**
 * Opens a rebuilt cache over ONE tree, hands it to `read`, and closes it before
 * returning — including when the read throws.
 *
 * The rebuild is inside the `try` and the open is outside it, which is the ordering that
 * makes the promise true: a replay that throws leaves a handle that this closes anyway.
 */
export function withCache<T>(
  chainRoot: string,
  upcasters: UpcasterRegistry,
  read: (cache: ProjectionCache) => T,
): T {
  const cache = ProjectionCache.open(chainRoot, { upcasters });
  try {
    cache.rebuild();
    return read(cache);
  } finally {
    cache.close();
  }
}

/**
 * The LAZY form: `read` is handed an opener and the growing list of what it opened, and
 * every tree it opened is closed on the way out.
 *
 * It exists for the read that stops as soon as it finds what it came for — `show` walks
 * the trees in order and opens the next one only when the last did not hold the id — and
 * a read that opened all three to use one would pay for two replays it never looked at.
 * {@link withScopedCaches} is this function with the walk filled in, so there is one
 * close and not two.
 */
export function withOpenedCaches<T>(
  trees: ResolvedTrees,
  read: (open: (scope: Scope) => ScopedCache | undefined, opened: readonly ScopedCache[]) => T,
): T {
  const upcasters = catalogUpcasters();
  const opened: ScopedCache[] = [];
  try {
    return read((scope) => {
      const root = chainRootForScope(trees, scope);
      if (root === undefined) return undefined;
      const cache = ProjectionCache.open(root, { upcasters });
      // Recorded BEFORE the replay, so a rebuild that throws still leaves a handle the
      // `finally` below can close. The version this replaced pushed it after.
      const source: ScopedCache = { scope, chainRoot: root, cache };
      opened.push(source);
      cache.rebuild();
      return source;
    }, opened);
  } finally {
    for (const source of opened) source.cache.close();
  }
}

/**
 * Opens a rebuilt cache for every tree `trees` names, hands them to `read`, and
 * closes them all before returning — including when the read throws. A tree the
 * context does not have is simply absent from the list.
 */
export function withScopedCaches<T>(
  trees: ResolvedTrees,
  read: (sources: readonly ScopedCache[]) => T,
): T {
  return withOpenedCaches(trees, (open, opened) => {
    for (const scope of SCOPES) open(scope);
    return read(opened);
  });
}

/**
 * The caches alone, for a derivation that reads the RECORD and not the trees it is
 * kept in — the actor's runs, the live work.
 *
 * The scope is dropped rather than carried through, because such an answer never
 * names it: a run is the actor's session whichever tree it was opened in, and a task
 * is work whether the team's record holds it or this machine's. The readings that DO
 * label their items by tree (the index, a history) take the sources themselves — and
 * so does the one that CHOOSES between trees instead of labelling them: the `brief`
 * carries the tree that travels and leaves the others out, which is a question the
 * scope is the only answer to.
 */
export function caches(sources: readonly ScopedCache[]): ProjectionCache[] {
  return sources.map((source) => source.cache);
}

export type { ScopedLinkBreak } from './record-integrity.js';

/**
 * The tails that do not chain, across every tree a read opened.
 *
 * ONE READING FOR EVERY READ THAT WANTS IT. A read's answer comes out of the
 * projections, and the projections cannot hold this: a duplicate `seq` puts both
 * events in the tables, so a search over a broken record is indistinguishable from a
 * search over a sound one. The fact lives in the entries' links, and the cache carries
 * it up from the replay that already read them ({@link ProjectionCache.linkBreaks}) —
 * so this costs a read nothing beyond the reading it already did.
 *
 * THAT LAST CLAUSE IS TRUE OF ONE OF THE TWO ANSWERS AND `asOf` IS WHICH. It held for
 * every caller while there was only one door where the cache was fresh by construction.
 * The MCP's WRITE door is not: it appends without reading, so the replay behind its caches
 * is as old as the connection's last read, and a break another process left in between
 * reached the caller one call later. It passes `THE_CHAIN_AS_IT_STANDS_NOW` and pays
 * 0.09 ms per tree for it ({@link ProjectionCache.linkBreaksAsOfNow}); everybody else
 * passes {@link THE_READING_THAT_OPENED_THESE} and this costs them nothing, as it always
 * did. The argument is not defaulted because it is the kind of thing a door added later
 * gets wrong silently — see {@link BreaksAsOf}.
 *
 * IT IS NOT A VERDICT AND MAY NOT BE PRINTED AS ONE. It answers one structural
 * question — does each tail run on from the entry before it — and says nothing about
 * signatures, checkpoints or witnesses. A read that printed "the record is sound"
 * because this came back empty would be claiming what only `verify` can.
 *
 * EVERY READ THAT OPENS A CACHE ASKS IT, and so does every WRITE of the MCP — that
 * half arrived second, through `sessionLinkBreaks`, and the case it covers is the one
 * the reads could not: an append onto a tail that already does not chain. The guard is
 * `tests/the-broken-link-reaches-every-reader.test.ts`: it walks the source for the ways
 * a read opens a cache — this function and a bare `ProjectionCache.open` — and a file that
 * does neither of "asks this" and "says in {@link SERVES_NO_RECORD_CONTENT} why it owes
 * nothing" is red.
 *
 * THAT SENTENCE USED TO READ *EVERY READ THAT SERVES THE RECORD ASKS IT*, AND ITS UNIVERSE
 * DID NOT CONTAIN THE CONSOLE. The claim was total inside the set the guard defines — how
 * this package opens a PROJECTION CACHE — and `packages/code/src/repl/` opens none. It
 * serves the record all the same: a verdict in its opening panel, the proven level in the
 * corner of every frame, and what another process appended while the page was up. It
 * reaches the chain directly instead, so it was outside the sweep without being excused,
 * and the corner went on saying `fully-signed` in the frame whose body printed `seq gap`.
 * The guard has a second discriminant now — the ways this package reads the chain with no
 * cache in between — and the console answers it with the only reading a surface that holds
 * no cache can afford: whether the record has moved past what was ruled on
 * (`repl/proving.ts`). This function is still the answer for every door that HAS a cache,
 * which is what the narrowed sentence above says and all it says.
 *
 * IT USED TO BE TWO READS, AND THE REASON RECORDED FOR STOPPING THERE WAS MEASURED AND
 * FALSE. This doc said making it total *"means an output port at a door that today has
 * none — the read verbs return values and the wiring prints them — which is a change
 * across every `here()` in the surface"*, costed at ~60 sites. The premise under it was
 * that a read would have to be handed an `io`. It does not: the two reads that already
 * said it did it by returning ONE MORE FIELD, and the wiring — which has an `io`
 * already — prints it. Counted against the source when the debt was paid: fourteen of
 * the seventeen reads return an object a field could be added to, and not one call site
 * took an `io` it did not have.
 */
export function linkBreaksOf(
  sources: readonly ScopedCache[],
  asOf: BreaksAsOf,
): readonly ScopedLinkBreak[] {
  return sources.flatMap((source) =>
    (asOf === THE_CHAIN_AS_IT_STANDS_NOW
      ? source.cache.linkBreaksAsOfNow()
      : source.cache.linkBreaks
    ).map((broken) => ({
      scope: source.scope,
      tail: broken.tail,
      seq: broken.seq,
      detail: broken.detail,
    })),
  );
}

/**
 * WHEN the answer is about — the one thing the callers of {@link linkBreaksOf} differ by,
 * and a closed union rather than a flag so that a door added later does not compile until
 * somebody has said which of the two it is.
 *
 * A READ that opened its own caches is served from a replay taken moments ago in the same
 * process, and the MCP's read door has just been through `CacheRegistry.get`, which brings
 * the cache into agreement with the chain. For those, asking the disk again is a `readdir`
 * per tail for a window measured in microseconds, and the reply is the same reply.
 *
 * The MCP's WRITE door is the one this distinction exists for. It does not go through
 * `get` — it marks the tree stale and appends — so a cache it answers off is as old as the
 * connection's last read, which can be minutes. `THE_CHAIN_AS_IT_STANDS_NOW` costs it
 * 0.09 ms per tree, flat in the record ({@link ProjectionCache.linkBreaksAsOfNow}).
 */
export type BreaksAsOf = typeof THE_READING_THAT_OPENED_THESE | typeof THE_CHAIN_AS_IT_STANDS_NOW;

/** What the replay behind these caches found — see {@link BreaksAsOf}. */
export const THE_READING_THAT_OPENED_THESE = 'the reading that opened these';
/** What the chain holds now, arrivals included — see {@link BreaksAsOf}. */
export const THE_CHAIN_AS_IT_STANDS_NOW = 'the chain as it stands now';
