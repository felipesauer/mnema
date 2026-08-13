/**
 * THE NAME, DRAWN — the one thing this surface prints that says nothing about the
 * record.
 *
 * It is ART, and that is the whole of what it is: six rows of full blocks with an outline
 * drawn round them, five rows of one block, or the name letterspaced, or the name. It carries
 * no fact, so there is nothing in it a reader could be misled about, and that is what makes
 * the rule below safe to state.
 *
 * IT DEGRADES BY WIDTH, AND CUTTING ART IS NOT LYING. Everything else this product prints
 * is as wide as it is and gets FOLDED to the screen rather than cut — a line of data cut
 * to fit would be a value a reader cannot check, and the surface refuses to do that (see
 * `items.ts`: a column pads and never truncates). The name is the exception because a
 * smaller drawing of the same word is still the same word.
 *
 * IT SAID THE TERMINAL DID THE FOLDING, and that is what `presentation/folded.ts`
 * falsified — the product folds now, between words and with the continuation indented,
 * and the terminal only gets rows that fit. Nothing about the rule below moved: what makes
 * the name an exception is that it may be CUT, and cutting is still the one thing no line
 * of data may be. So there are four drawings, and the widest one
 * that FITS is the one that is drawn — the threshold is each form's own width rather than
 * a number somebody chose, which is what keeps the rule from drifting away from the art
 * the day a letter changes.
 *
 * AND IT DEGRADES BY HEIGHT, WHICH IS NOT THE SAME RULE ON THE OTHER MEASUREMENT. IT WAS
 * WRITTEN AS THOUGH IT WERE, and the paragraph here said the threshold was "the form's own
 * HEIGHT for the same reason it is the form's own width on the other". WHAT FALSIFIED IT IS
 * A MEASUREMENT: the tallest form was five rows, `5 <= rows` is true on every terminal
 * anybody has, and the axis chose nothing at any size a person opens. A mechanism plumbed
 * to the end whose threshold never fires is the same defect as an option with no caller.
 *
 * THE TWO AXES HAVE DIFFERENT ROLES, and that is why the rule could not be copied across.
 * Across the screen the drawing IS what disputes the room: it is the widest thing in its
 * column, so "the drawing fits" and "the page fits" are one question. Down the screen it is
 * a PARCEL — what the session is, the place it is standing, what the record is, the
 * sentence under it and the input area all take rows too — and a form that asked "do I
 * fit?" ignored every other addend and answered yes. So the question asked on this axis is
 * asked of whoever composes the page ({@link BannerRequest.needs}), and this module may not
 * answer it. Pinned in both directions in `tests/the-opening-fits-the-screen.test.ts`, where
 * the size a form gives way at is searched for rather than written down.
 *
 * AND THE AXIS STILL CHOSE NOTHING, FOR A SECOND REASON, WHICH IS WHAT IT NOW RULES ON. The
 * question handed in was *does the PAGE fit with this drawing in it*, and a page answers that
 * more easily the more of itself it has given up: a drawing too big for the arrangement around
 * it makes the console drop the arrangement and land those lines on the roll, which is a page
 * with no fixed region at all and therefore the cheapest page there is. Measured on the terminal
 * everybody has, at eighty by twenty-four: the nine-row drawing landed the whole opening on the
 * roll, the page came to twenty-two of the twenty-four rows, `22 <= 24` was true, and the
 * biggest drawing was kept BECAUSE it had cost the arrangement. So the threshold fired on no
 * screen, twice over, for two different reasons — and the second is the sharper lesson: a rule
 * satisfied by the damage it exists to prevent is worse than no rule.
 *
 * AND THE THRESHOLD IS NOW MET AT THE FLOOR ITSELF, WHICH IS A CONSEQUENCE TO DECLARE RATHER
 * THAN A DEFECT TO HIDE. The shortest window this console draws a page on was redefined as the
 * height the biggest drawing is chosen at (`repl/floor.ts`), so on a page of the weight that was
 * measured there, no window a device can report is ever given a smaller drawing by this axis —
 * the ladder's rungs are all BELOW the floor. It is not the defect this paragraph warns about,
 * and the difference is where the number comes from: what the drawing is measured against is
 * still what the arrangement really costs, and what the arrangement costs is a function of what
 * the record SAYS, so a heavier page still walks the ladder above the same floor. Both halves are
 * pinned in `tests/the-floor-is-where-the-name-is-drawn.test.ts` and in
 * `tests/the-opening-fits-the-screen.test.ts`, where the ladder above the floor is asserted to be
 * EMPTY rather than left to be discovered.
 *
 * WHAT IT IS MEASURED AGAINST NOW IS THE ARRANGEMENT the drawing would be put in. The region at
 * the top of that console is FIXED — drawn on every frame, never scrolled — so it may hold at
 * most a share of the screen (`repl/panel.ts`), and what arrives here is the taller of two
 * demands: the rows the page needs, and the shortest screen on which this drawing's arrangement
 * would still be inside that share. Nothing about this module moved: it is still the biggest
 * form whose width fits and whose demand the screen meets, it still knows no rule about
 * arrangements, and the number is still somebody else's answer (`repl/session.ts`). What changed
 * is that the number can now say no — and the ladder it makes down the height is walked, one row
 * at a time, in `tests/the-opening-fits-the-screen.test.ts`.
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
 * produces; the console's opening panel paints this drawing and the row that says what the
 * session is in one accent, and that accent is CHROME — it is the layout's, it is spent in one
 * place, and it is a hue no severity uses (`repl/region.ts`, and the guard in
 * `tests/the-panel.test.ts`). IT USED TO PAINT A BORDER AND A TITLE ON IT as well, and the
 * frame is gone; the rule did not move, only what there is to spend it on. Nothing in this
 * module knows about it: the drawing is the
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
 * THERE WERE FOUR OF THEM, and the other three were the two diagonals and the vertical
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
 * IT HELD FOUR SUBSTITUTIONS AND IT HOLDS ONE, because the drawing that needed the other
 * three is no longer written as a mask at all ({@link THE_BLOCKS}). One entry rather than
 * none: the five-row form is still a mask, and a table with one key is what keeps the inking
 * in one place for whichever mask is written next.
 */
const INKED: { readonly [mark: string]: string } = {
  '#': INK,
};

/**
 * THE BIGGEST DRAWING, AS THE DRAWING — six rows of full blocks with an outline drawn round
 * them, forty-eight columns, and the one form in this file that is not written as a mask.
 *
 * IT WAS NINE ROWS OF BLOCKS AND SHADES AND IT IS SIX, and the choice was made between
 * samples drawn in the real arrangement rather than in the abstract. What the nine-row one
 * spent its last three rows on was DUST — the light shades that make a drop shadow — and dust
 * is what disappears first in a thin font, so a third of the height was paying for something a
 * reader may not have at all. What is here instead is one weight of ink and a contour: the same
 * word, said in full blocks, at two thirds of the rows and two columns narrower. A drawing of
 * three rows was offered beside it and refused for the reason the requirement was made in — the
 * name was asked to be BIGGER, and a compact form is the other direction.
 *
 * AND THE ROWS ARE WHAT THE FLOOR IS MADE OF, which is why this is not only a change of
 * picture. The shortest window this console draws a page on is the height at which this drawing
 * is still chosen (`repl/floor.ts`), and that height is worked out FROM these rows — so three
 * rows of art fewer is a floor nine rows lower, without anybody editing a number. The old
 * drawing put back moves it back, which is a case rather than a claim
 * (`tests/the-name-in-full-blocks.test.ts`).
 *
 * IT WOULD HAVE BEEN A MASK, AND A DRAWING OF EIGHT SHADES IS WHAT FALSIFIED THE PREMISE THAT
 * SAID SO. Every form here has been written as *characters an editor renders at one width and a
 * diff can show*, and the argument under that rule is that a reader sees the FORM. The nine-row
 * drawing was inked with EIGHT different blocks and shades: as a mask its first row read
 * ` ###_ _###% ###_    # %#####` — measured, by writing it out — and at eight marks the FORM is
 * the one thing that stops being visible. That drawing is gone and the premise stays
 * falsified: this one is inked with SEVEN glyphs, which is a mask of seven marks, and the
 * finding was never about the exact number.
 *
 * WHAT THE DOCTRINE IS REALLY AGAINST IS A CHARACTER A READER CANNOT SEE — an escape, a NUL,
 * a zero-width space, the twenty-four bytes this bench has paid for — and a block is the
 * opposite of invisible. What replaces the mask is stronger than the mask was: an
 * ENUMERATION of the code points this module may hold, each one named, with any other
 * non-ASCII byte in the file ACCUSED (`tests/the-opening-fits-the-screen.test.ts`, which
 * also keeps a second copy of these rows so that an edit to the art is loud).
 *
 *   - FULL BLOCK U+2588 — the ink itself, and the one glyph this drawing shares with the mask
 *     under it ({@link INK})
 *   - BOX DRAWINGS DOUBLE HORIZONTAL U+2550 and DOUBLE VERTICAL U+2551
 *   - BOX DRAWINGS DOUBLE DOWN AND RIGHT U+2554, DOUBLE DOWN AND LEFT U+2557
 *   - BOX DRAWINGS DOUBLE UP AND RIGHT U+255A, DOUBLE UP AND LEFT U+255D
 *
 * THEY ARE EAST ASIAN AMBIGUOUS, and that is the DECLARED RISK the one block has carried
 * since the first drawing rather than a new one: a terminal set to a CJK locale draws them
 * two cells wide, while {@link widthOfTheDrawing} counts what `plain.ts` counts, so the drawing
 * would be twice as wide as everything that measured it thinks. The six new ones are in the
 * same class as the block that was already here — the debt did not grow a kind, it grew a
 * count — and what the delivery that brought them did instead of asserting it was to ASK the
 * product's own measurement, glyph by glyph, rather than read the standard
 * (`tests/the-name-in-full-blocks.test.ts`). Closing it means a character-width table for the
 * whole surface, which is a delivery rather than a line, and nothing in this file pretends
 * otherwise.
 *
 * No row ends in a blank, and that is load-bearing rather than tidy: the layout trims the
 * end of every row it writes, so a form padded on the right would arrive somewhere trimmed
 * and be a different width than this file thinks it is. The generator this was taken from
 * pads every row to the widest one; the padding came off before it was brought here, and a
 * case asserts the property rather than trusting that it was done.
 *
 * SO THE DRAWING IS FORTY-EIGHT COLUMNS AND ITS TOP ROW IS FORTY-SEVEN, which is that rule
 * seen from the other end rather than a row of the wrong width. The last letter's top row ends
 * in a blank — its own shape, in every generator this font exists in — and that blank is
 * padding at the end of the whole row, so it came off with the rest. What the two numbers mean
 * is that no terminal ever draws a forty-eighth column on that row, and the five rows under it
 * are the same width to the column ({@link widthOfTheDrawing} is what the page is measured by,
 * and it answers forty-eight).
 */
const THE_BLOCKS: readonly string[] = [
  '███╗   ███╗███╗   ██╗███████╗███╗   ███╗ █████╗',
  '████╗ ████║████╗  ██║██╔════╝████╗ ████║██╔══██╗',
  '██╔████╔██║██╔██╗ ██║█████╗  ██╔████╔██║███████║',
  '██║╚██╔╝██║██║╚██╗██║██╔══╝  ██║╚██╔╝██║██╔══██║',
  '██║ ╚═╝ ██║██║ ╚████║███████╗██║ ╚═╝ ██║██║  ██║',
  '╚═╝     ╚═╝╚═╝  ╚═══╝╚══════╝╚═╝     ╚═╝╚═╝  ╚═╝',
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
 * IT STOPPED BEING THE BIGGEST FORM AND IT DID NOT GO. It covers the band between the
 * biggest drawing's forty-eight columns and the nine of the letterspaced name — a terminal of
 * forty-something columns is in that band — and with the biggest one put in its place there
 * would be nothing at all between forty-eight columns and nine.
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
 * THE BIGGEST FORM, AS LINES — the drawing itself, and the thing the shortest window this
 * console draws on is worked out from.
 *
 * EXPORTED, AND THE EXPORT IS THE POINT OF THIS DELIVERY. The floor used to be a number
 * somebody had measured by driving a binary one row at a time, written down, and true of a
 * drawing that could then be replaced under it — which is the class of defect this console has
 * paid for three times: a number of geometry worked out once and read by somebody who is not of
 * that instant. So the floor asks THIS value how tall the drawing is and works its own height
 * out (`repl/floor.ts`), and the module that owns the art is the one place the art is stated.
 *
 * IT IS THE FIRST ELEMENT OF {@link FORMS} rather than a copy of it, which is what keeps the
 * two from disagreeing: a fifth form put above this one would be the biggest drawing and would
 * not be what the floor was measured against, and there is no way to write that here.
 */
export const THE_BIGGEST_DRAWING: readonly Line[] = inked(THE_BLOCKS);

/**
 * The four forms, biggest first — the order the choice below walks.
 *
 * Drawn once, at module scope, because which drawings exist is a constant: nothing about
 * them depends on a terminal, and inking them per call would be the same lines built again
 * on every resize.
 */
const FORMS: readonly (readonly Line[])[] = [
  THE_BIGGEST_DRAWING,
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
 *
 * EXPORTED FOR THE FLOOR, which asks it of {@link THE_BIGGEST_DRAWING}: the shortest window
 * this console draws on has to be at least wide enough for the page to hold the drawing inside
 * its margin, and a second count of how wide the art is would be exactly the second opinion the
 * paragraph above refuses. One statement, two readers — the choice below, and the floor.
 */
export function widthOfTheDrawing(form: readonly Line[]): number {
  return form.reduce((most, line) => Math.max(most, widthOfLine(line)), 0);
}

/** How much room the device is giving the drawing, and what the page does with it. */
export interface BannerRequest {
  /** How wide the terminal is, asked of the DEVICE by whoever opens the session. */
  readonly columns: number;
  /** How tall it is, asked of the same device in the same place. */
  readonly rows: number;
  /**
   * HOW TALL A SCREEN A GIVEN DRAWING OF THE NAME NEEDS — the shortest one this drawing may be
   * put on at all.
   *
   * IT WAS *HOW MANY ROWS THE PAGE NEEDS WITH THIS DRAWING IN IT*, and the rename is the
   * correction rather than a wording: a page is cheapest when the arrangement around the drawing
   * has already been given up, so a demand measured on the page alone was met most easily by the
   * drawing that had done the most damage (the header of this file has the measurement). What is
   * asked for is the taller of two demands — the rows the page takes, and the shortest screen on
   * which this drawing's arrangement is still within the share a fixed region may hold — so a
   * drawing that would cost the ARRANGEMENT is refused by the same comparison that refuses one
   * that would cost the page.
   *
   * IT IS A QUESTION THIS MODULE MAY NOT ANSWER, and that is the whole shape of the height
   * rule. Nothing in `presentation/` may look at a terminal or know what an arrangement
   * costs, and the drawing is one addend of a sum whose other addends are somewhere else
   * entirely (`repl/panel.ts`, `repl/area.ts`) — so what arrives here is the ANSWER, asked of
   * whoever composes the page.
   *
   * IT IS ASKED PER CANDIDATE RATHER THAN ONCE, and that is not an economy missed. What
   * the page costs is not this drawing's height plus a constant: with the text BESIDE the mark
   * the drawing shares its rows with it and the taller of the two is what is paid, and a
   * drawing wide enough to force the stacked arrangement is measured inside a different shape
   * than the one below it. A single number handed in would be right for one form and wrong for
   * the three others, in the direction that draws a page taller than the screen.
   */
  readonly needs: (drawing: readonly Line[]) => number;
}

/**
 * The banner for a terminal of a given size: the biggest form that fits across it and that the
 * screen is tall enough for, and the name when none is.
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
 * to". What falsified it was the box the drawing sat inside: it was as wide as the
 * TERMINAL, so a terminal the caller narrowed folded the whole frame in half, and the
 * console draws the page again at the new width. THE BOX IS GONE AND THE ANSWER IS THE
 * SAME ONE: which ARRANGEMENT the width has room for is still a function of the width, so a
 * terminal narrowed past that threshold still has the wrong page on it. The argument survives
 * and it is the
 * console's to keep — the old page is carried INTO the scrollback before the new one is
 * drawn, so what the caller can scroll back to is added to and never rewritten
 * (`repl/console.ts`, `repl/page.ts`). Nothing here changed: this is a function of two
 * numbers and a question, it is called again with different ones, and it is the caller that
 * decides when.
 */
export function bannerFor(request: BannerRequest): readonly Line[] {
  const fits = (candidate: readonly Line[]): boolean =>
    widthOfTheDrawing(candidate) <= request.columns && request.needs(candidate) <= request.rows;
  return FORMS.find(fits) ?? NAME;
}
