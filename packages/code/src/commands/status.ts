/**
 * `mnema status --actor <id>` — where things stand: the opening read, on the surface a
 * person uses.
 *
 * IT DERIVES NOTHING. The opening context is `@mnema/copilot`'s `bootstrap`, and this
 * adapter opens a projection cache over every tree of the project, rebuilds it, resolves
 * the actor and forwards — the same shape `focus` and `resume` have, and the same
 * strictness: no writer, no event, no key minted. The agent-facing surface serves the
 * SAME call (`mcp/tools.ts`, `runBootstrap`), so the two doors cannot come to disagree
 * about what is live, what governs, or what is still waiting on somebody
 * (`where-things-stand.test.ts` — "the CLI's `--json` and the MCP's payload are the same
 * answer").
 *
 * WHY THERE IS A SECOND DOOR AT ALL. The derivation existed and was reachable from one
 * surface only: `runBootstrap` was called by the MCP server and by nothing else, and
 * `mnema --help` had no opening read. An agent could ask where things stood; the person
 * whose record it is could not, and had to assemble the answer from four separate reads
 * and know to run all four.
 *
 * WHY THE ACTOR IS EXPLICIT, which is `focus`'s reason unchanged. Half of this answer is
 * `resume`, and a resume is always SOMEONE's; the record carries no notion of a "current
 * actor" (a `who` is only ever stamped on past events) and an invocation of this CLI has
 * no session to read one from. Deriving the machine's `who` without a writer means
 * touching key material, which mints a key on a fresh machine — domain logic a surface
 * must not own. So the actor is a required flag, exactly as it is on the two context
 * reads that came before, and passing it keeps the read truly read-only.
 *
 * IT SAID *THE CLI HAS NO SESSION*, and this verb is where that stopped being true in
 * a way anybody could feel: `status` typed at the console's prompt was answered with a
 * demand for the identity the box two rows above it was naming. A session resolves that
 * identity from local material with no writer opened, so it fills the flag in
 * (`repl/asking.ts`) — and what the caller types still wins. The declaration is
 * unchanged, and `mnema status` at a shell asks exactly as it always has.
 *
 * EVERY TREE, and the four lists take the union for the reason `bootstrap` gives: a task
 * lands in the tree that travels and a memory in this machine's own, whoever wrote
 * either, so "the actor's tree" names none of them in particular and a work list read
 * from one comes back empty while looking like an answer.
 */

import { type Bootstrap, bootstrap } from '@mnema/copilot';
import { type Clock, type DiscoveryEnv, resolveTrees, systemClock } from '@mnema/core';
import { type AnchorForms, anchorForms, resolveTypedAnchor } from '../anchors.js';
import { caches, withScopedCaches } from '../tree-sources.js';

/** What the status command needs — injected so it is testable. */
export interface StatusContext {
  /** The working directory to resolve the project from. */
  readonly cwd: string;
  /** The discovery environment (XDG/home). */
  readonly env: DiscoveryEnv;
  /** The clock the run ages are measured against; defaults to the wall clock. */
  readonly clock?: Clock;
}

/** Where things stand, over the trees that were read. */
export interface StatusDone {
  readonly ok: true;
  /** The derivation's result — the whole opening context, unaltered. */
  readonly status: Bootstrap;
  /** How each identity this record knows is written for a person. */
  readonly anchors: AnchorForms;
}

/** There was no project here, or the actor named no identity in it. */
export type StatusRefused =
  | { readonly ok: false; readonly reason: 'NO_PROJECT' }
  | {
      readonly ok: false;
      readonly reason: 'REFUSED';
      readonly code: string;
      readonly message: string;
    };

/**
 * Derives the opening context over every tree of the current project: where the actor
 * left off, the live work, the adopted patterns, the decisions in force, and what
 * awaits a judgement. Read-only: no writer, no event. With no project found it refuses
 * `NO_PROJECT`; an actor that names no identity here is refused rather than answered
 * about.
 */
export function runStatus(
  ctx: StatusContext,
  input: { actor: string },
): StatusDone | StatusRefused {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  // The committed tree, for the reason the other context reads give: it is where a
  // command-line run is born, and both project trees are present or absent together.
  if (trees.projectPublic === undefined) {
    return { ok: false, reason: 'NO_PROJECT' };
  }
  return withScopedCaches(trees, (sources) => {
    const anchors = anchorForms(sources);
    const actor = resolveTypedAnchor(input.actor, anchors);
    if (!actor.ok) {
      return { ok: false, reason: 'REFUSED', code: actor.code, message: actor.message };
    }
    return {
      ok: true,
      anchors,
      // No run is this command's own: a read opens none, and the process is gone by the
      // time the next one asks. So the "prefer my own run" rule has nothing to prefer
      // and the answer stays the actor's latest — which is the right one for a person
      // asking from the command line about work an agent did.
      status: bootstrap(caches(sources), {
        actor: actor.anchor,
        asOf: (ctx.clock ?? systemClock)(),
        sessionRuns: [],
      }),
    };
  });
}
