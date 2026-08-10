/**
 * THE NAME, DRAWN — the one thing this surface prints that says nothing about the
 * record.
 *
 * It is ART, and that is the whole of what it is: nine rows of blocks and shades, five rows
 * of one block, or the name letterspaced, or the name. It carries no fact, so there is
 * nothing in it a reader could be misled about, and that is what makes the rule below safe
 * to state.
 *
 * IT DEGRADES BY WIDTH, AND CUTTING ART IS NOT LYING. Everything else this product prints
 * is as wide as it is and gets FOLDED to the screen rather than cut — a line of data cut
 * to fit would be a value a reader cannot check, and the surface refuses to do that (see
 * `items.ts`: a column pads and never truncates). The name is the exception because a
 * smaller drawing of the same word is still the same word.
 *
 * ⚠️ IT SAID THE TERMINAL DID THE FOLDING, and that is what `presentation/folded.ts`
 * falsified — the product folds now, between words and with the continuation indented,
 * and the terminal only gets rows that fit. Nothing about the rule below moved: what makes
 * the name an exception is that it may be CUT, and cutting is still the one thing no line
 * of data may be. So there are four drawings, and the widest one
 * that FITS is the one that is drawn — the threshold is each form's own width rather than
 * a number somebody chose, which is what keeps the rule from drifting away from the art
 * the day a letter changes.
 *
 * AND IT DEGRADES BY HEIGHT, WHICH IS NOT THE SAME RULE ON THE OTHER MEASUREMENT. ⚠️ IT WAS
 * WRITTEN AS THOUGH IT WERE, and the paragraph here said the threshold was "the form's own
 * HEIGHT for the same reason it is the form's own width on the other". WHAT FALSIFIED IT IS
 * A MEASUREMENT: the tallest form was five rows, `5 <= rows` is true on every terminal
 * anybody has, and the axis chose nothing at any size a person opens. A mechanism plumbed
 * to the end whose threshold never fires is the same defect as an option with no caller.
 *
 * THE TWO AXES HAVE DIFFERENT ROLES, and that is why the rule could not be copied across.
 * Across the screen the drawing IS what disputes the room: it is the widest thing in its
 * column, so "the drawing fits" and "the page fits" are one question. Down the screen it is
 * a PARCEL — the box's borders, the place the session is standing, what the record is, the
 * sentence under it and the input area all take rows too — and a form that asked "do I
 * fit?" ignored every other addend and answered yes. So the question asked on this axis is
 * whether the PAGE fits with this drawing in it, and this module may not answer that one:
 * it is asked of whoever composes the page ({@link BannerRequest.needs}). Pinned in both
 * directions in `tests/the-opening-fits-the-screen.test.ts`, where the size a form gives
 * way at is searched for rather than written down.
 *
 * IT IS THE THIRD PLACE THIS SURFACE CHOOSES A FORM BY A MEASUREMENT, and the only one
 * that chooses by both: the panel picks by width (`repl/panel.ts`) and the input area by
 * height (`repl/area.ts`), each with the same shape of answer — the richest arrangement
 * that fits, a floor that is answered whatever the size, and a threshold taken off what is
 * drawn rather than off a number.
 *
 * AND THE NARROWEST STILL SAYS THE NAME. There is no form that draws nothing: a terminal
 * too narrow even for five characters gets the five characters anyway, because the one
 * thing this banner exists to say is the only thing that may not be dropped. The floor is
 * a single row, so it is answered at every height as well — a terminal too short for one
 * row is a terminal with nowhere to put a prompt.
 *
 * IT IS COMPOSED HERE AND POSITIONED ELSEWHERE. The console mounts a layout library, and
 * the limit that decision rests on is that no component of it composes a line — five
 * deliveries built ONE model of what a line of this product says, and a second one would
 * diverge from it in silence (`repl/region.ts`, and the scan in
 * `tests/the-console-on-ink.test.ts`). Art assembled inside a component would be the first
 * exception to that rule, and the first exception is how a rule like it dies. So the
 * drawing is a constant of `presentation/`, it comes back as LINES like everything else
 * here, and the console does with it what it does with every other line: puts it
 * somewhere.
 *
 * THE ROWS TAKE THE ROLE A HEADING TAKES, and no role or hue was invented for them. A
 * banner is the heading of the session — the styled renderer emboldens it exactly as it
 * emboldens `show`'s subject line, and the plain renderer writes the drawing and nothing
 * else.
 *
 * IT DOES CARRY A HUE NOW, AND NOT ONE OF THIS FILE'S. The sentence here used to end
 * "colour on this surface means severity and nothing else, and a banner is the most
 * tempting place there is to spend a hue on decoration" — the temptation was named
 * correctly and the rule it appealed to has since gained an axis. Colour means severity
 * wherever it says something about the RECORD, which is every line `presentation/`
 * produces; the console's opening panel paints its border, its title and this drawing in
 * one accent, and that accent is CHROME — it is the layout's, it is spent in one place,
 * and it is a hue no severity uses (`repl/region.ts`, and the guard in
 * `tests/the-panel.test.ts`). Nothing in this module knows about it: the drawing is the
 * same parts either way, and a caller that puts it anywhere else gets a heading.
 */

import { subjectLine } from './detail.js';
import type { Line } from './line.js';
import { widthOf as widthOfLine } from './plain.js';

/**
 * THE BLOCK THE FIVE-ROW MASK IS INKED WITH, named by its code point rather than typed, and
 * the reason is the one this bench has paid for twenty-four times: a character a reader
 * cannot see in a source file survives every edit made around it. FULL BLOCK, and the mask
 * it fills is ASCII to the byte.
 *
 * ⚠️ THERE WERE FOUR OF THEM, and the other three were the two diagonals and the vertical
 * that the isometric drawing's slashes and pipes became. That drawing is not in this file
 * any more, so the substitutions it needed went with it — and one of the three was the very
 * glyph the box's frame is drawn with, which is what made four cases of this surface have to
 * tell a row of the art from a row of the box.
 */
const INK = '\u2588';

/**
 * WHAT AN ASCII MARK IS INKED AS — the one table, read by every mask.
 *
 * A mask is written in characters an editor renders at one width and a diff can show, and
 * this is the only place a mark becomes a glyph. Marks a form does not use are simply absent
 * from it, and everything that is not a key of this table is drawn as it was written — which
 * is what lets one table serve every mask without a form having to say which substitutions
 * are its.
 *
 * ⚠️ IT HELD FOUR SUBSTITUTIONS AND IT HOLDS ONE, because the drawing that needed the other
 * three is no longer written as a mask at all ({@link THE_BLOCKS}). One entry rather than
 * none: the five-row form is still a mask, and a table with one key is what keeps the inking
 * in one place for whichever mask is written next.
 */
const INKED: { readonly [mark: string]: string } = {
  '#': INK,
};

/**
 * THE BIGGEST DRAWING, AS THE DRAWING — nine rows of blocks and shades, fifty columns, and
 * the one form in this file that is not written as a mask.
 *
 * ⚠️ IT WOULD HAVE BEEN A MASK, AND THIS DRAWING IS WHAT FALSIFIED THE PREMISE THAT SAID SO.
 * Every form here has been written as *characters an editor renders at one width and a diff
 * can show*, and the argument under that rule is that a reader sees the FORM. This one is
 * inked with EIGHT different blocks and shades: as a mask its first row reads
 * ` ###_ _###% ###_    # %#####` — measured, by writing it out — and at eight marks the FORM
 * is the one thing that stops being visible. So the premise did not survive a drawing of
 * eight glyphs, and it is written down here rather than deleted.
 *
 * WHAT THE DOCTRINE IS REALLY AGAINST IS A CHARACTER A READER CANNOT SEE — an escape, a NUL,
 * a zero-width space, the twenty-four bytes this bench has paid for — and a block is the
 * opposite of invisible. What replaces the mask is stronger than the mask was: an
 * ENUMERATION of the code points this module may hold, each one named, with any other
 * non-ASCII byte in the file ACCUSED (`tests/the-opening-fits-the-screen.test.ts`, which
 * also keeps a second copy of these rows so that an edit to the art is loud).
 *
 *   - FULL BLOCK U+2588, DARK SHADE U+2593, MEDIUM SHADE U+2592, LIGHT SHADE U+2591
 *   - LOWER HALF BLOCK U+2584, UPPER HALF BLOCK U+2580
 *   - RIGHT HALF BLOCK U+2590, LEFT HALF BLOCK U+258C
 *
 * ⚠️ THEY ARE EAST ASIAN AMBIGUOUS, and that is the DECLARED RISK the one block has carried
 * since the first drawing rather than a new one: a terminal set to a CJK locale draws them
 * two cells wide, while {@link widthOf} counts what `plain.ts` counts, so the drawing would
 * be twice as wide as everything that measured it thinks. Closing it means a character-width
 * table for the whole surface, which is a delivery rather than a line, and nothing in this
 * file pretends otherwise.
 *
 * No row ends in a blank, and that is load-bearing rather than tidy: the layout trims the
 * end of every row it writes, so a form padded on the right would arrive somewhere trimmed
 * and be a different width than this file thinks it is. The generator this was taken from
 * pads every row to the widest one; the padding came off before it was brought here, and a
 * case asserts the property rather than trusting that it was done.
 */
const THE_BLOCKS: readonly string[] = [
  ' ███▄ ▄███▓ ███▄    █ ▓█████  ███▄ ▄███▓ ▄▄▄',
  '▓██▒▀█▀ ██▒ ██ ▀█   █ ▓█   ▀ ▓██▒▀█▀ ██▒▒████▄',
  '▓██    ▓██░▓██  ▀█ ██▒▒███   ▓██    ▓██░▒██  ▀█▄',
  '▒██    ▒██ ▓██▒  ▐▌██▒▒▓█  ▄ ▒██    ▒██ ░██▄▄▄▄██',
  '▒██▒   ░██▒▒██░   ▓██░░▒████▒▒██▒   ░██▒ ▓█   ▓██▒',
  '░ ▒░   ░  ░░ ▒░   ▒ ▒ ░░ ▒░ ░░ ▒░   ░  ░ ▒▒   ▓▒█░',
  '░  ░      ░░ ░░   ░ ▒░ ░ ░  ░░  ░      ░  ▒   ▒▒ ░',
  '░      ░      ░   ░ ░    ░   ░      ░     ░   ▒',
  '       ░            ░    ░  ░       ░         ░  ░',
];

/**
 * The tall form, as a mask — one mark per inked column, five rows, five letters.
 *
 * Written as a mask, and it is the reason the rule survives with one exception rather than
 * none: a reader of this file sees the SHAPE in characters their editor renders at one
 * width, where a row of full blocks and spaces is the same picture with half of it invisible
 * to a diff. One mark is a mask that shows the form; eight marks is the drawing above, which
 * is why that one is written out.
 *
 * ⚠️ IT STOPPED BEING THE BIGGEST FORM AND IT DID NOT GO. It covers the band between the
 * biggest drawing's fifty columns and the nine of the letterspaced name — a terminal of
 * forty-something columns is in that band — and with the biggest one put in its place there
 * would be nothing at all between fifty columns and nine.
 */
const TALL_MASK: readonly string[] = [
  '#   # #   # ##### #   # #####',
  '## ## ##  # #     ## ## #   #',
  '# # # # # # ####  # # # #####',
  '#   # #  ## #     #   # #   #',
  '#   # #   # ##### #   # #   #',
];

/**
 * The short form: the name in capitals, letterspaced.
 *
 * Letterspacing is the oldest wordmark there is and it is still a drawing of the name
 * rather than the name — which is what keeps this a middle form and not a duplicate of the
 * one below it.
 */
const SHORT_MASK: readonly string[] = ['M N E M A'];

/** The name, as it is typed. The floor: no terminal is too narrow for this one. */
const NAME_MASK: readonly string[] = ['mnema'];

/**
 * Some rows as lines: every mark inked, everything else as it was written.
 *
 * ONE FUNCTION FOR THE MASKS AND FOR THE DRAWING, because the second half of that sentence
 * is what makes it total. A row of {@link THE_BLOCKS} holds no mark, so it comes back as
 * itself; a row of a mask holds nothing but marks and blanks. A second function for the form
 * that is not a mask would be a second answer to what a row of the name becomes.
 */
function inked(rows: readonly string[]): readonly Line[] {
  return rows.map((row) => subjectLine([...row].map((mark) => INKED[mark] ?? mark).join('')));
}

/** The floor, drawn once — the one form that is answered whatever the size. */
const NAME: readonly Line[] = inked(NAME_MASK);

/**
 * The four forms, biggest first — the order the choice below walks.
 *
 * Drawn once, at module scope, because which drawings exist is a constant: nothing about
 * them depends on a terminal, and inking them per call would be the same lines built again
 * on every resize.
 */
const FORMS: readonly (readonly Line[])[] = [
  inked(THE_BLOCKS),
  inked(TALL_MASK),
  inked(SHORT_MASK),
  NAME,
];

/**
 * How wide a form is: its widest row, as a screen counts it.
 *
 * Asked of `plain.ts` rather than counted here, for the reason the panel gives about the
 * same question: how wide a line is is one module's answer, and a second count would be a
 * second opinion about how a line is punctuated.
 */
function widthOf(form: readonly Line[]): number {
  return form.reduce((most, line) => Math.max(most, widthOfLine(line)), 0);
}

/** How much room the device is giving the drawing, and what the page does with it. */
export interface BannerRequest {
  /** How wide the terminal is, asked of the DEVICE by whoever opens the session. */
  readonly columns: number;
  /** How tall it is, asked of the same device in the same place. */
  readonly rows: number;
  /**
   * HOW MANY ROWS THE PAGE NEEDS with a given drawing of the name in it — the box around
   * it, where the session is standing, what the record is, the sentence under it, the input
   * area at the bottom, and the row the layout keeps free.
   *
   * IT IS A QUESTION THIS MODULE MAY NOT ANSWER, and that is the whole shape of the height
   * rule. Nothing in `presentation/` may look at a terminal or know what a box costs, and
   * the drawing is one addend of a sum whose other addends are somewhere else entirely
   * (`repl/panel.ts`, `repl/area.ts`) — so what arrives here is the ANSWER, asked of
   * whoever composes the page.
   *
   * ⚠️ IT IS ASKED PER CANDIDATE RATHER THAN ONCE, and that is not an economy missed. What
   * the page costs is not this drawing's height plus a constant: inside a two-column box the
   * drawing shares its rows with the record's section and the taller of the two is what is
   * paid, and a drawing wide enough to force the stacked arrangement is measured inside a
   * different shape than the one below it. A single number handed in would be right for one
   * form and wrong for the three others, in the direction that draws a page taller than the
   * screen.
   */
  readonly needs: (drawing: readonly Line[]) => number;
}

/**
 * The banner for a terminal of a given size: the biggest form that fits across it and
 * leaves the page fitting down it, and the name when none does.
 *
 * THE SIZE IS ASKED OF THE DEVICE by whoever opens the session and handed in — nothing in
 * `presentation/` may look at a terminal, because a line whose bytes depended on where they
 * landed could not be compared to a recorded transcript (`parts.test.ts` refuses a module
 * here that mentions one). Both measurements come down the SAME path, out of the one place
 * on this surface that asks the device anything (`repl/console.ts`), so the drawing and the
 * page it is drawn on cannot come to disagree about how big the screen is.
 *
 * IT USED TO BE ANSWERED ONCE, when the session opened, on the argument that "a banner
 * that redrew itself on a resize would be rewriting history the caller can scroll back
 * to". What falsified it is the box the drawing now sits inside: it is as wide as the
 * TERMINAL, so a terminal the caller narrowed folds the whole frame in half, and the
 * console draws the page again at the new width. The argument survives and it is the
 * console's to keep — the old page is carried INTO the scrollback before the new one is
 * drawn, so what the caller can scroll back to is added to and never rewritten
 * (`repl/console.ts`, `repl/page.ts`). Nothing here changed: this is a function of two
 * numbers and a question, it is called again with different ones, and it is the caller that
 * decides when.
 */
export function bannerFor(request: BannerRequest): readonly Line[] {
  const fits = (candidate: readonly Line[]): boolean =>
    widthOf(candidate) <= request.columns && request.needs(candidate) <= request.rows;
  return FORMS.find(fits) ?? NAME;
}
