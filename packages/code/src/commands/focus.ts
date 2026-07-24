/**
 * `mnema focus --actor <id>` — what an actor is touching now: their open runs.
 *
 * The first of the three CONTEXT reads on the surface, and a different shape from
 * every command before it. A read opens the projection cache over the project
 * tree, rebuilds it, and hands it to the copilot's PURE derivation — that is all.
 * It opens NO writer, emits no event, mints no key: it is read-only in the strict
 * sense the boundary and `verify` mean it. The derivation is the logic; the
 * adapter only resolves the tree and forwards the actor.
 *
 * WHY THE ACTOR IS EXPLICIT. `focus` is always SOMEONE's focus, and the record
 * carries no notion of a "current actor" — a `who` is only ever stamped on past
 * events. The MCP surface has a session and reads its `who`; the CLI has none,
 * and the only way to derive the machine's `who` without a writer is to touch key
 * material — which mints a key on a fresh machine and is domain logic the surface
 * must not own. So the actor is a required flag (`--actor`): the derivation
 * already takes it as a parameter, and passing it in keeps the read truly
 * read-only. A caller reads their anchor from `mnema verify` or the bootstrap.
 *
 * The tree read is the PRIVATE project tree — where a machine's runs are born (a
 * session defaults its writes private). With no project here, there is nothing to
 * read, so it refuses `NO_PROJECT` rather than reporting a hollow empty focus.
 */

import { catalogUpcasters } from '@mnema/chain';
import { type Focus, focus } from '@mnema/copilot';
import { chainRootForScope, type DiscoveryEnv, ProjectionCache, resolveTrees } from '@mnema/core';

/** What the focus command needs — injected so it is testable. */
export interface FocusContext {
  /** The working directory to resolve the project from. */
  readonly cwd: string;
  /** The discovery environment (XDG/home). */
  readonly env: DiscoveryEnv;
}

/** The actor's focus, over the tree that was read. */
export interface FocusDone {
  readonly ok: true;
  /** The derivation's result — the actor and their open runs. */
  readonly focus: Focus;
}

/** There was no project here — a context read needs one. */
export type FocusRefused = { readonly ok: false; readonly reason: 'NO_PROJECT' };

/**
 * Derives the actor's focus over the current project's private tree. Opens the
 * cache, rebuilds it from the chain, and returns the copilot's `focus` for the
 * given actor — the runs they have open. Read-only: no writer, no event. With no
 * project found from the cwd it refuses `NO_PROJECT`.
 */
export function runFocus(ctx: FocusContext, input: { actor: string }): FocusDone | FocusRefused {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  // Read the PRIVATE project tree: a session's runs are born private, so that is
  // where an actor's open runs live. No project → nothing to read.
  const root = chainRootForScope(trees, 'private');
  if (root === undefined) {
    return { ok: false, reason: 'NO_PROJECT' };
  }
  const cache = ProjectionCache.open(root, { upcasters: catalogUpcasters() });
  cache.rebuild();
  return { ok: true, focus: focus(cache, { actor: input.actor }) };
}
