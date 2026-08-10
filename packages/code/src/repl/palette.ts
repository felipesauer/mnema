/**
 * THE PALETTE — the words a caller could type next, each beside what it is.
 *
 * A session answers to two vocabularies that share one line of input: the words it
 * answers to ITSELF, which begin with a slash, and the VERBS of this product. Both were
 * already discoverable and neither was legible: the words needed `/help` typed first, and
 * a Tab that could not decide printed a row of bare tokens with nothing to say what any
 * of them was. This is the one list both of them are shown in.
 *
 * ONE MECHANISM, ONE LIST, AND TWO KEYS THAT ASK FOR IT. ⚠️ IT WAS ONE MECHANISM AND TWO
 * ANSWERS, and this paragraph said so: *a slash opens the session's own vocabulary and
 * narrows it as the caller types; a Tab that could not choose opens whatever the completer
 * offered*. Two answers is what a reader met: the slash listed three words and a Tab listed
 * fourteen, so the console had two menus and neither of them was the list of what you can
 * type. WHAT REPLACES IT is the completer's answer, whichever key asked — the verbs and the
 * session's own words together, in one list built in one place ({@link Completer},
 * `complete.ts`), with the words that begin with a slash inside it rather than beside it. The
 * slash is a KEY here and not a filter: on a line that is nothing but the prefix it asks the
 * same question an empty line asks, which is what makes the two answers one.
 *
 * THE SLASH ONLY COUNTS AS THE FIRST CHARACTER OF THE LINE. Inside a path, an argument or
 * a quoted string it is a character like any other, and a palette that opened there would
 * be answering a keystroke nobody meant as a question.
 *
 * IT IS COMPOSED HERE AND CUT HERE, and both halves are the point. The rows are built out
 * of the two functions every list of this product is built out of (`presentation/items.ts`
 * — `column` pads the left one, `itemLine` joins them), so a palette is the same table
 * `/help` prints and not a second idea of what a column is. And where a description is
 * too long for the terminal it is cut HERE, where the line is put together, never in the
 * layout: the rule that a component may not compose a line does not bend for a cut.
 *
 * THE CUT IS A DECLARED EXCEPTION, AND IT IS THE ONLY ONE. This surface's standing rule
 * is *roll, never cut in silence*, and it was written about a LINE OF THE RECORD — a value
 * a reader has to be able to check. A palette row is an affordance rather than a fact: it
 * says a word exists and roughly what it does, and a visible {@link CUT} at the end of it
 * is not silence, it is the row saying there is more. No line of the record is cut
 * anywhere, by this module or any other.
 *
 * HOW MANY ROWS THERE ARE IS NOT DECIDED HERE. The palette is part of the region the
 * layout redraws, and that region has a budget for a measured reason — past a certain
 * height the library stops redrawing part of the screen and redraws all of it, with a
 * sequence that carries the one erase this product refuses to write. So the arithmetic is
 * `area.ts`'s, this receives the answer as `room`, and what it owes in exchange is
 * HONESTY: whenever it draws a row at all, what it shows plus what it says is left over
 * adds up to everything there was. It never quietly shows fewer.
 */

import type { CompletionWord } from '../completion/tree.js';
import { column, itemLine } from '../presentation/items.js';
import type { Line } from '../presentation/line.js';
import { widthOf } from '../presentation/plain.js';
import type { Render } from '../presentation/render.js';
import { PREFIX } from '../session-words.js';
import type { Completer } from './complete.js';

/**
 * The mark that says there is more — at the end of a description too long for the row,
 * and at the start of the row that says how many offers had no room.
 *
 * Spelled by its code point rather than typed, like every unusual byte in this
 * repository: a glyph a reader cannot tell from three full stops is a glyph an edit
 * destroys without anybody seeing it happen.
 */
export const CUT = '…';

/**
 * What the row that accounts for the offers with no room says, after the count.
 *
 * Worded so it reads the same whether some rows were drawn above it or none were, because
 * both happen: a palette with room for exactly one row spends that row on this.
 */
const NOT_SHOWN = 'not shown';

/** The gap between the word and what it is. One column of the table, so `column` pads it. */
const AFTER_THE_WORD = 1;

/**
 * WHAT THE PALETTE IS SHOWING, given the line, what a Tab last offered, and the one thing
 * that knows what can be typed.
 *
 * Total over the three cases and it decides nothing else: the slash asks when the line begins
 * with one, the Tab's offers stand when it does not, and an empty answer is a palette that is
 * not open.
 *
 * ⚠️ IT FILTERED A VOCABULARY OF ITS OWN, and that is what made the two keys answer with two
 * different lists. It was handed the session's words and narrowed them against the whole line
 * — right about the narrowing, and a second reading of *what can be typed at the start of a
 * line* even so, because the completer was already answering that question with the verbs in
 * it. So the answer is ASKED rather than composed, and there is one list.
 *
 * THE BARE PREFIX ASKS WHAT AN EMPTY LINE ASKS, and that is the whole of the difference
 * between a key and a word. A slash with nothing behind it is the caller asking to be shown
 * what there is; a slash with a letter behind it is a word of the session being typed, and the
 * completer narrows to the words that really start that way. Nothing is filtered twice.
 */
export function offeredBy(
  typed: string,
  offered: readonly CompletionWord[],
  asked: Completer,
): readonly CompletionWord[] {
  if (!typed.startsWith(PREFIX)) return offered;
  const [hits] = asked(typed === PREFIX ? '' : typed);
  return hits;
}

/** What a palette needs to be drawn: what to show, how much room, and how to say it. */
export interface PaletteRequest {
  /** What the caller could type next, in the order they should read. */
  readonly offers: readonly CompletionWord[];
  /** How many ROWS the area has room for, answered by `area.ts`. */
  readonly room: number;
  /** How wide the terminal is, asked of the DEVICE by whoever owns the streams. */
  readonly columns: number;
  /** How a line becomes bytes, resolved once for the whole session. */
  readonly render: Render;
}

/**
 * The palette as the layout receives it: one string per row, top first, and nothing left
 * to work out.
 *
 * Empty means there is no palette — because nothing is offered, because the area had no
 * room for a row, or because the terminal is too narrow for a row to be drawn without
 * being folded. All three are the SAME answer on purpose: an absent palette claims
 * nothing, so there is nothing it can be hiding. What may not happen is a palette that
 * draws rows and leaves some out without saying, and that is what the last row is for.
 */
export function paletteFor(request: PaletteRequest): readonly string[] {
  return rowsOf(request).map(request.render);
}

/** The rows as lines, before anything turns them into bytes. */
function rowsOf(request: PaletteRequest): readonly Line[] {
  const { offers, room, columns } = request;
  if (offers.length === 0 || room <= 0) return [];

  // The left column is as wide as the widest word IN THIS PALETTE rather than in the
  // whole vocabulary, so a list narrowed to one word does not sit under a gap left by the
  // words it excluded.
  const width =
    offers.reduce((most, offer) => Math.max(most, offer.word.length), 0) + AFTER_THE_WORD;
  const said = (word: string, description: string): Line =>
    description.length === 0 ? itemLine([word]) : itemLine([column(word, width), description]);

  // HOW MUCH ROOM A DESCRIPTION HAS, asked of the renderer rather than added up here: a
  // row whose description is one glyph long, less that glyph, is exactly what the indent,
  // the padding and the separator cost. So the answer survives a change to any of the
  // three, and no number about how a line is punctuated is written down in this file.
  const frame = widthOf(said(offers[0]?.word ?? '', CUT)) - [...CUT].length;
  const forTheDescription = columns - frame;
  // A terminal with no room for a description is a terminal the table does not fit on,
  // and a table drawn without its second column would be dropping what it says with no
  // mark to show for it. Absent instead — the same posture the hint and the badge take.
  if (forTheDescription < 1 && offers.some((offer) => offer.description.length > 0)) return [];

  /** A description with no more of it than the row has columns for, and a mark saying so. */
  const within = (description: string): string => {
    const glyphs = [...description];
    if (glyphs.length <= forTheDescription) return description;
    return `${glyphs.slice(0, forTheDescription - 1).join('')}${CUT}`;
  };

  const enough = offers.length <= room;
  // The row that keeps the palette honest is counted against the same room, so a palette
  // that says what it left out shows one fewer than one that has everything.
  const shown = enough ? offers : offers.slice(0, room - 1);
  const rows = shown.map((offer) => said(offer.word, within(offer.description)));
  const whole = enough
    ? rows
    : [...rows, itemLine([`${CUT} ${offers.length - shown.length} ${NOT_SHOWN}`])];
  return whole.some((row) => widthOf(row) > columns) ? [] : whole;
}
