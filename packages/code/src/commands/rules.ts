/**
 * `mnema rules <path>` — which recorded rules govern a path, and which rules of
 * this project address nothing at all.
 *
 * The reverse reading of the relations that carry an ADDRESS — `governs` and
 * `asks-for-a-person`, which is what `ADDRESS_RELATIONS` names. This line said "the
 * ONE relation" until the gate shipped as a second label of the same shape, and it said
 * "whose target is a path" until the decision import shipped a THIRD label with a path
 * target and no address in it (`derived-from`, the file a proposal was read from). What
 * this walks inward from is a region of the tree, so the list it needs is the one about
 * coverage and never the one about the shape of a string. `refs` walks
 * outward from an entity; this walks INWARD from a place in the code: a decision
 * that was accepted, linked with `--rel governs` to `src/billing`, is a rule with
 * an ADDRESS, and this is what finds it from the file rather than from the id.
 *
 * It charges nothing. Nothing here refuses a move, blocks a write or grades the
 * work — it reports, and the id it reports is what a later charge would have to
 * cite. It does not decide which rules still hold either: a rule's state travels
 * out beside it, and reading it is the caller's.
 *
 * THREE NUMBERS, ALWAYS. How many rules cover this path, how many address the
 * project at all, and how many name something the working tree no longer holds.
 * The third is the one that cannot be dropped: an address whose file was moved or
 * deleted stops governing in silence, and without a count of those a quiet answer
 * and an empty mechanism read the same.
 *
 * Like the other intelligence reads it refuses `NO_PROJECT` outside a project —
 * an address is relative to a project root, so outside one there is no root to be
 * relative to. Read-only in the strict sense: a cache per tree rebuilt in memory,
 * the copilot's pure derivation, and one `existsSync` per address. No writer, no
 * key, no event — so no `--actor`.
 */

import { dirname } from 'node:path';
import type { GoverningRules } from '@mnema/copilot';
import { type DiscoveryEnv, resolveTrees } from '@mnema/core';
import { readGoverningRules } from '../governed-tree.js';
import { withScopedCaches } from '../tree-sources.js';

/** What the rules command needs — injected so it is testable. */
export interface RulesContext {
  /** The working directory: the project is resolved from it, and so is a relative path. */
  readonly cwd: string;
  /** The discovery environment (XDG/home). */
  readonly env: DiscoveryEnv;
}

/** What governs the path, and what the project's addresses look like around it. */
export interface RulesDone {
  readonly ok: true;
  readonly governed: GoverningRules;
}

/** The read was refused before it ran. */
export type RulesRefused =
  /** There is no project here — an address is relative to a project root. */
  { readonly ok: false; readonly reason: 'NO_PROJECT' };

/**
 * Reports which rules govern `input.path`. A path nothing addresses yields an empty
 * list and three numbers — a legitimate answer ("nothing governs this"), never a
 * refusal, and the numbers beside it are what tell that answer from a project whose
 * record has no addresses at all. A path outside the project is answered too: the
 * reply carries no relative path, which is how it says the question was about
 * somewhere else.
 */
export function runRules(ctx: RulesContext, input: { path: string }): RulesDone | RulesRefused {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  if (trees.projectPublic === undefined) {
    return { ok: false, reason: 'NO_PROJECT' };
  }
  // The project root is the PARENT of its `.mnema/` — the directory every address
  // in the record is written against.
  const root = dirname(trees.projectPublic);
  return withScopedCaches(trees, (sources) => ({
    ok: true,
    governed: readGoverningRules(sources, { path: input.path, root, from: ctx.cwd }),
  }));
}
