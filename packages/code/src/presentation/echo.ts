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
 * WHAT IT IS NOT is the row being TYPED. That row is drawn in the input area, at the foot
 * of the page, and it is handed to the layout as bytes with no style at all — because the
 * caret is an offset in COLUMNS into it, and escapes a terminal does not print would be
 * arithmetic the console has to do to put the caret where the caller's fingers are
 * (`repl/console.ts`, `Shown.present` and `Shown.column`). The echo is what the roll
 * keeps once the line has been sent; the two say the same words in two places, and only
 * one of them has a caret in it.
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
