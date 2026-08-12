/**
 * `mnema resume --actor <id>` — where an actor left off: their latest run.
 *
 * The sibling of `focus`, and the same read-only shape: open a projection cache over
 * every tree of the project, rebuild, and hand them to the copilot's PURE `resume`
 * derivation. It opens no writer, emits no event, mints no key. The
 * actor is a required flag for the same reason `focus` requires it — the record
 * has no "current actor", an invocation of this CLI has no session `who`, and
 * deriving one would touch key material the surface must not own. The derivation
 * takes the actor as a parameter, so passing it keeps the read truly read-only.
 *
 * IT SAID *THE CLI* HAS NO SESSION `who`, and the console is one: `mnema repl`
 * resolves the identity from local material with no writer opened, and fills this flag
 * in for a caller who would otherwise type back what its own panel shows
 * (`repl/asking.ts`). The declaration and its reason are untouched — see `focus.ts`,
 * where the whole argument is written out.
 *
 * `resume` answers "where was I" even for a run that ALREADY ENDED — the latest
 * run by start time, open or not, carries the goal that reminds the actor what it
 * was — and composes the actor's current `focus` for the "what is still open"
 * half. The adapter adds nothing; it only resolves the tree and forwards.
 *
 * It reads runs from every tree, for the reason `focus` does: a run lives in the
 * tree of the fact it authorizes, so one session's runs are spread across the trees
 * it wrote to. And every tree answers a second question either way — the identities
 * the record knows, which decide how short the actor may be written.
 */

import { type Resume, resume } from '@mnema/copilot';
import { type Clock, type DiscoveryEnv, resolveTrees, systemClock } from '@mnema/core';
import { type AnchorForms, anchorForms, resolveTypedAnchor } from '../anchors.js';
import { caches, withScopedCaches } from '../tree-sources.js';

/** What the resume command needs — injected so it is testable. */
export interface ResumeContext {
  /** The working directory to resolve the project from. */
  readonly cwd: string;
  /** The discovery environment (XDG/home). */
  readonly env: DiscoveryEnv;
  /** The clock the ages are measured against; defaults to the wall clock. */
  readonly clock?: Clock;
}

/** Where the actor left off, over the tree that was read. */
export interface ResumeDone {
  readonly ok: true;
  /** The derivation's result — the actor's latest run and current focus. */
  readonly resume: Resume;
  /** How each identity this record knows is written for a person. */
  readonly anchors: AnchorForms;
}

/** There was no project here, or the actor named no identity in it. */
export type ResumeRefused =
  | { readonly ok: false; readonly reason: 'NO_PROJECT' }
  | {
      readonly ok: false;
      readonly reason: 'REFUSED';
      readonly code: string;
      readonly message: string;
    };

/**
 * Derives where the actor left off over every tree of the current project.
 * Opens a cache per visible tree, rebuilds them, and returns the copilot's
 * `resume` for the given actor — their latest run (open or ended) plus their
 * focus. Read-only: no writer, no event. With no project found it refuses
 * `NO_PROJECT`; an actor that names no identity here is refused too, rather than
 * answered about.
 */
export function runResume(
  ctx: ResumeContext,
  input: { actor: string },
): ResumeDone | ResumeRefused {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  // The committed tree, for the reason `focus` gives: it is where a command-line run
  // is born, and both project trees are present or absent together anyway.
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
      // Empty, like `focus`: a read opens no run, so nothing here is this command's
      // own and the "prefer my own run" rule has nothing to prefer. The answer stays
      // what it was — the actor's latest run — which is the right one for a person
      // asking from the command line about work an agent did.
      resume: resume(caches(sources), {
        actor: actor.anchor,
        asOf: (ctx.clock ?? systemClock)(),
        sessionRuns: [],
      }),
    };
  });
}
