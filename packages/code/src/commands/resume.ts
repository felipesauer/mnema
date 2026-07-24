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
 */

import { catalogUpcasters } from '@mnema/chain';
import { type Resume, resume } from '@mnema/copilot';
import { chainRootForScope, type DiscoveryEnv, ProjectionCache, resolveTrees } from '@mnema/core';

/** What the resume command needs — injected so it is testable. */
export interface ResumeContext {
  /** The working directory to resolve the project from. */
  readonly cwd: string;
  /** The discovery environment (XDG/home). */
  readonly env: DiscoveryEnv;
}

/** Where the actor left off, over the tree that was read. */
export interface ResumeDone {
  readonly ok: true;
  /** The derivation's result — the actor's latest run and current focus. */
  readonly resume: Resume;
}

/** There was no project here — a context read needs one. */
export type ResumeRefused = { readonly ok: false; readonly reason: 'NO_PROJECT' };

/**
 * Derives where the actor left off over the current project's private tree.
 * Opens the cache, rebuilds it from the chain, and returns the copilot's `resume`
 * for the given actor — their latest run (open or ended) plus their focus.
 * Read-only: no writer, no event. With no project found it refuses `NO_PROJECT`.
 */
export function runResume(
  ctx: ResumeContext,
  input: { actor: string },
): ResumeDone | ResumeRefused {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  const root = chainRootForScope(trees, 'private');
  if (root === undefined) {
    return { ok: false, reason: 'NO_PROJECT' };
  }
  const cache = ProjectionCache.open(root, { upcasters: catalogUpcasters() });
  cache.rebuild();
  return { ok: true, resume: resume(cache, { actor: input.actor }) };
}
