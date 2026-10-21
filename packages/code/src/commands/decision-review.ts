/**
 * `mnema decision review`: the decisions awaiting a judgement, read for a person to go through
 * one by one.
 *
 * This file is the READ half. It lists what is proposed, in the order `mnema status` lists it
 * (most recently moved first), with the argument each one carries, and it writes nothing: the
 * moves are `runDecisionTransition`'s, called by the wiring once per verdict, so a review has
 * no way into the record that `decision move` does not have (the gate, the key, the state
 * machine and the refusal codes are the same ones).
 */

import { proposedDecisionsNewestFirst } from '@mnema/context';
import { type DiscoveryEnv, resolveTrees } from '@mnema/core';
import {
  caches,
  linkBreaksOf,
  type ScopedLinkBreak,
  THE_READING_THAT_OPENED_THESE,
  withScopedCaches,
} from '../tree-sources.js';

/** One proposed decision, with what a person needs to judge it. */
export interface ProposalToReview {
  readonly id: string;
  readonly adr: string;
  readonly title: string;
  readonly rationale: string;
  readonly alternatives?: string;
}

/** What is waiting, or why there is nothing to read. */
export type ProposalsToReview =
  | {
      readonly ok: true;
      readonly proposals: readonly ProposalToReview[];
      /** The tails read that do not chain: what is shown came off a record whose proof is broken. */
      readonly linkBreaks: readonly ScopedLinkBreak[];
    }
  | { readonly ok: false; readonly reason: 'NO_PROJECT' };

/** Every decision awaiting a judgement in the trees of the project here, newest move first. */
export function proposalsToReview(ctx: {
  readonly cwd: string;
  readonly env: DiscoveryEnv;
}): ProposalsToReview {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  if (trees.projectPublic === undefined) return { ok: false, reason: 'NO_PROJECT' };
  return withScopedCaches(trees, (sources) => {
    const proposals: ProposalToReview[] = [];
    for (const item of proposedDecisionsNewestFirst(caches(sources))) {
      for (const { cache } of sources) {
        const decision = cache.getDecision(item.id);
        if (decision === null) continue;
        proposals.push({
          id: decision.id,
          adr: decision.adr,
          title: decision.title,
          rationale: decision.rationale,
          ...(decision.alternatives !== undefined && decision.alternatives !== ''
            ? { alternatives: decision.alternatives }
            : {}),
        });
        break;
      }
    }
    return {
      ok: true,
      proposals,
      linkBreaks: linkBreaksOf(sources, THE_READING_THAT_OPENED_THESE),
    };
  });
}
