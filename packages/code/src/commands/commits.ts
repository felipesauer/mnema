/**
 * `mnema commits <decision>` — the commits that cite a decision and the commits that touched
 * what it addresses, read from git when asked.
 *
 * TWO LISTS, BECAUSE THEY ARE TWO DIFFERENT FACTS. A commit that carries the decision's
 * `Mnema-Decision` trailer says its author tied the change to the decision; a commit that touched
 * a path the decision addresses says only that the change landed where the decision speaks — the
 * author may never have heard of it. Merging them would turn the second into the first.
 *
 * NOTHING IS WRITTEN: not a pointer to a commit, not a count, not an event. A commit can vanish
 * in a rebase, and the record would be left holding a signed pointer at nothing (see
 * `git-log.ts`). Read-only in the strict sense: a cache per tree rebuilt in memory and a few
 * bounded `git log`s.
 */

import { dirname } from 'node:path';
import { type DiscoveryEnv, resolveTrees } from '@mnema/core';
import { cites, type DecisionFacts, nameOf, readDecisionFacts } from '../decisions-in-git.js';
import { type Commit, commitsTouching, commitsWithTrailer, LISTED } from '../git-log.js';
import {
  linkBreaksOf,
  type ScopedLinkBreak,
  THE_READING_THAT_OPENED_THESE,
  withScopedCaches,
} from '../tree-sources.js';

/** What the command needs — injected so it is testable. */
export interface CommitsContext {
  readonly cwd: string;
  readonly env: DiscoveryEnv;
}

/** A page of commits, and whether the log held more than the page. */
export interface CommitPage {
  readonly commits: readonly Commit[];
  readonly more: boolean;
}

/** The reading. `git` is false when there is no git work tree to read — the lists are then empty. */
export interface CommitsDone {
  readonly ok: true;
  readonly decision: Pick<DecisionFacts, 'id' | 'adr' | 'title' | 'state'>;
  /** The paths the decision addresses — empty for a decision that is not in force. */
  readonly addresses: readonly string[];
  readonly git: boolean;
  /** The commits carrying a trailer that cites it. */
  readonly cited: CommitPage;
  /** The commits that touched an address of it. */
  readonly touching: CommitPage;
  readonly linkBreaks: readonly ScopedLinkBreak[];
}

/** The read was refused before it ran. */
export type CommitsRefused =
  | { readonly ok: false; readonly reason: 'NO_PROJECT' }
  | { readonly ok: false; readonly reason: 'NO_SUCH_DECISION'; readonly typed: string }
  | {
      readonly ok: false;
      readonly reason: 'AMBIGUOUS_LABEL';
      readonly typed: string;
      readonly ids: readonly string[];
    };

/** A page: the first {@link LISTED}, and whether there was one more behind them. */
function pageOf(commits: readonly Commit[]): CommitPage {
  return { commits: commits.slice(0, LISTED), more: commits.length > LISTED };
}

/** Reads the commits that cite, and the commits that touch the addresses of, `input.decision`. */
export function runCommits(
  ctx: CommitsContext,
  input: { decision: string },
): CommitsDone | CommitsRefused {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  if (trees.projectPublic === undefined) return { ok: false, reason: 'NO_PROJECT' };
  const root = dirname(trees.projectPublic);
  return withScopedCaches(trees, (sources): CommitsDone | CommitsRefused => {
    const all = readDecisionFacts(sources, root);
    const named = nameOf(all, input.decision);
    if (named.kind === 'none') {
      return { ok: false, reason: 'NO_SUCH_DECISION', typed: input.decision };
    }
    if (named.kind === 'ambiguous') {
      return { ok: false, reason: 'AMBIGUOUS_LABEL', typed: input.decision, ids: named.ids };
    }
    const { decision } = named;
    const withTrailer = commitsWithTrailer(root);
    const touching = commitsTouching(root, decision.addresses);
    return {
      ok: true,
      decision: {
        id: decision.id,
        adr: decision.adr,
        title: decision.title,
        state: decision.state,
      },
      addresses: decision.addresses,
      git: withTrailer !== null && touching !== null,
      cited: pageOf(
        (withTrailer ?? []).filter((commit) =>
          commit.cites.some((value) => cites(all, decision, value)),
        ),
      ),
      touching: pageOf(touching ?? []),
      linkBreaks: linkBreaksOf(sources, THE_READING_THAT_OPENED_THESE),
    };
  });
}
