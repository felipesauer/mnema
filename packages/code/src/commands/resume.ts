/**
 * `mnema resume --actor <id>` — where an actor left off: their latest run, and the runs they
 * still have open.
 *
 * A read opens the projection cache over every tree of the project, rebuilds it, and hands it
 * to the context package's PURE `resume` derivation — that is all. It opens NO writer, emits no
 * event, mints no key: it is read-only in the strict sense the boundary and `verify` mean it.
 * The derivation is the logic; the adapter only resolves the tree and forwards the actor.
 *
 * `resume` answers "where was I" even for a run that ALREADY ENDED — the latest run by start
 * time, open or not, carries the goal that reminds the actor what it was — and the derivation
 * CONTAINS the actor's open runs, which is why a verb of their own (`focus`) went into this one.
 *
 * WHY THE ACTOR IS EXPLICIT. This is always SOMEONE's reading, and the record carries no notion
 * of a "current actor" — a `who` is only ever stamped on past events. The MCP surface has a
 * session and reads its `who`; the CLI has none, and the only way to derive the machine's `who`
 * without a writer is to touch key material — which mints a key on a fresh machine and is
 * domain logic the surface must not own. So the actor is a required flag (`--actor`): the
 * derivation already takes it as a parameter, and passing it in keeps the read truly read-only.
 * A caller reads their identity from `mnema init`, `mnema audit accountability` or the
 * bootstrap — never from `mnema verify`, which prints no identity at all.
 *
 * IT SAID *THE CLI* HAS NO SESSION `who`, and the console is one: `mnema repl` resolves the
 * identity from local material with no writer opened (`repl/standing.ts`), and fills this flag
 * in for a caller who would otherwise type back what its own panel shows (`repl/asking.ts`).
 * What is unchanged is this declaration and every word of the reason for it: an INVOCATION has
 * no session, `mnema resume` at a shell asks for the actor exactly as it always has, and nothing
 * anywhere derives a `who` by touching key material.
 *
 * The runs come from EVERY tree the project can see, and that is the correction a run per
 * destination forced. A run opens in the tree the fact it authorizes lands in, and what a
 * session records is routed by KIND — so one session's runs are spread across the trees it wrote
 * to, and asking one of them reported a fraction of the actor's work while looking like the
 * whole answer. With no project here, there is nothing to read, so it refuses `NO_PROJECT`
 * rather than reporting a hollow empty answer. Every tree also answers a second question, which
 * identities this record knows — what decides how short the actor can be written and what a
 * typed prefix may mean. That set has to be the record's: an identity is not less real for
 * having written only in the team's tree.
 */

import { type Resume, resume } from '@mnema/context';
import { type Clock, type DiscoveryEnv, resolveTrees, systemClock } from '@mnema/core';
import { type AnchorForms, anchorForms, resolveTypedAnchor } from '../anchors.js';
import {
  caches,
  linkBreaksOf,
  type ScopedLinkBreak,
  THE_READING_THAT_OPENED_THESE,
  withScopedCaches,
} from '../tree-sources.js';

/** What the resume command needs — injected so it is testable. */
export interface ResumeContext {
  /** The working directory to resolve the project from. */
  readonly cwd: string;
  /** The discovery environment (`$HOME`, `$MNEMA_HOME`). */
  readonly env: DiscoveryEnv;
  /** The clock the ages are measured against; defaults to the wall clock. */
  readonly clock?: Clock;
}

/** Where the actor left off, over the tree that was read. */
export interface ResumeDone {
  readonly ok: true;
  /** The derivation's result — the actor's latest run and the runs they have open. */
  readonly resume: Resume;
  /** How each identity this record knows is written for a person. */
  readonly anchors: AnchorForms;
  /**
   * The tails among those read that do not chain — empty for a sound record, which is
   * every record this product wrote on its own. See {@link linkBreaksOf}: what is served
   * beside it came off a record whose proof this is the state of, and the wiring is what
   * says so.
   */
  readonly linkBreaks: readonly ScopedLinkBreak[];
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
 * Opens a cache per visible tree, rebuilds them, and returns the context package's
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
  // The committed tree, because it is where a command-line run is born, and both project trees are present or absent together anyway.
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
      linkBreaks: linkBreaksOf(sources, THE_READING_THAT_OPENED_THESE),
      // Empty: a read opens no run, so nothing here is this command's
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
