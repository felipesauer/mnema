/**
 * THE NAME, DRAWN — the one thing this surface prints that says nothing about the
 * record.
 *
 * It is ART, and that is the whole of what it is: five rows of a glyph, or the name
 * letterspaced, or the name. It carries no fact, so there is nothing in it a reader could
 * be misled about, and that is what makes the rule below safe to state.
 *
 * IT DEGRADES BY WIDTH, AND CUTTING ART IS NOT LYING. Everything else this product prints
 * is as wide as it is and lets the TERMINAL fold it — a line of data cut to fit would be a
 * value a reader cannot check, and the surface refuses to do that (see `items.ts`: a
 * column pads and never truncates). The name is the exception because a smaller drawing of
 * the same word is still the same word. So there are three drawings, and the widest one
 * that FITS is the one that is drawn — the threshold is each form's own width rather than
 * a number somebody chose, which is what keeps the rule from drifting away from the art
 * the day a letter changes.
 *
 * AND IT DEGRADES BY HEIGHT, WHICH IS THE SAME RULE ON THE OTHER MEASUREMENT. A drawing
 * five rows tall on a terminal four rows tall is art that does not fit on the screen it
 * opens: the top of it is in the scrollback before the caller has typed anything, and what
 * scrolled away is the one thing the banner exists to say. So a form gives way on either
 * axis, and the threshold on this one is the form's own HEIGHT for the same reason it is
 * the form's own width on the other — the drawing is what is right, and a number here
 * would be a second opinion about how tall it is. Pinned in both directions in
 * `tests/the-opening-fits-the-screen.test.ts`, where the height a form gives way at is
 * searched for rather than written down.
 *
 * IT IS THE THIRD PLACE THIS SURFACE CHOOSES A FORM BY A MEASUREMENT, and now the only one
 * that chooses by both: the panel picks by width (`repl/panel.ts`) and the input area by
 * height (`repl/area.ts`), each with the same shape of answer — the richest arrangement
 * that fits, a floor that is answered whatever the size, and a threshold taken off the
 * drawing.
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

/**
 * The glyph the tall form is drawn with: FULL BLOCK, U+2588.
 *
 * Named by its code point rather than typed, and the reason is the one this bench has
 * paid for eleven times: a character a reader cannot see in a source file survives every
 * edit made around it. A mask of ASCII marks below and one substitution here means the
 * only unusual byte in this module is on this line, where it is spelled out.
 */
const INK = '\u2588';

/** Where the ink goes in the mask: the mark, and the space that is left blank. */
const MARK = '#';

/**
 * The tall form, as a mask — one mark per inked column, five rows, five letters.
 *
 * Written as a mask rather than as the drawing itself so that a reader of this file sees
 * the SHAPE in characters their editor renders at one width; a row of full blocks and
 * spaces is the same picture with half of it invisible to a diff.
 *
 * No row ends in a blank, and that is load-bearing rather than tidy: the layout trims the
 * end of every row it writes, so a form padded on the right would arrive somewhere trimmed
 * and be a different width than this file thinks it is.
 */
const TALL_MASK: readonly string[] = [
  '#   # #   # ##### #   # #####',
  '## ## ##  # #     ## ## #   #',
  '# # # # # # ####  # # # #####',
  '#   # #  ## #     #   # #   #',
  '#   # #   # ##### #   # #   #',
];

/** The tall form: the mask with every mark inked. */
const TALL: readonly string[] = TALL_MASK.map((row) => row.split(MARK).join(INK));

/**
 * The short form: the name in capitals, letterspaced.
 *
 * Letterspacing is the oldest wordmark there is and it is still a drawing of the name
 * rather than the name — which is what keeps this a middle form and not a duplicate of the
 * one below it.
 */
const SHORT: readonly string[] = ['M N E M A'];

/** The name, as it is typed. The floor: no terminal is too narrow for this one. */
const NAME: readonly string[] = ['mnema'];

/** The three forms, biggest first — the order the choice below walks. */
const FORMS: readonly (readonly string[])[] = [TALL, SHORT, NAME];

/** How wide a form is: its widest row. */
function widthOf(form: readonly string[]): number {
  return Math.max(...form.map((row) => [...row].length));
}

/** How tall a form is: how many rows it draws. */
function heightOf(form: readonly string[]): number {
  return form.length;
}

/** How much room the device is giving the drawing. Both measurements, asked in one place. */
export interface BannerRequest {
  /** How wide the terminal is, asked of the DEVICE by whoever opens the session. */
  readonly columns: number;
  /** How tall it is, asked of the same device in the same place. */
  readonly rows: number;
}

/**
 * The banner for a terminal of a given size: the biggest form that fits across it and down
 * it, and the name when none does.
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
 * numbers, it is called again with different ones, and it is the caller that decides when.
 */
export function bannerFor(request: BannerRequest): readonly Line[] {
  const fits = (candidate: readonly string[]): boolean =>
    widthOf(candidate) <= request.columns && heightOf(candidate) <= request.rows;
  const form = FORMS.find(fits) ?? NAME;
  return form.map((row) => subjectLine(row));
}
