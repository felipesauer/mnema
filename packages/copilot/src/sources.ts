/**
 * What a read of THE RECORD is made of: one projection cache per tree, each
 * paired with the tree it stands for.
 *
 * The core answers about ONE tree. Almost nothing a person or an agent asks is
 * about one tree: a search, a history, an account of authorship, a walk of the
 * references all cross the team's record, this machine's, and the personal one.
 * So the composed reads take a list of these, ask each, and merge — and the
 * scope travels with whatever comes back, always. A hit, an event, an edge from
 * the private tree means something different from the same one in the public
 * tree, and a reader who cannot tell them apart will cite one as the other.
 *
 * Who owns the caches is deliberately not this layer's business. A session keeps
 * them warm for the length of a connection; a command-line process opens them,
 * rebuilds, reads and closes. Both hand the same list here.
 */

import type { ProjectionCache, Scope } from '@mnema/core';

/** One tree's projection cache, and which tree it is. */
export interface ScopedCache {
  /** The tree this cache projects — the scope every answer from it carries. */
  readonly scope: Scope;
  /** The cache itself, already rebuilt by whoever owns it. */
  readonly cache: ProjectionCache;
}
