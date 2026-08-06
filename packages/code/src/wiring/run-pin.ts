/**
 * The session a command's writes are pinned to, and the one place it is proven.
 *
 * A run enters from OUTSIDE the process — a variable in the shell — so it is the
 * one piece of a write's envelope the surface cannot take on faith. It is checked
 * here, once, before any tree is opened.
 */

import { resolvePinnedRun } from '../pinned-run.js';
import { here } from './context.js';
import { type Reporter, refusalLine } from './report.js';

/**
 * The environment variable a shell carries an open session in, between the
 * `mnema run start` that opened it and the `mnema run end` that closes it.
 *
 * It is a variable and not a file because a session belongs to a SHELL: two
 * terminals may work in the same project inside different sessions, and a file
 * would make them fight over one. `run start` prints the export line for the
 * person to evaluate — a process cannot set a variable in the shell that spawned
 * it, and pretending otherwise would leave them wondering why nothing was pinned.
 */
export const RUN_ENV = 'MNEMA_RUN';

/** Returned by {@link pinnedRunResolver} when the pinned run cannot be proven. */
export const PIN_REFUSED = Symbol('pin-refused');

/**
 * Resolves — ONCE per command — the run this process's writes are pinned to.
 *
 * The value enters from outside (the {@link RUN_ENV} variable), which is exactly
 * why it is checked: a fact stamped with a run that does not exist is a broken
 * chain of authorization on an append-only log. It is checked HERE, at the
 * transport, rather than inside each write operation: per-operation validation
 * would replay the run projection on every append, including on the MCP path
 * where the run came from the server's own session and there is nothing to learn.
 *
 * The resolver is memoized so "once per command" is a property of the code and
 * not of how many verbs happen to ask. With the variable unset it returns before
 * any tree is resolved, so a person who never opened a session pays nothing — and
 * a refusal is reported once, here, in the same `Refused (CODE)` shape every
 * other refusal takes — down to the colour, which is why this takes the renderer
 * along with the port: the shape is a {@link refusalLine} and rendering it is what
 * makes it one.
 */
export function pinnedRunResolver(to: Reporter): PinnedRun {
  let settled = false;
  let pinned: string | undefined | typeof PIN_REFUSED;
  return () => {
    if (!settled) {
      settled = true;
      const resolved = resolvePinnedRun(here(), process.env[RUN_ENV]);
      if (resolved.ok) {
        pinned = resolved.run;
      } else {
        to.io.err(to.render(refusalLine(resolved.code, resolved.message)));
        pinned = PIN_REFUSED;
      }
    }
    return pinned;
  };
}

/**
 * What a verb asks for the run: the id to stamp, nothing (no session is open), or
 * {@link PIN_REFUSED} — already reported, and the verb only has to fail.
 */
export type PinnedRun = () => string | undefined | typeof PIN_REFUSED;
