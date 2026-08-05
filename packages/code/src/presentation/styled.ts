/**
 * The STYLED renderer: the same line, with each part's weight said in escapes.
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
 * WEIGHT ONLY — NO COLOUR, and that is a technical limit rather than restraint.
 * Colour is how a terminal says GOOD and BAD, and a part does not know whether it is
 * either: `statement(label, detail)` gives its label the role `label`, which says
 * "this leads the line", not "this passed". Painting a verdict green would need a
 * severity nothing produces, and painting an id differently from a state would need
 * roles finer than the four that exist — and the four exist because they are the four
 * distinctions the CALL SITES make today (see `line.ts` for what it refuses to
 * invent). Either would be information new at the call sites, and the renderer is
 * what makes it worth carrying: this file is the consumer that has to exist first.
 *
 * The escapes are SGR: `1` is bold, `2` is faint, and `22` returns to normal
 * intensity — one closer for both, because it is the ANSI code for "neither bold nor
 * faint" and nothing here nests. Deliberately not `0`, which would also reset a
 * colour a caller's terminal set for its own reasons.
 */

import type { Part, Role } from './line.js';
import { renderWith } from './plain.js';
import type { Render } from './render.js';

/** Bold: SGR 1. */
const BOLD = '\u001b[1m';
/** Faint: SGR 2 — what a terminal shows as dim. */
const DIM = '\u001b[2m';
/** Back to normal intensity: SGR 22, the closer for both of the above. */
const NORMAL = '\u001b[22m';

/**
 * What opens each role, and the empty string for a role written bare.
 *
 * Total over {@link Role} by type — the same rule the separator table keeps, for the
 * same reason: a role that did not say how it is painted would be painted by whatever
 * a fallback chose, and a surface would acquire an emphasis nobody decided on. A role
 * added to the union without an entry here does not build.
 *
 * The four, and the convention each follows:
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
 */
const OPENED_BY: { readonly [R in Role]: string } = {
  label: BOLD,
  subject: BOLD,
  field: '',
  detail: DIM,
};

/**
 * One part as the bytes it occupies: its text, wrapped in its role's weight.
 *
 * A part whose role is written bare is returned UNTOUCHED — not wrapped in an empty
 * pair — so the styled line of a list of columns is byte for byte the plain one, and
 * the common case costs nothing at all.
 *
 * The text goes through verbatim, escapes and all. A stored field that holds an
 * escape byte of its own is text an actor wrote, and this renderer neither strips it
 * nor honours it; that is the content door's business and not a renderer's (see
 * `served-patterns.ts`).
 */
function painted(part: Part): string {
  const opener = OPENED_BY[part.role];
  return opener === '' ? part.text : `${opener}${part.text}${NORMAL}`;
}

/**
 * The renderer for a terminal that can show weight — chosen at the entry, never here
 * (see `wiring/color.ts` for what chooses it, and `render.ts` for why nothing in
 * `presentation/` may ask).
 */
export const renderStyled: Render = renderWith(painted);
