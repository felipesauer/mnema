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
 * refusal — the fact was recorded, with a placeholder in it. So does WHERE THE WRITE
 * LANDED, for the same reason and in the same place: nothing in the call said which
 * tree a fact routes to, so the reply is the only moment the author can learn it.
 * Both wordings live in `recorded-content.ts`, shared with the MCP surface; this only
 * puts them on the stream, in one order.
 *
 * AND THE REFUSAL IS THE ONE THING ON THIS SURFACE PAINTED RED. It is the cheapest
 * severity in the product to be sure of — a refusal is bad news, always, wherever it
 * came from — and it is said in ONE function that every verb already routes through,
 * so the whole surface acquires it at once instead of two dozen verbs each deciding.
 * The colour repeats the word `Refused`; it never replaces it, which is what makes
 * `--color=never` and a monochrome terminal lose nothing (see `presentation/styled.ts`).
 */

import type { Line } from '../presentation/line.js';
import type { Render } from '../presentation/render.js';
import { statement } from '../presentation/verdict.js';
import {
  type Landed,
  landedNotice,
  type Replacement,
  replacementNotice,
} from '../recorded-content.js';
import { type CliIo, writeLines } from './io.js';

/**
 * The two things saying a refusal needs: where it goes, and how a line becomes bytes.
 *
 * Every verb's `Wiring` already holds both, so a caller passes what it was handed. It
 * is stated here rather than imported from `verb.ts` because the two things that write
 * a refusal WITHOUT being a verb — the run pin and the entry's last-resort catch — hold
 * neither a program nor a session, and a wider parameter would have them making one up.
 */
export interface Reporter {
  /** Where the refusal goes, and how the non-zero exit is recorded. */
  readonly io: CliIo;
  /** How the line becomes the bytes `io` receives — plain or painted. */
  readonly render: Render;
}

/**
 * What a verb says when there is no project here.
 *
 * One wording, because a person who ran the wrong command in the wrong directory
 * reads this line and nothing else. Three verbs override it — `key restore`,
 * `key enroll` and `key revoke` name themselves instead of `mnema init`, since a
 * machine recovering an identity is not a machine founding a project.
 */
export const NO_PROJECT = 'No mnema project here. Run `mnema init` first.';

/**
 * The one shape a typed refusal takes on this surface, wherever it comes from.
 *
 * It returns a LINE and not bytes, which is what puts the three places that write one
 * on the same footing: the funnel below, the run pin, and the entry's catch for a
 * machine with no single identity. Each of them renders it, so each of them paints it,
 * and a fourth that forgot would not compile — the type is the guard.
 *
 * The code leads INSIDE the label, as it always has: it is part of what the verdict IS,
 * so it is what a reader scanning a log sees first, and the message after the colon is
 * the evidence for it.
 */
export function refusalLine(code: string, message: string): Line {
  return statement(`Refused (${code})`, message, 'bad');
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
  to: Reporter,
  refusal: { readonly reason: string; readonly code?: string; readonly message?: string },
  said: Readonly<Record<string, string>> = {},
): void {
  const wording =
    said[refusal.reason] ?? (refusal.reason === 'NO_PROJECT' ? NO_PROJECT : undefined);
  // A worded reason is ONE sentence and takes no detail — "No task <id> here." has no
  // half after a colon to put the evidence in. It is still the same news, so it carries
  // the same severity: what a reader acts on is the redness of the line, not which of
  // the two shapes the surface happened to have a wording for.
  const line =
    wording === undefined
      ? refusalLine(refusal.code ?? refusal.reason, refusal.message ?? '')
      : statement(wording, undefined, 'bad');
  to.io.err(to.render(line));
  to.io.fail();
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

/**
 * What a BIRTH says under its headline: the tree it landed in, then anything the
 * content door replaced.
 *
 * One function and one call per verb, so the two lines cannot be ordered differently
 * by two verbs and neither can be forgotten by one of them. The tree comes first
 * because it is a fact about this write; the replacement comes last because it ends
 * with the only instruction either line gives, and an instruction reads worst in the
 * middle.
 *
 * The writes that are NOT routed by kind — a run, an init, a key — use
 * {@link reportReplacement} alone: they belong to one tree by construction, so there
 * is no choice for the reply to report.
 */
export function reportRecorded(result: Landed & Replacement, io: CliIo): void {
  writeLines(io, [landedNotice(result.scope), ...replacementNotice(result.replaced)]);
}
