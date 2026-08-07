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
 * AND THE NARROWEST STILL SAYS THE NAME. There is no form that draws nothing: a terminal
 * too narrow even for five characters gets the five characters anyway, because the one
 * thing this banner exists to say is the only thing that may not be dropped.
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
 * else. Colour on this surface means severity and nothing else (`styled.ts`), and a banner
 * is the most tempting place there is to spend a hue on decoration.
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

/** The three forms, widest first — the order the choice below walks. */
const FORMS: readonly (readonly string[])[] = [TALL, SHORT, NAME];

/** How wide a form is: its widest row. */
function widthOf(form: readonly string[]): number {
  return Math.max(...form.map((row) => [...row].length));
}

/**
 * The banner for a terminal `columns` wide: the widest form that fits, and the name when
 * none does.
 *
 * `columns` is asked of the DEVICE by whoever opens the session and handed in — nothing in
 * `presentation/` may look at a terminal, because a line whose bytes depended on where they
 * landed could not be compared to a recorded transcript (`parts.test.ts` refuses a module
 * here that mentions one).
 *
 * It is answered ONCE, when the session opens, and the drawing then belongs to the
 * scrollback like every other line the session has already said. A banner that redrew
 * itself on a resize would be rewriting history the caller can scroll back to.
 */
export function bannerFor(columns: number): readonly Line[] {
  const form = FORMS.find((candidate) => widthOf(candidate) <= columns) ?? NAME;
  return form.map((row) => subjectLine(row));
}
