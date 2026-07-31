/**
 * What a verb says after its adapter answers — the two things every one of them
 * has to say, worded once.
 *
 * A REFUSAL is the sharper of the two. Twenty-odd verbs each had the same three
 * branches written out by hand: the project that is not there, the entity that is
 * not there, and the gate's own typed refusal. Written twenty times, the third one
 * is where a verb drops the code or the message and the refusal stops being
 * actionable — and nothing would fail, because a refusal that reads badly still
 * exits non-zero. Here the shape is one function and a verb only supplies what is
 * particular to it.
 *
 * A REPLACEMENT is the other: it rides the SUCCESS path, because a scrub is not a
 * refusal — the fact was recorded, with a placeholder in it. The wording lives in
 * `recorded-content.ts`, shared with the MCP surface; this only puts it on the
 * stream.
 */

import { type Replacement, replacementNotice } from '../recorded-content.js';
import { type CliIo, writeLines } from './io.js';

/**
 * What a verb says when there is no project here.
 *
 * One wording, because a person who ran the wrong command in the wrong directory
 * reads this line and nothing else. Three verbs override it — `key restore`,
 * `key enroll` and `key revoke` name themselves instead of `mnema init`, since a
 * machine recovering an identity is not a machine founding a project.
 */
export const NO_PROJECT = 'No mnema project here. Run `mnema init` first.';

/** The one shape a typed refusal takes on this surface, wherever it comes from. */
export function refusalLine(code: string, message: string): string {
  return `Refused (${code}): ${message}`;
}

/**
 * Reports a refusal and records the non-zero exit.
 *
 * `said` gives the verb its own wording for the reasons only it knows about — the
 * unknown task, the unknown decision, the project a recovery names differently. A
 * reason nobody worded falls through to the gate's own code and message, which is
 * the honest default: the surface never invents a sentence for a refusal it does
 * not understand.
 */
export function reportRefusal(
  io: CliIo,
  refusal: { readonly reason: string; readonly code?: string; readonly message?: string },
  said: Readonly<Record<string, string>> = {},
): void {
  const wording =
    said[refusal.reason] ?? (refusal.reason === 'NO_PROJECT' ? NO_PROJECT : undefined);
  io.err(wording ?? refusalLine(refusal.code ?? refusal.reason, refusal.message ?? ''));
  io.fail();
}

/**
 * Says what the content door replaced, after the line that says the write landed.
 *
 * Called by every writing verb, on the SUCCESS path. Printing nothing when nothing
 * was replaced is what keeps the ordinary write quiet: the notice appears exactly
 * when there is something to act on (see {@link replacementNotice}).
 */
export function reportReplacement(result: Replacement, io: CliIo): void {
  writeLines(io, replacementNotice(result.replaced));
}
