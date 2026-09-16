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

import { catalogUpcasters } from '@mnema/chain';
import type { ScopedCache } from '@mnema/copilot';
import { chainRootForScope, ProjectionCache, type ResolvedTrees, type Scope } from '@mnema/core';
import type { ScopedLinkBreak } from './record-integrity.js';

/** The trees a composed read opens, in a fixed order. */
export const SCOPES: readonly Scope[] = ['public', 'private', 'global'];

/**
 * Opens a rebuilt cache for every tree `trees` names, hands them to `read`, and
 * closes them all before returning — including when the read throws. A tree the
 * context does not have is simply absent from the list.
 */
export function withScopedCaches<T>(
  trees: ResolvedTrees,
  read: (sources: readonly ScopedCache[]) => T,
): T {
  const upcasters = catalogUpcasters();
  const sources: ScopedCache[] = [];
  try {
    for (const scope of SCOPES) {
      const root = chainRootForScope(trees, scope);
      if (root === undefined) continue;
      const cache = ProjectionCache.open(root, { upcasters });
      cache.rebuild();
      sources.push({ scope, chainRoot: root, cache });
    }
    return read(sources);
  } finally {
    for (const source of sources) source.cache.close();
  }
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
 * IT IS NOT A VERDICT AND MAY NOT BE PRINTED AS ONE. It answers one structural
 * question — does each tail run on from the entry before it — and says nothing about
 * signatures, checkpoints or witnesses. A read that printed "the record is sound"
 * because this came back empty would be claiming what only `verify` can.
 *
 * EVERY READ THAT SERVES THE RECORD ASKS IT, and so does every WRITE of the MCP — that
 * half arrived second, through `sessionLinkBreaks`, and the case it covers is the one
 * the reads could not: an append onto a tail that already does not chain. The guard is
 * `tests/the-broken-link-reaches-every-reader.test.ts`: it walks the source for the two
 * ways a read opens the record — this function and a bare `ProjectionCache.open` — and
 * a file that does neither of "asks this" and "says in {@link SERVES_NO_RECORD_CONTENT}
 * why it owes nothing" is red.
 *
 * IT USED TO BE TWO READS, AND THE REASON RECORDED FOR STOPPING THERE WAS MEASURED AND
 * FALSE. This doc said making it total *"means an output port at a door that today has
 * none — the read verbs return values and the wiring prints them — which is a change
 * across every `here()` in the surface"*, costed at ~60 sites. The premise under it was
 * that a read would have to be handed an `io`. It does not: the two reads that already
 * said it did it by returning ONE MORE FIELD, and the wiring — which has an `io`
 * already — prints it. Counted against the source when the debt was paid: fourteen of
 * the seventeen reads return an object a field could be added to, and not one call site
 * took an `io` it did not have. What the number really was is in
 * `.refactor/active/the-broken-link-reaches-every-reader/report.md`.
 */
export function linkBreaksOf(sources: readonly ScopedCache[]): readonly ScopedLinkBreak[] {
  return sources.flatMap((source) =>
    source.cache.linkBreaks.map((broken) => ({
      scope: source.scope,
      tail: broken.tail,
      seq: broken.seq,
      detail: broken.detail,
    })),
  );
}
