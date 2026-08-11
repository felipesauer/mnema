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
 * layout redraws, and that region has a budget for two measured reasons — past a certain
 * height the library stops redrawing part of the screen and redraws all of it, with a
 * sequence that carries the one erase this product refuses to write; and a region taller
 * than what the page has left over pushes the caller's own page into the scrollback, which
 * nothing undoes. So the arithmetic is `area.ts`'s, this receives the answer as `room`, and
 * what it owes in exchange is HONESTY: whenever it draws a row at all, what it shows plus
 * what it says is left over adds up to everything there was. It never quietly shows fewer.
 *
 * AND WHAT IT SHOWS IS A WINDOW ONTO THE OFFERS RATHER THAN THE FIRST OF THEM
 * ({@link theWindow}), which is what a cut list needs to stay navigable: the arrows walk the
 * whole vocabulary, so a drawing that only ever showed the beginning of it left the mark on a
 * row nobody drew as soon as the pick went past the room.
 *
 * AND IT IS A LIST YOU CAN CHOOSE FROM, WHICH IS ONE MARK AND ONE ROW MORE. The list said
 * what could be typed and left the typing to the caller; what it lacked was the thing every
 * menu of every console has — the arrows moving through it and a key taking what they landed
 * on. The behaviour is {@link theNextPicked} and {@link thePicked}, two pure functions over
 * the offers and one word, and the keystrokes that read them are `editing.ts`'s: nothing here
 * knows a key was pressed.
 *
 * WHAT IS PICKED IS A WORD AND NOT A POSITION, and that is the whole reason a filter cannot
 * put the mark on the wrong row. The list narrows as the caller types, so an INDEX kept
 * between two frames names a different offer on the second one — the classic defect of this
 * shape, and it is absent by construction rather than by clamping: a pick is real exactly
 * while the word it names is still among the offers ({@link thePicked}), and it stops being
 * real the moment a keystroke narrows it away.
 *
 * THE MARK IS A COLUMN AND THE COLOUR IS NOT AN AXIS AT ALL. This product paints with the
 * eight colours a reader's own theme defines (`presentation/styled.ts`), so a hue is a weaker
 * signal here than in the console this was measured against, which picks its highlight out of
 * a palette of 256; and a mark works in monochrome, in a pipe, and for a reader who does not
 * separate two tones. So the picked row carries {@link PICK} in a column of its own and every
 * other row carries a blank one — which is what keeps the table lined up — and NOTHING in the
 * drawing changes weight or hue. The second axis is refused rather than forgotten: the rows
 * are dimmed by the layout (`region.ts`), one Text for all of them, so painting the picked row
 * differently would mean the layout knowing WHICH row is picked, and a selection that lives in
 * the layout is a second model of it beside this one.
 *
 * THE KEYS THAT MOVE IT ARE SAID UNDER IT, and that is the row this module gained. It arrives
 * composed, like a hint anywhere else on this surface (`session.ts`, `pickingTips`), and it is
 * one of this palette's rows rather than a row of the area: what is counted for the list is
 * counted for it ({@link paletteRowsFor}), so there is nothing for two files to agree about.
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
 * THE MARK ON THE ROW THE CALLER PICKED — HEAVY RIGHT-POINTING ANGLE QUOTATION MARK ORNAMENT,
 * U+276F.
 *
 * Spelled by its code point rather than typed, like every unusual byte in this repository: a
 * glyph a reader cannot tell from a greater-than sign is a glyph an edit destroys without
 * anybody seeing it happen.
 *
 * IT IS THE ONE THE WHOLE ECOSYSTEM CONVERGED ON rather than a glyph chosen here. The console
 * this surface was measured against marks its selected row with it; so does the layout
 * library's own selection component, which takes it from `figures.pointer` — and that is what
 * this delivery took from that component and all it took (see the report for why the rest of
 * it could not be used).
 */
export const PICK = '\u276f';

/** What a palette shows when the caller has picked no row: no word, and so no mark. */
export const NOBODY = '';

/**
 * What the row that accounts for the offers with no room says, after the count.
 *
 * Worded so it reads the same whether some rows were drawn above it or none were, because
 * both happen: a palette with room for exactly one row spends that row on this.
 */
const NOT_SHOWN = 'not shown';

/** The gap between the word and what it is. One column of the table, so `column` pads it. */
const AFTER_THE_WORD = 1;

/** How wide the column the mark sits in is: as wide as the mark, and read off the mark. */
const AS_WIDE_AS_THE_MARK = [...PICK].length;

/** The row that says which keys move the list. One row, whenever the list has any. */
const THE_KEYS = 1;

/**
 * WHICH OFFER IS PICKED, and nothing when the caller has picked none of them.
 *
 * THE ONE READING OF THE RULE, and every other answer about the pick is composed out of it:
 * the mark on a row below, the next pick when an arrow moves ({@link theNextPicked}), and
 * whether Return fills the row or hands it over (`editing.ts`). A pick that were read one way
 * by the drawing and another by the key would be a console whose mark and whose Return
 * disagreed about what the caller chose.
 *
 * A PICK IS REAL ONLY WHILE ITS WORD IS STILL OFFERED, which is what makes the filter safe:
 * typing narrows the list, and a word narrowed away stops being picked at the same instant it
 * stops being shown. Nothing is clamped, moved to a neighbour or remembered — the pick is not
 * a position in a list, it is a word that is either in one or not.
 */
export function thePicked(offers: readonly CompletionWord[], picked: string): string {
  return offers.some((offer) => offer.word === picked) ? picked : NOBODY;
}

/**
 * WHERE AN ARROW LEAVES THE PICK: one step from wherever it is, and the ends HOLD.
 *
 * They hold rather than wrap because a list is not a carousel: the ends of it are where the
 * vocabulary ends, and a caller holding a key down finds that out by ARRIVING at it rather
 * than by watching the list start over.
 *
 * ⚠️ THE REASON GIVEN WAS THE CUT, AND THE WINDOW FALSIFIED IT. It was written here that a
 * Down which jumped from the last visible row back to the first *would be jumping over rows
 * the caller cannot see* — true while what was drawn was the FIRST offers and nothing else,
 * and false now: the drawn rows are a window that follows the pick ({@link theWindow}), so a
 * wrapped pick would be drawn like any other. The decision did not move and its argument did:
 * what is left is about the list rather than about the drawing, which is the sturdier half.
 *
 * WITH NOTHING PICKED, DOWN TAKES THE FIRST AND UP TAKES THE LAST — the two ends, which is
 * what every menu does and the only answer that leaves neither arrow dead. It is also why
 * there is no mark on a palette that has just opened: a caller who has pressed no arrow has
 * chosen nothing, and Return still hands the row over (`editing.ts`), so a mark before the
 * first arrow would be the console promising a choice it is not about to make.
 */
export function theNextPicked(
  offers: readonly CompletionWord[],
  picked: string,
  step: number,
): string {
  if (offers.length === 0) return NOBODY;
  const words = offers.map((offer) => offer.word);
  const at = words.indexOf(thePicked(offers, picked));
  const next =
    at < 0 ? (step < 0 ? words.length - 1 : 0) : Math.max(0, Math.min(words.length - 1, at + step));
  return words[next] as string;
}

/**
 * HOW MANY ROWS A PALETTE OF THESE OFFERS WANTS: one each, and one for the keys under them.
 *
 * ONE FUNCTION, TWO READERS, and they are the two halves of the same row count: the area
 * budgets the region with it (`console.ts` → `area.ts`) and {@link paletteFor} spends what the
 * budget answers. A `+ 1` written at the first of those and not the second is a region one row
 * taller than what is drawn in it, which puts the caret and the foot of the page a row out.
 */
export function paletteRowsFor(offers: readonly CompletionWord[]): number {
  return offers.length === 0 ? 0 : offers.length + THE_KEYS;
}

/**
 * WHICH OFFERS ARE DRAWN: a WINDOW over them, as long as the room allows, and it HOLDS THE
 * PICK.
 *
 * ⚠️ IT WAS THE FIRST N OFFERS, and that is the defect this replaces rather than a shape that
 * was outgrown. A list cut to ten rows on a vocabulary of twenty said so honestly and left the
 * other ten UNREACHABLE: the arrows walk the whole vocabulary ({@link theNextPicked}), so the
 * eleventh of them put the pick on a word nothing drew — measured on the merged binary at a
 * hundred and twenty by sixteen, where the eleventh Down left the screen with no marked row at
 * all while Return went on taking a word the caller could not see.
 *
 * IT IS DERIVED AND NEVER REMEMBERED, like everything else about the pick. The window is a
 * function of the offers, the room and the one picked WORD — so it cannot go stale between two
 * frames, and a filter that narrows the list cannot leave it pointing at a row that has moved.
 * That is the same discipline that makes the mark itself safe ({@link thePicked}).
 *
 * WHERE IT SITS IS THE LEAST IT CAN BE, which is what makes it a window rather than a page: it
 * begins at the first offer until the pick would fall past its last row, and from then on it
 * ends ON the pick. So a list nobody has moved through shows what it always showed, and a
 * caller walking down it scrolls the list by exactly the rows they moved. The alternative —
 * pages that flip — would show three new words for one step and is what the console this was
 * measured against does; a window that FOLLOWS is what the arrows deserve, and it is one
 * clamp instead of two.
 *
 * THE ROW THAT SAYS WHAT HAD NO ROOM IS COUNTED HERE, because it is one of the rows the room
 * has to pay for: a window of everything but one is a list that shows one fewer than a list
 * that fits. What that row SAYS is the total less what is drawn, wherever the window is —
 * above it and below it in one number, which is a count a reader can check by adding up what
 * they can see ({@link paletteFor}).
 */
export function theWindow(
  offers: readonly CompletionWord[],
  room: number,
  picked: string,
): readonly CompletionWord[] {
  if (offers.length === 0 || room <= 0) return [];
  // WHAT IS LEFT FOR THE LIST once the row that says which keys move it has its own — and the
  // KEYS are what gives way on a palette with room for a single row, rather than the account of
  // what had no room. A row that said how to move a list nobody can see would be the one thing
  // this file may not draw: furniture where the honesty goes.
  const forTheList = Math.max(1, room - THE_KEYS);
  // The row that keeps the palette honest is counted against the same room, so a palette
  // that says what it left out shows one fewer than one that has everything.
  const many = offers.length <= forTheList ? offers.length : forTheList - 1;
  const at = offers.findIndex((offer) => offer.word === thePicked(offers, picked));
  const from = Math.max(0, at - many + 1);
  return offers.slice(from, from + many);
}

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
  /**
   * WHICH WORD THE CALLER PICKED with the arrows, and {@link NOBODY} when they have picked
   * none.
   *
   * A WORD AND NOT A ROW NUMBER, and it arrives from the value that holds what is being typed
   * (`editing.ts`) rather than being kept here: this function is asked again on every frame,
   * so anything it remembered between two of them would be a second place the pick lives.
   * Whether the word is still among {@link offers} is decided here and in one place
   * ({@link thePicked}).
   */
  readonly picked: string;
  /**
   * THE KEYS THAT MOVE THE LIST, as a line — drawn under it, and only when there is one.
   *
   * COMPOSED ELSEWHERE AND UNRENDERED, which is the shape every hint on this surface has
   * (`session.ts`): the words are the session's to choose and the bytes are the renderer's to
   * make, so it arrives as a line and goes through the same {@link render} the rows do. That is
   * also what makes it MEASURED like a row — a hint too wide for the window folds exactly as a
   * row of the table would, and the same rule refuses it.
   */
  readonly picking: Line;
}

/**
 * The palette as the layout receives it: one string per row, top first, and nothing left
 * to work out.
 *
 * Empty means there is no palette — because nothing is offered, because the area had no
 * room for a row, or because the terminal is too narrow for a row to be drawn without
 * being folded. All three are the SAME answer on purpose: an absent palette claims
 * nothing, so there is nothing it can be hiding. What may not happen is a palette that
 * draws rows and leaves some out without saying, and that is what the row before the last
 * one is for.
 *
 * HOW MANY ROWS COME BACK IS EXACTLY WHAT THE AREA BUDGETED, at every room and every list:
 * `min(paletteRowsFor(offers), room)`. It is the one property the caret and the foot of the
 * page rest on — a row drawn and not counted, or counted and not drawn, puts both a row out —
 * and it is why the keys give their row up at a room of one rather than the list losing its
 * account (`tests/a-palette-for-the-words.test.ts` asserts it over a grid).
 */
export function paletteFor(request: PaletteRequest): readonly string[] {
  return rowsOf(request).map(request.render);
}

/** The rows as lines, before anything turns them into bytes. */
function rowsOf(request: PaletteRequest): readonly Line[] {
  const { offers, room, columns, picked, picking } = request;
  if (offers.length === 0 || room <= 0) return [];

  // The left column is as wide as the widest word IN THIS PALETTE rather than in the
  // whole vocabulary, so a list narrowed to one word does not sit under a gap left by the
  // words it excluded.
  const width =
    offers.reduce((most, offer) => Math.max(most, offer.word.length), 0) + AFTER_THE_WORD;
  // THE MARK IS A COLUMN OF THE TABLE, so every row carries one and only one row carries the
  // glyph: an unpicked row is padded to the same width by the same function the words are
  // padded with, which is what keeps the second column lined up down the whole list. A mark
  // added to the picked row alone would move that row three columns right of its neighbours.
  const said = (mark: string, word: string, description: string): Line =>
    description.length === 0
      ? itemLine([column(mark, AS_WIDE_AS_THE_MARK), word])
      : itemLine([column(mark, AS_WIDE_AS_THE_MARK), column(word, width), description]);
  /** The mark for one row: the glyph on the picked word, and a blank column on every other. */
  const markFor = (word: string): string => (word === thePicked(offers, picked) ? PICK : NOBODY);

  // HOW MUCH ROOM A DESCRIPTION HAS, asked of the renderer rather than added up here: a
  // row whose description is one glyph long, less that glyph, is exactly what the indent,
  // the padding and the separator cost. So the answer survives a change to any of the
  // three, and no number about how a line is punctuated is written down in this file.
  const frame = widthOf(said(PICK, offers[0]?.word ?? '', CUT)) - [...CUT].length;
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

  // WHICH OFFERS ARE DRAWN: the window over them, which holds the pick and is as long as the
  // room allows ({@link theWindow}). Everything about how many rows that is lives there, so
  // this reads the answer and never a second arithmetic about it.
  const shown = theWindow(offers, room, picked);
  const enough = shown.length === offers.length;
  const rows = shown.map((offer) =>
    said(markFor(offer.word), offer.word, within(offer.description)),
  );
  const listed = enough
    ? rows
    : [
        ...rows,
        itemLine([
          column(NOBODY, AS_WIDE_AS_THE_MARK),
          `${CUT} ${offers.length - shown.length} ${NOT_SHOWN}`,
        ]),
      ];
  const whole = room > THE_KEYS ? [...listed, picking] : listed;
  return whole.some((row) => widthOf(row) > columns) ? [] : whole;
}
