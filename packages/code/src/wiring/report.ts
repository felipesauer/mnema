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
 * AND WHAT IS PAINTED RED IS A NO — every one of them, wherever it came from. The
 * severity is decided in the two functions below and nowhere else, so the whole surface
 * acquires it at once instead of two dozen verbs each deciding. The colour repeats the
 * word the line already says; it never replaces it, which is what makes `--color=never`
 * and a monochrome terminal lose nothing (see `presentation/styled.ts`).
 *
 * THE RULE USED TO BE NARROWER, AND HERE IS WHAT FALSIFIED IT. It read: red marks a
 * TYPED refusal — the domain's own no — and a usage error does not paint, because that
 * one is the parser's channel. Real use at a terminal is what fell over it: a person
 * who typed one argument too few met `error: missing required argument 'rationale'`,
 * unpainted and in a second voice, and a person who typed one word wrong met the same.
 * The distinction was true about where the no CAME FROM and false about what a reader
 * does with it — "the gate said no" and "you typed it wrong" are one piece of news,
 * which is that the thing did not happen. So the rule is now: A LINE IS RED WHEN THE
 * COMMAND DID NOT DO WHAT YOU ASKED. `wiring/misuse.ts` is where the parser's no is
 * worded, and `every-refusal-is-red.test.ts` is the guard over both halves.
 *
 * What that rule does NOT reach is an ANSWER that happens to be unwelcome. `verify`
 * naming a broken tree did what it was asked — it ruled — and `antipatterns` counting
 * three reopenings is not bad news, it is a count (see `presentation/verdict.ts`). Two
 * VERDICTS paint, and neither is a no: `guard`'s `REFUSED` paints the word it answers
 * with, and `verify` paints the clause that names how far the proof got. Each decides its
 * own severity in the verb that holds the vocabulary, which is what
 * `every-refusal-is-red.test.ts` names and bounds.
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
 * The other shape a no takes: a SENTENCE, with no code in front of it.
 *
 * A worded reason has nowhere to put a code — "No task <id> here." is the whole line —
 * and neither has a usage error, which is a no about the command line rather than about
 * the record. Both are the same news as the shape above and carry the same severity,
 * because what a reader acts on is that the thing did not happen, not which of the two
 * shapes the surface had a wording for.
 *
 * `detail` is the half after the colon where there is one: the parser's no puts what
 * the missing argument MEANS there, taken from the description the declaration already
 * carries (see `misuse.ts`). Omitted, the sentence is the whole line.
 *
 * It exists as a function rather than as a `statement(…, 'bad')` at each call site so
 * that the severity is written in one place: `every-refusal-is-red.test.ts` reads the
 * source for who decides it, and a verb that painted its own line would be the verb
 * whose no looks like nobody else's.
 */
export function refusalSentence(sentence: string, detail?: string): Line {
  return statement(sentence, detail, 'bad');
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
      : refusalSentence(wording);
  to.io.err(to.render(line));
  to.io.fail();
}

/**
 * Says a no the SURFACE itself decided — a value no declaration could refuse for it —
 * and records the non-zero exit.
 *
 * These are the checks a parser cannot make: `--scope elsewhere` names no tree,
 * `--limit 0` is not a count, a `move` was handed a `--scope` the model forbids. Each
 * is worded by the verb that knows what it asked for, and each goes out through here,
 * so a no the surface authored looks exactly like the gate's and exactly like the
 * parser's. They used to be written straight to the stream, which is how eighteen
 * lines of this surface ended up being the ones a reader could not tell from output.
 *
 * `detail` is the half after the colon, where the no has somewhere to send the reader:
 * the read-only session refuses a write by naming it AND saying to run it outside, and
 * a refusal that only says no is a refusal a caller has to guess their way out of. It
 * is the same second half {@link refusalSentence} already gives the parser's no, so
 * nothing new is being shaped here — the shape simply became reachable from this door.
 */
export function reportUsage(to: Reporter, sentence: string, detail?: string): void {
  to.io.err(to.render(refusalSentence(sentence, detail)));
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
