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
 * read-only. A caller reads their identity from `mnema init`, `mnema
 * accountability` or the bootstrap — never from `mnema verify`, which the flag's
 * help used to name and which prints no identity at all.
 *
 * The runs come from EVERY tree the project can see, and that is the correction a
 * run per destination forced. A run opens in the tree the fact it authorizes lands
 * in, and what a session records is routed by KIND — so one session's runs are
 * spread across the trees it wrote to, and asking one of them reported a fraction of
 * the actor's open work while looking like the whole answer. With no project here,
 * there is nothing to read, so it refuses `NO_PROJECT` rather than reporting a
 * hollow empty focus.
 *
 * Every tree also answers a second question, which is why they were all opened even
 * when one was read: which identities this record knows, which is what decides how
 * short the actor can be written and what a typed prefix may mean. That set has to
 * be the record's — an identity is not less real for having written only in the
 * team's tree.
 */

import { type Focus, focus } from '@mnema/copilot';
import { type Clock, type DiscoveryEnv, resolveTrees, systemClock } from '@mnema/core';
import { type AnchorForms, anchorForms, resolveTypedAnchor } from '../anchors.js';
import { caches, withScopedCaches } from '../tree-sources.js';

/** What the focus command needs — injected so it is testable. */
export interface FocusContext {
  /** The working directory to resolve the project from. */
  readonly cwd: string;
  /** The discovery environment (XDG/home). */
  readonly env: DiscoveryEnv;
  /**
   * The clock the ages are measured against; defaults to the wall clock. Injected
   * for the same reason the core injects one: an age is only assertable against a
   * pinned instant.
   */
  readonly clock?: Clock;
}

/** The actor's focus, over the tree that was read. */
export interface FocusDone {
  readonly ok: true;
  /** The derivation's result — the actor and their open runs. */
  readonly focus: Focus;
  /** How each identity this record knows is written for a person. */
  readonly anchors: AnchorForms;
}

/** There was no project here, or the actor named no identity in it. */
export type FocusRefused =
  | { readonly ok: false; readonly reason: 'NO_PROJECT' }
  | {
      readonly ok: false;
      readonly reason: 'REFUSED';
      readonly code: string;
      readonly message: string;
    };

/**
 * Derives the actor's focus over every tree of the current project. Opens a cache
 * per visible tree, rebuilds them from the chain, and returns the copilot's `focus`
 * for the given actor — the runs they have open, wherever this project keeps them.
 * Read-only: no writer, no event. With no project found from the cwd it refuses
 * `NO_PROJECT`.
 *
 * The actor may be written whole or as any prefix that names one identity the
 * record knows; a prefix that names several, or none, is refused rather than used
 * as a filter that matches nothing (see {@link resolveTypedAnchor}).
 */
export function runFocus(ctx: FocusContext, input: { actor: string }): FocusDone | FocusRefused {
  const trees = resolveTrees(ctx.cwd, ctx.env);
  // A context read needs a project: a session's runs belong to one, so with none
  // there is nothing to read. Asked of the committed tree — where a command-line run
  // is born — rather than of the private one, which no longer holds them alone.
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
      // No run is this command's own, and that is a fact rather than a shortcut: a
      // read opens no run, and this process is gone by the time the next one asks. So
      // every run reported comes back `thisSession: false` — which is why the human
      // output does not print it (a value that is the same in every answer is noise,
      // not honesty) and `--json` carries it anyway, being the faithful object.
      focus: focus(caches(sources), {
        actor: actor.anchor,
        asOf: (ctx.clock ?? systemClock)(),
        sessionRuns: [],
      }),
    };
  });
}
