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

import { catalogUpcasters } from '@mnema/chain';
import { type Accountability, type AccountabilityFilter, accountability } from '@mnema/copilot';
import {
  type DiscoveryEnv,
  type FoundedBeside,
  identitiesFoundedBeside,
  orderedEvents,
  resolveTrees,
  type Scope,
} from '@mnema/core';
import { treesOf } from '../a-new-identity.js';
import { type AnchorForms, anchorForms, resolveTypedAnchor } from '../anchors.js';
import {
  linkBreaksOf,
  type ScopedLinkBreak,
  THE_READING_THAT_OPENED_THESE,
  withScopedCaches,
} from '../tree-sources.js';

/** What the accountability command needs — injected so it is testable. */
export interface AccountabilityContext {
  /** The working directory to resolve the project from. */
  readonly cwd: string;
  /** The discovery environment (`$HOME`, `$MNEMA_HOME`). */
  readonly env: DiscoveryEnv;
}

/** The factual account of authorship over the record, within the optional filter. */
export interface AccountabilityDone {
  readonly ok: true;
  /** The account itself — total facts and one entry per authorizing `who`. */
  readonly account: Accountability;
  /** How each identity this record knows is written for a person. */
  readonly anchors: AnchorForms;
  /**
   * The tails among those read that do not chain — empty for a sound record, which is
   * every record this product wrote on its own. See {@link linkBreaksOf}: what is served
   * beside it came off a record whose proof this is the state of, and the wiring is what
   * says so.
   */
  readonly linkBreaks: readonly ScopedLinkBreak[];
  /**
   * Every identity founded, in one of the trees read, after other identities were already
   * founded there — with the tree it happened in. A person new to a team's record reads here
   * as surely as one person who arrived under a second key; the account says which identity,
   * where and when, and the person reading it knows which of the two it was. It is the same
   * reading the write says at the moment it founds (`a-new-identity.ts`), asked of the whole
   * record. Both forms of the account print it beside its author through
   * {@link foundedBesideOf}.
   */
  readonly foundedBeside: readonly { readonly scope: Scope; readonly founding: FoundedBeside }[];
}

/** One founding beside others, as the account reports it beside the identity it founded. */
export interface FoundedBesideMark {
  /** The tree it happened in. */
  readonly scope: Scope;
  /** When, as the founding carries it. */
  readonly at: string;
  /** The identities already founded there, in the order the record has them. */
  readonly besides: readonly string[];
}

/**
 * The foundings beside others of the identity `who` — what BOTH forms of the account print beside
 * that author: the line of the human summary, and the author's entry in `--json`. One selection of
 * one reading ({@link AccountabilityDone.foundedBeside}), so the two cannot come to disagree about
 * who arrived second. `--json` carried none of it until this existed, and only the line knew.
 */
export function foundedBesideOf(done: AccountabilityDone, who: string): FoundedBesideMark[] {
  return done.foundedBeside
    .filter(({ founding }) => founding.anchor === who)
    .map(({ scope, founding }) => ({ scope, at: founding.at, besides: founding.besides }));
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
  const foundedBeside = treesOf(trees).flatMap(({ root, scope }) =>
    identitiesFoundedBeside(orderedEvents({ root }, catalogUpcasters())).map((founding) => ({
      scope,
      founding,
    })),
  );
  return withScopedCaches(trees, (sources) => {
    const anchors = anchorForms(sources);
    const linkBreaks = linkBreaksOf(sources, THE_READING_THAT_OPENED_THESE);
    // `--who` takes the same value this read PRINTS, so it accepts the same short
    // form. Left unresolved, a prefix would filter on a `who` that matches nothing
    // and come back as an account of zero facts — the one answer that looks like an
    // answer and is not.
    if (input.who !== undefined) {
      const who = resolveTypedAnchor(input.who, anchors);
      if (!who.ok) {
        return { ok: false, reason: 'REFUSED', code: who.code, message: who.message };
      }
      return {
        ok: true,
        anchors,
        linkBreaks,
        foundedBeside,
        account: accountability(sources, { ...input, who: who.anchor }),
      };
    }
    return {
      ok: true,
      anchors,
      linkBreaks,
      foundedBeside,
      account: accountability(sources, input),
    };
  });
}
