/**
 * `mnema accountability [--from --to --who --which]` — who authorized what, and
 * which agent carried it out, over the whole record.
 *
 * The second INTELLIGENCE read: the derivation the proof exists FOR. It folds the
 * UNION of the present trees ({@link unionEvents}) into a factual account of
 * authorship — per authorizing `who`, how many facts, of which kinds, executed by
 * which agents. Like `git shortlog -sn`, the DEFAULT is everything: with no
 * filter it accounts for the entire union. `--from`/`--to`/`--who`/`--which` only
 * NARROW that — an optional window and author/agent filter, never a required one.
 * An empty stream (or filters that exclude everything) yields a zero account, not
 * an error.
 *
 * Read-only: it reads the present trees' tails and folds them with the copilot's
 * pure `accountability`. No cache, no writer, no key. It needs no `--actor` — the
 * `--who`/`--which` here are aggregation FILTERS (which author, which agent to
 * count), not the identity of the asker. With no project at all it refuses
 * `NO_PROJECT`, the same refusal the other intelligence reads give.
 */

import { catalogUpcasters } from '@mnema/chain';
import { type Accountability, type AccountabilityFilter, accountability } from '@mnema/copilot';
import { type DiscoveryEnv, resolveTrees } from '@mnema/core';
import { unionEvents } from '../intelligence-source.js';

/** What the accountability command needs — injected so it is testable. */
export interface AccountabilityContext {
  /** The working directory to resolve the project from. */
  readonly cwd: string;
  /** The discovery environment (XDG/home). */
  readonly env: DiscoveryEnv;
}

/** The factual account of authorship over the union, within the optional filter. */
export interface AccountabilityDone {
  readonly ok: true;
  /** The account itself — total facts and one entry per authorizing `who`. */
  readonly account: Accountability;
}

/** The read was refused — there is no project to account for. */
export interface AccountabilityRefused {
  readonly ok: false;
  readonly reason: 'NO_PROJECT';
}

/**
 * Reports the account of authorship over the union of the present trees, narrowed
 * by the optional filter. With no filter it accounts for the whole record. The
 * result echoes the `from`/`to` applied and carries the per-`who` breakdown.
 * Read-only: it reads the tails and folds them, opening no writer and no cache.
 */
export function runAccountability(
  ctx: AccountabilityContext,
  input: AccountabilityFilter = {},
): AccountabilityDone | AccountabilityRefused {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  if (trees.projectPublic === undefined) {
    return { ok: false, reason: 'NO_PROJECT' };
  }
  const events = unionEvents(trees, catalogUpcasters());
  return { ok: true, account: accountability(events, input) };
}
