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

import { decisionsAwaitingJudgement } from '@mnema/context';
import { newestFirst, resolveTrees } from '@mnema/core';
import { withScopedCaches } from '../tree-sources.js';
import type { DecisionTransitionContext } from './decision-transition.js';

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
  | { readonly ok: true; readonly proposals: readonly ProposalToReview[] }
  | { readonly ok: false; readonly reason: 'NO_PROJECT' };

/** Every decision awaiting a judgement in the trees of the project here, newest move first. */
export function proposalsToReview(
  ctx: Pick<DecisionTransitionContext, 'cwd' | 'env'>,
): ProposalsToReview {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  if (trees.projectPublic === undefined) return { ok: false, reason: 'NO_PROJECT' };
  return withScopedCaches(trees, (sources) => {
    const waiting = sources
      .flatMap((source) =>
        decisionsAwaitingJudgement([source.cache]).map((item) => ({ item, source })),
      )
      .sort((a, b) =>
        newestFirst(
          { at: a.item.updatedAt, id: a.item.id },
          { at: b.item.updatedAt, id: b.item.id },
        ),
      );
    const proposals: ProposalToReview[] = [];
    for (const { item, source } of waiting) {
      const decision = source.cache.getDecision(item.id);
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
    }
    return { ok: true, proposals };
  });
}
