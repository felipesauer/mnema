/**
 * `mnema resume --actor <id>` — where an actor left off: their latest run.
 *
 * The sibling of `focus`, and the same read-only shape: open the projection cache
 * over the project's private tree, rebuild, and hand it to the copilot's PURE
 * `resume` derivation. It opens no writer, emits no event, mints no key. The
 * actor is a required flag for the same reason `focus` requires it — the record
 * has no "current actor", the CLI has no session `who`, and deriving one would
 * touch key material the surface must not own. The derivation takes the actor as
 * a parameter, so passing it keeps the read truly read-only.
 *
 * `resume` answers "where was I" even for a run that ALREADY ENDED — the latest
 * run by start time, open or not, carries the goal that reminds the actor what it
 * was — and composes the actor's current `focus` for the "what is still open"
 * half. The adapter adds nothing; it only resolves the tree and forwards.
 *
 * It opens every tree and reads runs from one, for the reason `focus` does: the
 * identities the record knows are what decide how short the actor is written and
 * what a typed prefix may mean, and that set belongs to the record rather than to
 * the tree the runs happen to live in.
 */

import { type Resume, resume } from '@mnema/copilot';
import {
  type Clock,
  type DiscoveryEnv,
  type ProjectionCache,
  resolveTrees,
  systemClock,
} from '@mnema/core';
import { type AnchorForms, anchorForms, resolveTypedAnchor } from '../anchors.js';
import { withScopedCaches } from '../tree-sources.js';

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
 * Derives where the actor left off over the current project's private tree.
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
  if (trees.projectPrivate === undefined) {
    return { ok: false, reason: 'NO_PROJECT' };
  }
  return withScopedCaches(trees, (sources) => {
    const anchors = anchorForms(sources);
    const actor = resolveTypedAnchor(input.actor, anchors);
    if (!actor.ok) {
      return { ok: false, reason: 'REFUSED', code: actor.code, message: actor.message };
    }
    // Present because the project's private tree was checked above, and
    // `withScopedCaches` only leaves out a tree the context does not have.
    const cache = sources.find((source) => source.scope === 'private')?.cache as ProjectionCache;
    return {
      ok: true,
      anchors,
      // Empty, like `focus`: a read opens no run, so nothing here is this command's
      // own and the "prefer my own run" rule has nothing to prefer. The answer stays
      // what it was — the actor's latest run — which is the right one for a person
      // asking from the command line about work an agent did.
      resume: resume(cache, {
        actor: actor.anchor,
        asOf: (ctx.clock ?? systemClock)(),
        sessionRuns: [],
      }),
    };
  });
}
