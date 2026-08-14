/**
 * `mnema tail list` — which tails the record holds here, and what each one holds.
 *
 * IT EXISTS BECAUSE THE VERB BESIDE IT TAKES AN ID NOTHING PRINTED. `tail prune`
 * authorizes a cut BY TAIL ID, and the only identifier any read of this product put
 * on a screen was the census note's — which names the fingerprint of a committed key
 * that has NO tail, precisely the tail that is not there. Measured on a fresh
 * project (`init`, one decision, `verify`): the verdict says `1 tail(s)`, a count,
 * and there is no `--json` to ask it differently. Using the verb meant `ls
 * .mnema/tails/` — reading the layout by hand.
 *
 * IT IS A READ AND IT OPENS NO WRITER. That is worth stating because one column it
 * could have carried needs one: which of these tails is THIS machine's, a fact only
 * the writer knows (it mints its own tail id in its constructor, and asking leaves an
 * ownership proof behind). A read that wrote to answer a question about writing would
 * stop being a read; the column is absent instead, and
 * `the-verb-says-which-tails.test.ts` hashes the whole sandbox around the call.
 *
 * THE SET OF TREES IS THE ONE `prune` SEARCHES, by construction rather than by
 * agreement: both come off `tailsHeld`/`locateTailScope`, which are one walk in
 * `@mnema/core` (`topology/locate.ts`). A tail this listed and that refused would be
 * an offer the record turns down; a tail this hid and that accepted would be a cut
 * nobody could have decided on.
 *
 * THERE IS NO `NO_PROJECT` REFUSAL, and it is the one shape here that differs from
 * `prune`'s. Outside a project the machine-global tree is still resolved and can
 * genuinely hold tails, so the honest answer is what it holds — and when it holds
 * nothing, the surface says so while naming the one tree it looked in. A refusal
 * would be the surface claiming there is nowhere to look when there is.
 */

import { catalogUpcasters } from '@mnema/chain';
import {
  type DiscoveryEnv,
  type HeldTail,
  resolveTrees,
  type Scope,
  tailsHeld,
  treesSearched,
} from '@mnema/core';

/** What the listing needs — injected so it is testable. */
export interface TailListContext {
  /** The working directory to resolve the project from. */
  readonly cwd: string;
  /** The discovery environment (XDG/home). */
  readonly env: DiscoveryEnv;
}

/** What the trees here hold, and which trees that was. */
export interface TailListing {
  /**
   * Every tail held, tree by tree in search order. Empty is an ordinary answer: a
   * record can have no tail at all (a fresh clone of a project whose private tree
   * stayed behind), which is why {@link TailListing.trees} is stated separately.
   */
  readonly tails: readonly HeldTail[];
  /**
   * The trees this looked in — always non-empty, since the global tree always
   * resolves. It is what turns an empty answer into a statement a reader can act on.
   */
  readonly trees: readonly Scope[];
}

/**
 * Lists the tails the trees visible from `ctx.cwd` hold — nothing is opened for
 * writing and nothing is appended.
 */
export function runTailList(ctx: TailListContext): TailListing {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  return { tails: tailsHeld(trees, catalogUpcasters()), trees: treesSearched(trees) };
}
