/**
 * `mnema trailer <decision>` — the line that ties a commit to a decision, printed and nothing else.
 *
 * It writes no commit, runs no git and records nothing: the line goes where the person puts it
 * (`git commit --trailer "$(mnema trailer ADR-4)"`, or the end of a message). The reading side is
 * `mnema commits` and `mnema why`.
 *
 * The line carries the LABEL when exactly one decision of the trees holds it, because that is what
 * a person reads in `git log`; `--id` carries the id instead, which names the decision whichever
 * tree it is read in (a label is numbered inside one tree, and two clones can each mint the same).
 */

import { dirname } from 'node:path';
import { type DiscoveryEnv, resolveTrees } from '@mnema/core';
import { type DecisionFacts, nameOf, readDecisionFacts } from '../decisions-in-git.js';
import { TRAILER } from '../git-log.js';
import {
  linkBreaksOf,
  type ScopedLinkBreak,
  THE_READING_THAT_OPENED_THESE,
  withScopedCaches,
} from '../tree-sources.js';

/** What the command needs — injected so it is testable. */
export interface TrailerContext {
  readonly cwd: string;
  readonly env: DiscoveryEnv;
}

/** The line, and the decision it is for. */
export interface TrailerDone {
  readonly ok: true;
  readonly line: string;
  readonly title: string;
  readonly linkBreaks: readonly ScopedLinkBreak[];
}

/** The read was refused before it ran. */
export type TrailerRefused =
  | { readonly ok: false; readonly reason: 'NO_PROJECT' }
  | { readonly ok: false; readonly reason: 'NO_SUCH_DECISION'; readonly typed: string }
  | {
      readonly ok: false;
      readonly reason: 'AMBIGUOUS_LABEL';
      readonly typed: string;
      readonly ids: readonly string[];
    };

/**
 * The trailer line that cites `decision`: its label, or its id when asked or when a second
 * decision carries the same label — a label two decisions carry cites neither of them.
 */
export function trailerLine(
  all: readonly DecisionFacts[],
  decision: DecisionFacts,
  byId: boolean,
): string {
  const carriers = all.filter((one) => one.adr === decision.adr).length;
  return `${TRAILER}: ${byId || carriers > 1 ? decision.id : decision.adr}`;
}

/** Composes the trailer for `input.decision`. */
export function runTrailer(
  ctx: TrailerContext,
  input: { decision: string; byId: boolean },
): TrailerDone | TrailerRefused {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  if (trees.projectPublic === undefined) return { ok: false, reason: 'NO_PROJECT' };
  const root = dirname(trees.projectPublic);
  return withScopedCaches(trees, (sources): TrailerDone | TrailerRefused => {
    const all = readDecisionFacts(sources, root);
    const named = nameOf(all, input.decision);
    if (named.kind === 'none') {
      return { ok: false, reason: 'NO_SUCH_DECISION', typed: input.decision };
    }
    if (named.kind === 'ambiguous') {
      return { ok: false, reason: 'AMBIGUOUS_LABEL', typed: input.decision, ids: named.ids };
    }
    const { decision } = named;
    return {
      ok: true,
      line: trailerLine(all, decision, input.byId),
      title: decision.title,
      linkBreaks: linkBreaksOf(sources, THE_READING_THAT_OPENED_THESE),
    };
  });
}
