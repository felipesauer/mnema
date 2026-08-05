/**
 * `mnema brief` — what governs the work here, as the file an agent reads anyway.
 *
 * Every other read answers someone who asked. This one exists because the measured
 * weakness of the product is that adoption depends on the agent ASKING: three rounds
 * of use showed an agent that does go looking, but through a door that was not the
 * one designed for it — and over an empty record it concludes there is nothing
 * there. A markdown file at the root of the repository has no such problem. It
 * arrives without being asked: `AGENTS.md` is an open convention read natively by
 * several hosts, `CLAUDE.md` is read when a session opens, and the cost of being
 * read is zero.
 *
 * What those files lack is provenance — hand-kept instruction with no author, no
 * state and no supersession, rotting in silence. So this does not replace the
 * record with a file; it PROJECTS one out of it. The record stays the thing with the
 * proof, and the file is a cache that can be thrown away and made again, which is
 * the product's own doctrine about every projection it keeps.
 *
 * IT WRITES NOTHING, and that is deliberate to the point of being the design. The
 * output goes to stdout and `mnema brief > AGENTS.md` is the operator's choice, not
 * this verb's: mnema has never written outside its own tree, and writing into a file
 * the user owns opens the whole question of who owns it — what happens to a hand
 * edit, when it is regenerated, whether a `git status` goes dirty in the middle of
 * an agent's session. A redirection answers all three by never being ours.
 *
 * THERE IS NO `--check` EITHER, for the same reason and one more: `mnema brief |
 * diff - AGENTS.md` already answers "is the copy stale", exactly, with a tool every
 * operator has. A flag that read the user's file would be new surface for what a
 * pipe does — and it would have to guess where that file is.
 *
 * And no `--actor`. Measured: only the two reads that answer ABOUT AN ACTOR (`focus`,
 * `resume`) need one, and every read that answers about the project takes none. What
 * governs here is a property of the record, not of who is asking.
 *
 * IT REFUSES OUTSIDE A PROJECT, unlike `search` and `skills`, and the difference is
 * what the answer is FOR. Those two audit whatever record the caller can see, and
 * outside a project that is a person's own global tree — a legitimate thing to
 * search. This composes a document that says "recorded for this project" and is
 * meant to be redirected into that project's repository. With no project there is no
 * repository to put it in, and printing a person's global conventions under that
 * heading would be the answer that is wrong while looking right.
 *
 * Read-only in the strict sense: a cache per visible tree, rebuilt in memory, and
 * the copilot's pure `brief`. No writer, no key, no event, no consultation recorded
 * (serving a pattern's BODY records one; serving its name is not serving it, and
 * this never touches a body).
 */

import { type Brief, brief } from '@mnema/copilot';
import { type DiscoveryEnv, resolveTrees } from '@mnema/core';
import { caches, withScopedCaches } from '../tree-sources.js';

/** What the brief needs — injected so it is testable. */
export interface BriefContext {
  /** The working directory to resolve the trees from. */
  readonly cwd: string;
  /** The discovery environment (XDG/home). */
  readonly env: DiscoveryEnv;
}

/** What governs the work here: the decisions in force and the adopted patterns. */
export interface BriefDone {
  readonly ok: true;
  /**
   * Both lists, whole. Empty is a legitimate answer and the document says which kind
   * of empty it is — nobody has decided yet, not "there are no rules".
   */
  readonly brief: Brief;
}

/** The read was refused — there is no project to compose a brief for. */
export interface BriefRefused {
  readonly ok: false;
  readonly reason: 'NO_PROJECT';
}

/**
 * Composes what governs the work here, across every tree visible from `ctx.cwd`.
 *
 * The caches go in WITHOUT their scopes, which is the shape of the answer and not a
 * loss: a decision governs the work here whichever tree holds it — the team's, this
 * machine's, or the personal one — and the document names no tree, so labelling one
 * would be a column no reader of it could act on.
 */
export function runBrief(ctx: BriefContext): BriefDone | BriefRefused {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  if (trees.projectPublic === undefined) {
    return { ok: false, reason: 'NO_PROJECT' };
  }
  return withScopedCaches(trees, (sources) => ({ ok: true, brief: brief(caches(sources)) }));
}
