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
 * THE ACCENT: SGR 35, magenta — the one hue on this surface that is not news, and the
 * only one a ROLE carries rather than a severity.
 *
 * IT IS THE PRODUCT'S MARK AND NOT A VERDICT, which is what keeps the promise above whole
 * rather than making an exception to it. Red, green and yellow say how bad the news is;
 * magenta says *this is mnema*. It is what the console's own rules are drawn in
 * (`repl/region.ts`, `ACCENT`), and the only thing here that takes it is the PROMPT of an
 * echo — the console showing a caller what they sent (`echo.ts`). Nothing about the
 * record is ever wrapped in it, and nothing wrapped in it says anything a reader could
 * lose: strip the escapes and the prompt is still there, spelled out, which is the same
 * argument the three severities are painted under.
 *
 * AND IT IS THE SECOND SPELLING OF ONE ACCENT, which is the risk this constant carries
 * and the reason it is named here rather than left as a number. The layout says the WORD
 * `magenta` to the library that draws the rules; this says the escape a terminal reads.
 * Two spellings of one decision is how a surface comes to have two accents, so they are
 * not left agreeing by inspection: the echo's prompt is asserted to be wrapped in the
 * very escapes a rule of the input area carries, on the bytes of one frame
 * (`tests/the-page-shows-its-seams.test.ts`).
 */
const ACCENT = '\u001b[35m';

/**
 * What opens each role, and the empty string for a role written bare.
 *
 * Total over {@link Role} by type — the same rule the separator table keeps, for the
 * same reason: a role that did not say how it is painted would be painted by whatever
 * a fallback chose, and a surface would acquire an emphasis nobody decided on. A role
 * added to the union without an entry here does not build.
 *
 * The ten, and the convention each follows:
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
 *   - `id`, `when` and `scope` — dim, and they are the reason this map was worth
 *     extending. A list of hits is columns of `field` that all weigh the same, so nothing
 *     in it stood out; dimming the columns nobody READS makes the title beside them the
 *     line's subject, WITHOUT painting the title. It is emphasis by subtraction, which is
 *     the only kind that scales to six lists. IT WAS TWO, AND THIS FILE POINTED AT
 *     `line.ts` FOR *why no third column joined them* — the scope is that third, it
 *     joined for this entry's own argument rather than for one of its own, and `line.ts`
 *     is where the premise it falsified is written out.
 *   - `prompt` — bare, and it is the one role that carries a HUE of its own
 *     ({@link TINTED_BY}). What a caller typed in front of is the product's mark on the
 *     page rather than a fact about the record, so it takes the accent and no weight: an
 *     echo emboldened at both ends would be a row shouting where a reader is looking for
 *     the words they typed.
 *   - `pick` — bare, and the second role that carries a HUE of its own
 *     ({@link TINTED_BY}). The mark on the row a caller chose is the console's own
 *     punctuation rather than a fact, so it takes the accent; what it does NOT take is a
 *     weight, because the glyph is already the whole answer and an emboldened mark would be
 *     the row shouting about being the row.
 *   - `typed` — bold, exactly like the `label` it is a refinement of, and the sameness is
 *     the point rather than a duplication to collapse. A caller scrolling a session is
 *     looking for the line they asked, in among the answer to it, and that is the same
 *     thing a reader scanning a log for a refusal is doing.
 *   - `word` — bare, and the THIRD role that carries a HUE of its own ({@link TINTED_BY}).
 *     A word a caller could type is the product's own vocabulary offered back rather than a
 *     fact about the record, so it takes the accent; what it does not take is a weight, for
 *     the reason the mark does not — a list where four rows are emboldened is four rows
 *     shouting, and what makes the word the subject of its row is that the description
 *     beside it is NOT painted.
 */
const OPENED_BY: { readonly [R in Role]: string } = {
  label: BOLD,
  subject: BOLD,
  field: '',
  detail: DIM,
  clause: DIM,
  id: DIM,
  when: DIM,
  scope: DIM,
  state: '',
  prompt: '',
  typed: BOLD,
  pick: '',
  word: '',
};

/**
 * What each role TINTS, and the empty string for every role that carries no hue of its
 * own — which is all of them but one.
 *
 * Total over {@link Role} by type, exactly like the two tables it sits between, and for
 * the third time the same reason: a role whose hue nobody stated would be painted by
 * whatever a fallback chose.
 *
 * IT IS ONE ACCENT ON THREE ROLES, AND THE SENTENCE BELOW SAID *all of them but one*. What
 * moved is not the count of hues, which is still one: the echo's prompt, the mark on a
 * picked row and a word in the console's list of words are the three parts of this surface
 * that are the PRODUCT rather than the record, and every one of them says *this is mnema*.
 * A fourth hue would be a second meaning; a third bearer of the one accent is the same
 * meaning said in one more place.
 *
 * IT IS A SECOND TABLE AND NOT A SECOND AXIS. Hue on this surface means one of two
 * things, and they may not meet: how bad the NEWS is, which is the call site's to say and
 * is {@link PAINTED_BY}; and *this is the product*, which is the accent and belongs to
 * the thing that says nothing about the record at all ({@link ACCENT}). A part that
 * carries news is painted by the news — the severity is read first below — and nothing
 * that takes the accent can carry one: an echo is what a caller sent, and a console
 * cannot have an opinion about it.
 *
 * THE DOC ABOVE {@link PAINTED_BY} SAID HUE WAS *the whole use of hue on this surface*,
 * and this is what falsified it. It was true while every hue this file wrote was a
 * severity; the accent was spent by the LAYOUT, in the layout's own vocabulary, on things
 * a renderer never saw. The echo is the first line of the page that is chrome and a LINE
 * at once — it is composed and rendered like everything else, which is what makes a caller
 * who asked for no colour get none of this either — so the accent had to become sayable
 * here. What did not move is the count: one accent, none of the three severities.
 */
const TINTED_BY: { readonly [R in Role]: string } = {
  label: '',
  subject: '',
  field: '',
  detail: '',
  clause: '',
  id: '',
  when: '',
  scope: '',
  state: '',
  prompt: ACCENT,
  typed: '',
  pick: ACCENT,
  word: ACCENT,
};

/**
 * What each severity paints — the use of hue this surface was built around, and one of
 * the two it has ({@link TINTED_BY} is the other, and says what falsified the sentence
 * that used to end this line: *and it is the whole use of hue on this surface*).
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
 * in its hue — the severity's where it has one, and the role's own where it does not.
 *
 * THE NEWS WINS, and the order is the decision rather than an accident of the `??`. A
 * part that carries a severity is reporting something a reader has to act on, and a part
 * that carries the accent is saying which product they are looking at; if one part could
 * ever be both, the news is the half that may not be overwritten. Nothing produces such a
 * part today — the accent's one role is the echo's prompt, and no call site gives it a
 * severity — so this line states an order rather than resolving a collision.
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
  const hue = part.severity === undefined ? TINTED_BY[part.role] : PAINTED_BY[part.severity];
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
