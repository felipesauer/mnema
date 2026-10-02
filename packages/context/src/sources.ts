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
 * The list is not bounded by one project either. A question keyed by an ID — what
 * does this record say, what is its history, what points at it — has an answer
 * wherever the id was written, and the entities that point at something are
 * regularly the ones in the OTHER projects a workspace holds. So the same two
 * things travel with an answer for the same reason: the scope says which of a
 * project's trees, and {@link ScopedCache.project} says whose.
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
  /**
   * Where that tree's chain lives on disk — the tree's IDENTITY, and the only
   * thing here that names one tree and no other.
   *
   * The scope does not. A scope is a ROLE ("the team's record", "this
   * machine's"), and a read that spans projects holds several trees in the same
   * role: two `public` trees are two repositories, not one read twice. A reader
   * that treats the scope as a name collapses them — and a reader that treats a
   * per-tree quantity as globally unique (an event's position in a stream, say)
   * makes one tree's fact overwrite another's. Both are silent: the answer comes
   * back short, and nothing in it says so.
   */
  readonly chainRoot: string;
  /**
   * The PROJECT this tree belongs to, when it belongs to one — the directory that
   * owns it, which is what a reader can act on.
   *
   * Absent for the machine-global tree, and that absence is the fact rather than a
   * gap: the global tree belongs to no project, it is the same tree for all of
   * them, and labelling it with whichever project a read happened to reach it
   * through would say a personal cross-project note came from one codebase.
   *
   * It is not the same information as {@link chainRoot}, which is a chain's path on
   * disk — an identity for comparing trees, not an answer to "where does this
   * belong". A reader that had to derive one from the other would be re-deriving
   * the topology every answer, from a path whose shape is the layout's business.
   */
  readonly project?: string;
  /** The cache itself, already rebuilt by whoever owns it. */
  readonly cache: ProjectionCache;
}
