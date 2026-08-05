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
 * kept in — the actor's runs, the actionable work.
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
