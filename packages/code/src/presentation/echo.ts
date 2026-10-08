/**
 * THE ECHO — what a caller sent, shown back to them: the prompt they typed in front of,
 * and their own words.
 *
 * IT IS THE ONE LINE OF THIS PRODUCT THAT IS NOT ABOUT THE RECORD, and that is why it
 * took a delivery of its own to get here. Every other line `presentation/` builds is a
 * reading — a hit, a verdict, a fact — so the console could say, truthfully, that it
 * composed nothing a reader sees. It composed this one: `land(prompt + line)`, three
 * times, in the module that owns the streams (`repl/console.ts`). A concatenated string
 * has no parts, so it has no roles, so a renderer has nothing to weigh or paint — and
 * what that cost is exactly what a caller reported: scrolling a session, the line they
 * ASKED reads at the same weight as the answer to it, and there is nothing to find.
 *
 * SO IT IS A LINE WITH PARTS, like everything else, and the three consequences are the
 * whole argument for the shape:
 *
 *   - IT CAN BE PAINTED. The prompt takes the accent — the hue this product is marked by,
 *     the one its rules are drawn in — and what the caller typed takes a weight of its
 *     own. That is `styled.ts`'s table, not this file's: nothing here knows a colour.
 *   - A CALLER WHO ASKED FOR NO COLOUR GETS NONE, for free and by construction. Which
 *     renderer answers is resolved once, at the entry, out of the flag and the two
 *     conventional variables (`wiring/color.ts`), and every line of the product goes
 *     through whichever one it chose. A string the console built itself could not have
 *     obeyed that without the console asking a question no module on that side of the
 *     surface is allowed to ask.
 *   - IT FOLDS. A line too wide for the window is broken between words with its
 *     continuation indented (`folded.ts`), which is what happens to every other line that
 *     lands. Concatenated, a long paste was broken at the margin by the terminal, in the
 *     middle of whatever word was there.
 *
 * AND THE PLAIN RENDERING IS THE PROMPT AND THE LINE, BYTE FOR BYTE. That is the property
 * that makes this safe to introduce under a surface pinned by recorded transcripts: the
 * two parts take no separator at all (`plain.ts`, `PRECEDED_BY`), because the prompt
 * carries the space it has always ended in inside its own text. What a session lands is
 * what a session landed, and `echo.test.ts` asserts it over the values a row being typed
 * can hold — nothing, a word, a paste with a break in it, a run of spaces.
 *
 * AND THE ROW BEING TYPED IS THIS LINE TOO, which is the paragraph this file had to take
 * back. IT READ: *what it is not is the row being TYPED. That row is drawn in the input area,
 * at the foot of the page, and it is handed to the layout as bytes with no style at all —
 * because the caret is an offset in COLUMNS into it, and escapes a terminal does not print
 * would be arithmetic the console has to do to put the caret where the caller's fingers are.*
 * WHAT FALSIFIED IT is the arithmetic itself: the console counts that column over the prompt
 * and over what was typed, which are the two values it was handed, and never over the row it
 * composes (`repl/console.ts`, `Shown.column`). There was no escape in the sum to begin with.
 *
 * What the reason was really protecting is the FOLD, and that survives whole: the row being
 * typed is the one line of that page rendered for no width, because a break of ours inside the
 * row a caller is writing is a break the terminal was going to make at the margin anyway
 * (`repl/console.ts`, `renderTyped`). So the same two parts are composed here for both — the
 * roll keeps one once the line has been sent, and the other is under the caller's fingers —
 * and the prompt carries the same accent in both places, which is what a caller asked for after
 * seeing it in one of them.
 */

import type { Line } from './line.js';

/**
 * One echo, as a line: the prompt, then what was typed.
 *
 * AT THE EDGE AND NOT UNDER ANYTHING. It is not an item of a list and not a fact under a
 * heading — it is the caller's own line, and the answer to it lands under it at whatever
 * depth the answer has.
 *
 * A line with NOTHING typed is the prompt alone, and it is a real case rather than a
 * degenerate one: a caller who presses Return on an empty row has sent an empty line, and
 * a terminal shows what you sent. The empty part is kept rather than dropped, so the two
 * parts of an echo are always the two parts of an echo — a shape that lost a part when
 * the text was empty would be a shape a reader of the parts has to branch on.
 */
export function echoLine(prompt: string, typed: string): Line {
  return {
    indent: 0,
    parts: [
      { role: 'prompt', text: prompt },
      { role: 'typed', text: typed },
    ],
  };
}

/**
 * The mark a command carries on the roll once it has been sent, with the space it ends in
 * inside its own text for the reason a prompt does. One glyph, measured by the one authority
 * over columns (`width.ts`): a single column at every width the console is drawn at.
 */
export const SENT_MARK = '❯ ';

/**
 * A command that has been SENT, as the roll keeps it: the mark, then the words.
 *
 * IT IS NOT {@link echoLine}, AND THE TWO ARE ON THE PAGE AT ONCE. The echo is the row being
 * TYPED — the product's prompt, in the product's hue, under the caller's fingers. Once the row
 * is sent it is something the session shows back, and in a terminal that paints it is a band
 * across the page: what a reader scrolling a long session looks for is where each of their
 * questions began, and a band is what the eye finds. The purple stays on the row being typed,
 * on the rules and on the top — the places that say *this is mnema* — and a sent command
 * carries none of it (`styled.ts`).
 *
 * The words are the caller's own, so they are neutralized like every other part's; a line with
 * NOTHING typed is the mark alone, because a terminal shows what you sent.
 */
export function sentLine(typed: string): Line {
  return {
    indent: 0,
    parts: [
      { role: 'sentmark', text: SENT_MARK },
      { role: 'sent', text: typed },
    ],
  };
}

/**
 * The glyph that opens an answer on the roll, with the space after it. It is NEUTRAL: no hue and
 * no weight, because the purple on this page belongs to the places that say *this is mnema* and
 * an answer is not one of them. One column, measured by the authority over columns (`width.ts`).
 */
export const ANSWER_MARK = '● ';

/** The glyph that opens the line saying an answer is done, with the space after it. */
export const DONE_MARK = '✻ ';

/**
 * THE LINE UNDER AN ANSWER: the mark, the verb that was typed, how long it took and the hour it
 * finished — `✻ status · 12ms · done 16:32`. Only what was measured: the console calls no model,
 * so there is no word on it about thinking, and the verb is the first word the caller typed,
 * which is a fact about the line and not a reading of it.
 *
 * IT IS HANDED THE TWO MEASUREMENTS AS WORDS, because what a clock says is not this layer's to
 * ask (`repl/turn.ts` reads one and words it): a line built here is the same line whenever it is
 * built. It is ONE part with the weight of everything the page says that a reader may skip, and
 * it stands at the edge, under the glyph that opened the answer.
 */
export function doneLine(verb: string, took: string, hour: string): Line {
  const words = [verb, took, `done ${hour}`];
  return { indent: 0, parts: [{ role: 'detail', text: `${DONE_MARK}${words.join(' · ')}` }] };
}
