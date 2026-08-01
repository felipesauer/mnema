/**
 * `mnema accountability [--from --to --who --which]` — who authorized what, and
 * which agent carried it out, over the whole record.
 *
 * The second INTELLIGENCE read: the derivation the proof exists FOR. It counts
 * every visible tree's record into a factual account of authorship — per
 * authorizing `who`, how many facts, of which kinds, executed by which agents.
 * Like `git shortlog -sn`, the DEFAULT is everything: with no filter it accounts
 * for the whole record. `--from`/`--to`/`--who`/`--which` only NARROW that — an
 * optional window and author/agent filter, never a required one. An empty record
 * (or filters that exclude everything) yields a zero account, not an error.
 *
 * Read-only: it opens a cache per tree, rebuilds it in memory, and sums the
 * grouped counts the copilot's pure `accountability` composes. No writer, no
 * key. It needs no `--actor` — the `--who`/`--which` here are aggregation
 * FILTERS (which author, which agent to count), not the identity of the asker.
 * With no project at all it refuses `NO_PROJECT`, the same refusal the other
 * intelligence reads give.
 */

import { type Accountability, type AccountabilityFilter, accountability } from '@mnema/copilot';
import { type DiscoveryEnv, resolveTrees } from '@mnema/core';
import { type AnchorForms, anchorForms, resolveTypedAnchor } from '../anchors.js';
import { withScopedCaches } from '../tree-sources.js';

/** What the accountability command needs — injected so it is testable. */
export interface AccountabilityContext {
  /** The working directory to resolve the project from. */
  readonly cwd: string;
  /** The discovery environment (XDG/home). */
  readonly env: DiscoveryEnv;
}

/** The factual account of authorship over the record, within the optional filter. */
export interface AccountabilityDone {
  readonly ok: true;
  /** The account itself — total facts and one entry per authorizing `who`. */
  readonly account: Accountability;
  /** How each identity this record knows is written for a person. */
  readonly anchors: AnchorForms;
}

/** The read was refused — no project to account for, or a `--who` that names none. */
export type AccountabilityRefused =
  | { readonly ok: false; readonly reason: 'NO_PROJECT' }
  | {
      readonly ok: false;
      readonly reason: 'REFUSED';
      readonly code: string;
      readonly message: string;
    };

/**
 * Reports the account of authorship over every present tree, narrowed by the
 * optional filter. With no filter it accounts for the whole record. The result
 * echoes the `from`/`to` applied and carries the per-`who` breakdown. Read-only:
 * no writer, no key.
 */
export function runAccountability(
  ctx: AccountabilityContext,
  input: AccountabilityFilter = {},
): AccountabilityDone | AccountabilityRefused {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  if (trees.projectPublic === undefined) {
    return { ok: false, reason: 'NO_PROJECT' };
  }
  return withScopedCaches(trees, (sources) => {
    const anchors = anchorForms(sources);
    // `--who` takes the same value this read PRINTS, so it accepts the same short
    // form. Left unresolved, a prefix would filter on a `who` that matches nothing
    // and come back as an account of zero facts — the one answer that looks like an
    // answer and is not.
    if (input.who !== undefined) {
      const who = resolveTypedAnchor(input.who, anchors);
      if (!who.ok) {
        return { ok: false, reason: 'REFUSED', code: who.code, message: who.message };
      }
      return { ok: true, anchors, account: accountability(sources, { ...input, who: who.anchor }) };
    }
    return { ok: true, anchors, account: accountability(sources, input) };
  });
}
