/**
 * `mnema aging` — accepted decisions whose addressed paths have changed a lot since they were
 * accepted. It POINTS and never CONCLUDES.
 *
 * THE CRITERION IS ONE NUMBER, said on the page and settable by a flag: the commits made since
 * the decision was accepted that touched a path it addresses. A decision is listed when that
 * number reaches `--min-commits` (default {@link DEFAULT_MIN_COMMITS}). Nothing else is counted
 * — not lines, not authors — because a second criterion would be a second thing to disagree
 * about, and this one can be re-run with `git log` by anyone who doubts it.
 *
 * WHAT A LISTED DECISION MEANS: that the code it speaks about moved a lot. Not that the decision
 * is wrong, not that anyone must revisit it; a decision about a file that is edited every day
 * because the decision is being followed is listed too. The reading has no way to tell those
 * apart and does not try.
 *
 * Only decisions whose state is `accepted` and that hold an address in force are asked about:
 * without an address there is nothing whose changes could be counted. The date is the last
 * transition, which for an accepted decision is the acceptance. Nothing is written.
 */

import { dirname } from 'node:path';
import { type DecisionState, type DiscoveryEnv, resolveTrees } from '@mnema/core';
import { readDecisionFacts } from '../decisions-in-git.js';
import { commitsSince, inAWorkTree, isShallow } from '../git-log.js';
import {
  linkBreaksOf,
  type ScopedLinkBreak,
  THE_READING_THAT_OPENED_THESE,
  withScopedCaches,
} from '../tree-sources.js';

/** The state of a decision that governs: the one whose acceptance the count starts from. */
const ACCEPTED: DecisionState = 'accepted';

/** How many commits on its addresses it takes to be listed, when the caller says nothing. */
export const DEFAULT_MIN_COMMITS = 20;

/** What the command needs — injected so it is testable. */
export interface AgingContext {
  readonly cwd: string;
  readonly env: DiscoveryEnv;
}

/** One listed decision. */
export interface Aged {
  readonly id: string;
  readonly adr: string;
  readonly title: string;
  /** When it was accepted, ISO-8601. */
  readonly acceptedAt: string;
  readonly addresses: readonly string[];
  /** Commits since the acceptance that touched an address of it. */
  readonly touching: number;
  /** Commits since the acceptance, in all. */
  readonly all: number;
}

/** The reading. `git` is false when there is no work tree — then nothing is listed. */
export interface AgingDone {
  readonly ok: true;
  readonly git: boolean;
  /** Whether the clone holds only part of the history. */
  readonly shallow: boolean;
  readonly minCommits: number;
  /** How many accepted decisions with an address were looked at. */
  readonly looked: number;
  readonly aged: readonly Aged[];
  readonly linkBreaks: readonly ScopedLinkBreak[];
}

/** The read was refused before it ran. */
export type AgingRefused = { readonly ok: false; readonly reason: 'NO_PROJECT' };

/** Lists the accepted decisions whose addresses changed in at least `input.minCommits` commits since. */
export function runAging(
  ctx: AgingContext,
  input: { minCommits: number },
): AgingDone | AgingRefused {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  if (trees.projectPublic === undefined) return { ok: false, reason: 'NO_PROJECT' };
  const root = dirname(trees.projectPublic);
  return withScopedCaches(trees, (sources): AgingDone => {
    const asked = readDecisionFacts(sources, root).filter(
      (decision) => decision.state === ACCEPTED && decision.addresses.length > 0,
    );
    const git = inAWorkTree(root);
    const aged: Aged[] = [];
    if (git) {
      for (const decision of asked) {
        const counted = commitsSince(root, decision.settledAt, decision.addresses);
        if (counted === null || counted.touching < input.minCommits) continue;
        aged.push({
          id: decision.id,
          adr: decision.adr,
          title: decision.title,
          acceptedAt: decision.settledAt,
          addresses: decision.addresses,
          touching: counted.touching,
          all: counted.all,
        });
      }
    }
    aged.sort((a, b) => b.touching - a.touching || (a.id < b.id ? -1 : 1));
    return {
      ok: true,
      git,
      shallow: git && isShallow(root),
      minCommits: input.minCommits,
      looked: asked.length,
      aged,
      linkBreaks: linkBreaksOf(sources, THE_READING_THAT_OPENED_THESE),
    };
  });
}
