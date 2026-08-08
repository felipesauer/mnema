/**
 * The STYLED renderer: the same line, with each part's weight and its news said in
 * escapes.
 *
 * It composes through {@link renderWith}, so the depth, the separators and the order
 * are the plain renderer's — literally the same loop. All this file decides is what
 * wraps a part's own text, which is what makes the promise below true by construction
 * rather than by two files agreeing:
 *
 *   STRIP THE ESCAPES AND YOU HAVE THE PLAIN LINE, exactly. Not "almost", and not
 *   "the same information": the same bytes. mnema is a tool for auditing a record, so
 *   a reader has to be able to trust that what they are looking at says the same thing
 *   as what a CI log, a redirected file or a colleague's terminal says. Style that
 *   could add, drop or reorder a character would make the terminal a fourth account
 *   of the record. `styled.test.ts` asserts it over every shape the surface builds.
 *
 * IT PAINTS NOW, AND THE DOC HERE USED TO SAY IT COULD NOT. The premise was "WEIGHT
 * ONLY — NO COLOUR, and that is a technical limit rather than restraint": colour is
 * how a terminal says GOOD and BAD, a part did not know whether it was either, and
 * painting a verdict green would have needed a severity nothing produced. What
 * falsified it is that something produces one — {@link statement} takes an optional
 * severity and the refusal funnel sets it (`wiring/report.ts`) — and the map below is
 * the consumer that had to exist first. The limit was real and it was named
 * correctly; it was a limit about the CALL SITES, and they moved.
 *
 * COLOUR IS NEVER THE CARRIER, and that is the rule the two axes are built around. A
 * refusal says the word `Refused`, a verdict says `ALLOWED` or `REFUSED`, and the hue
 * repeats it for an eye scanning a screen. A reader on a monochrome terminal, in a
 * pipe, with `--color=never`, or with the eight percent of colour vision that does not
 * separate red from green loses NOTHING, because there was nothing only the hue said.
 * `styled.test.ts` asserts that half too: what the plain line says is what the painted
 * one says.
 *
 * THE BASIC EIGHT, never RGB and never a 256-colour index. A terminal's red is the red
 * of the theme its reader chose; a fixed `38;2;220;50;47` is a red that can land
 * unreadable on a light background, and nobody would be able to fix it from their side.
 * It is what git and gh do, and it is the same argument as using SGR at all.
 *
 * The escapes are SGR: `1` is bold, `2` is faint, and `22` returns to normal
 * intensity — one closer for both, because it is the ANSI code for "neither bold nor
 * faint" and nothing here nests. `31`, `32` and `33` are red, green and yellow, all
 * closed by `39`, the default foreground. Deliberately not `0`, which would also reset a
 * colour a caller's terminal set for its own reasons.
 */

import type { Part, Role, Severity } from './line.js';
import { renderWith } from './plain.js';
import type { Render } from './render.js';

/** Bold: SGR 1. */
const BOLD = '\u001b[1m';
/** Faint: SGR 2 — what a terminal shows as dim. */
const DIM = '\u001b[2m';
/** Back to normal intensity: SGR 22, the closer for both of the above. */
const NORMAL = '\u001b[22m';

/** Red: SGR 31, the basic one, so a reader's theme decides which red. */
const RED = '\u001b[31m';
/** Green: SGR 32, the basic one, for the same reason. */
const GREEN = '\u001b[32m';
/** Yellow: SGR 33, the basic one — the third, for news that is neither. */
const YELLOW = '\u001b[33m';
/** Back to the terminal's own foreground: SGR 39, the closer for every hue. */
const DEFAULT_HUE = '\u001b[39m';

/**
 * What opens each role, and the empty string for a role written bare.
 *
 * Total over {@link Role} by type — the same rule the separator table keeps, for the
 * same reason: a role that did not say how it is painted would be painted by whatever
 * a fallback chose, and a surface would acquire an emphasis nobody decided on. A role
 * added to the union without an entry here does not build.
 *
 * The seven, and the convention each follows:
 *
 *   - `label` — bold. It leads the line and it is what a reader scanning a log for a
 *     refusal reads first, which is the one thing git, gh and kubectl all embolden.
 *   - `subject` — bold. A heading, and headings are the other half of that same
 *     convention.
 *   - `field` — bare. A column of a list is the DATA; emphasising all of it emphasises
 *     nothing, and this is most of what the surface prints.
 *   - `detail` — dim. Secondary by construction: it is the half of a statement that
 *     follows the colon, and dimming what is secondary is the convention a reader
 *     already knows from `git status` and `gh pr list`.
 *   - `clause` — dim, the same as the detail it is a refinement of, and the sameness is
 *     load-bearing rather than a coincidence to collapse. `verify`'s verdict used to
 *     arrive as ONE detail holding every clause, so the whole sentence was dim; splitting
 *     it into the clauses the chain hands over must not change the weight of a single
 *     word of it, or the split would have been a restyling wearing a decomposition's
 *     clothes. What the split buys is that ONE clause can now carry a hue.
 *   - `state` — bare, exactly like the `field` it rides. A position's WEIGHT is the
 *     title's: emboldening or dimming every state would say something about all of them,
 *     and what distinguishes them is not how much they matter but what a reader does
 *     next. That travels on the other axis — three of the five dispositions carry a
 *     severity and two carry none (see `state.ts`) — so a state with nothing to report
 *     comes out byte for byte the plain line, which is most of them.
 *   - `id` and `when` — dim, and they are the reason this map was worth extending. A
 *     list of hits is columns of `field` that all weigh the same, so nothing in it
 *     stood out; dimming the two columns nobody READS makes the title beside them the
 *     line's subject, WITHOUT painting the title. It is emphasis by subtraction, which
 *     is the only kind that scales to six lists (see `line.ts` for why no third
 *     column joined them).
 */
const OPENED_BY: { readonly [R in Role]: string } = {
  label: BOLD,
  subject: BOLD,
  field: '',
  detail: DIM,
  clause: DIM,
  id: DIM,
  when: DIM,
  state: '',
};

/**
 * What each severity paints, and it is the whole use of hue on this surface.
 *
 * Total over {@link Severity} by type, for the third time and the same reason: a
 * severity a call site could set and this map had no entry for would be news reported
 * in whatever a fallback chose.
 *
 * THREE ENTRIES, and the triple is deliberately the most conventional one in a terminal:
 * red is the answer a caller has to act on, green is the one they do not, and yellow is
 * the one where neither is true. It was two, and `line.ts` says what falsified the
 * premise that there was no third to say — a proven level that is neither a break nor a
 * signature. Nothing here decides WHICH a given line is: the call site says (see
 * `verdict.ts`, `wiring/verify.ts` and `state.ts`), and that is what keeps the renderer
 * from being the thing that judges the record.
 *
 * AND THE TRIPLE MEANS ONE THING PER HUE, whichever call site sets it. That is the whole
 * reason a record's position reuses this scale instead of getting one of its own: a
 * `stalled` task is red because it is an answer a caller has to act on, exactly as a
 * refusal is; a `settled` one is green for the same reason `ALLOWED` is, and so is a
 * decision in force. A second vocabulary would have given this surface two reds meaning
 * different things, which is how a hue stops being readable at all — and it is why the
 * three machines' positions come through ONE table on the way here (`state.ts`), not one
 * per machine.
 */
const PAINTED_BY: { readonly [S in Severity]: string } = {
  good: GREEN,
  warn: YELLOW,
  bad: RED,
};

/**
 * One part as the bytes it occupies: its text, wrapped in its role's weight and then
 * in its severity's hue.
 *
 * A part that opens NOTHING is returned untouched — not wrapped in an empty pair — so
 * the styled line of a list of plain columns is byte for byte the plain one, and the
 * common case costs nothing at all.
 *
 * Each wrap is closed by its own closer and only its own: `22` says "neither bold nor
 * faint" and `39` says "the terminal's own foreground", so a bold-and-red label closes
 * both and a dim id closes one. Closing what was never opened would reset a colour the
 * caller's terminal set for its own reasons, which is the same argument that keeps `0`
 * out of this file.
 *
 * The text goes through verbatim, escapes and all. A stored field that holds an
 * escape byte of its own is text an actor wrote, and this renderer neither strips it
 * nor honours it; that is the content door's business and not a renderer's (see
 * `served-patterns.ts`).
 */
function painted(part: Part): string {
  const weight = OPENED_BY[part.role];
  const hue = part.severity === undefined ? '' : PAINTED_BY[part.severity];
  if (weight === '' && hue === '') return part.text;
  const closer = `${hue === '' ? '' : DEFAULT_HUE}${weight === '' ? '' : NORMAL}`;
  return `${weight}${hue}${part.text}${closer}`;
}

/**
 * The renderer for a terminal that can show weight and colour — chosen at the entry,
 * never here (see `wiring/color.ts` for what chooses it, and `render.ts` for why
 * nothing in `presentation/` may ask).
 */
export const renderStyled: Render = renderWith(painted);
