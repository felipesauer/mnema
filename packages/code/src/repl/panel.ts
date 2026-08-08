/**
 * HOW MUCH OF THE OPENING PANEL FITS — the arithmetic, and nothing about what it says.
 *
 * The console opens with a box: a title on its top border, the name drawn on the left
 * with the project under it, and on the right what the record is. That is a drawing with a
 * WIDTH, and a terminal narrower than it would fold the box into nonsense — a border
 * wrapped mid-row is worse than no border at all. So there are three forms, the widest one
 * that fits is the one drawn, and this file is the measurement.
 *
 * ⚠️ THE RIGHT-HAND SIDE HELD TWO SECTIONS AND HOLDS ONE. The second was `Hints`, and what
 * it said was that a word lists the verbs — which the row under the prompt says too, out of
 * the palette a slash opens, in a place that never scrolls away. Two sentences about one
 * session is a thing this bench has paid for; the one that survives is the one a caller can
 * still see after ten reads.
 *
 * HOW WIDE THE BOX IS DRAWN AND WHICH DRAWING FITS ARE TWO QUESTIONS, and only the second
 * one is here. The box is drawn at the width of the TERMINAL — corner to corner, the way
 * the reference does it (measured: its corner lands on column 120 of 120) — and what this
 * file answers is which of the three arrangements the CONTENT has room for. The box used
 * to be as wide as what was inside it, which left a frame ending in the middle of the
 * screen and a ragged right edge under it; the arithmetic that chose the form did not
 * change when that did, because it never was about how much of the screen to take.
 *
 * THE THRESHOLD IS THE CONTENT'S OWN WIDTH, never a number somebody chose. It is the
 * rule the banner already works by (`presentation/banner.ts`): a form gives way when it
 * stops fitting, so the day a project's path gets longer or a verdict is reworded, the
 * panel degrades at the width that actually stopped working rather than at a constant
 * that drifted away from it. A number here would be a second opinion about how wide the
 * drawing is, and the drawing is the one that is right.
 *
 * IT MEASURES THE LINE AND DRAWS THE RENDERED ONE, and that is deliberate: a painted line
 * is longer in bytes and exactly as wide on a screen, so measuring the bytes would make
 * the panel degrade for having colour switched on. How wide a line is is asked of
 * `presentation/` (`widthOf`) rather than worked out here — nothing outside the wiring may
 * name a renderer, and a module that counted a line's characters its own way would be a
 * second opinion about how a line is punctuated.
 *
 * NOTHING HERE COMPOSES A LINE. What it receives is already lines — the same primitives
 * every other reading of this product is made of — and what it hands back is those lines
 * as bytes, grouped. The composing is the session's (`session.ts`), the placing is the
 * layout's (`region.ts`), and this is only the question of how much room there is.
 */

import { rowsAt } from '../presentation/folded.js';
import type { Line } from '../presentation/line.js';
import { widthOf } from '../presentation/plain.js';
import type { Render } from '../presentation/render.js';

/**
 * The three forms, widest first — the same shape of choice the banner makes.
 *
 *   - `columns` — the box, with the mark and where the session is standing on the left,
 *     a rule, and the record on the right. What the reference showed.
 *   - `stacked` — the box, one column: the same groups, one under the other. What a
 *     terminal too narrow for two columns can still hold.
 *   - `bare` — no box. The same lines, in the same order, at the left edge, which is
 *     what this session printed before there was a panel at all.
 */
export type PanelForm = 'columns' | 'stacked' | 'bare';

/** What the panel is made of, as lines, before anything decides how much fits. */
export interface PanelRequest {
  /** How wide the terminal is, asked of the DEVICE by whoever opens the session. */
  readonly columns: number;
  /** How a line becomes bytes, resolved once for the whole session. */
  readonly render: Render;
  /** What the box is called, on its top border. */
  readonly title: Line;
  /** The name, drawn. */
  readonly mark: readonly Line[];
  /** Where the session is standing. Empty when it knows neither fact. */
  readonly standing: readonly Line[];
  /** What the record is: a heading, then one line per tree. Empty outside a project. */
  readonly record: readonly Line[];
}

/** The panel as the layout receives it: bytes, grouped, and the form they go in. */
export interface Panel {
  /** Which drawing this terminal has room for. */
  readonly form: PanelForm;
  /**
   * How wide the terminal is, and therefore how wide the box is DRAWN.
   *
   * It used to be how wide the drawing came out, which is a different number and was
   * the one the form was chosen by. The field was not redefined, it was replaced: a name
   * that keeps its spelling and changes its meaning leaves whoever read it as a means
   * looking at something else, and the case that used the old one is red and named
   * rather than quietly wrong.
   */
  readonly columns: number;
  /** The title, on the border in a boxed form and on a line of its own in `bare`. */
  readonly title: string;
  /** The mark. The one group the layout paints, because it is chrome. */
  readonly mark: readonly string[];
  /** Where the session is standing, under the mark. */
  readonly standing: readonly string[];
  /** The record's section: its heading and its lines. */
  readonly record: readonly string[];
}

/**
 * How much a box costs around what is in it, in columns. Each is a fact about the
 * drawing in `region.ts`, and they are HERE because the choice of form and the drawing
 * have to agree about the geometry — two copies of these numbers is two panels, one of
 * which fits.
 */
/** The border, one column on each side. */
const BORDER = 2;
/** The gap between the border and what is inside it, both sides. */
const INSIDE = 2;
/** The gap after the left column, before the rule. */
const BETWEEN = 2;
/**
 * The rule between the two columns.
 *
 * The one this arithmetic still counts. ⚠️ THERE WAS A SECOND RULE, drawn INSIDE the
 * right-hand column between its two sections, and this file never counted it — it cost no
 * columns, because it was a box with nothing in it. It went with the section it divided.
 */
const DIVIDER = 1;
/** The gap after the rule, before the right column. */
const BESIDE = 2;
/**
 * What the title costs beyond its own width: the stub of border before it, a space on
 * each side of it, and the corner after it.
 */
const AROUND_TITLE = 5;

/**
 * How much a box costs around what is in it, in ROWS. The counterparts of the columns
 * above, here for the identical reason and now that something asks: {@link openingRows} and
 * the drawing in `region.ts` have to agree about the geometry, and two copies of these
 * numbers is two panels, one of which fits.
 */
/** The row the title sits on, which is the box's top edge. */
const TITLE_ROW = 1;
/** The box's bottom edge, under everything inside it. */
const UNDER_THE_BOX = 1;
/**
 * The blank row over the record's section in the STACKED form — what separates it from the
 * group above it, which is the name and the place.
 *
 * There is no such row in the two-column form, where nothing precedes the section. It is
 * counted even when the section is empty, because the drawing spends it either way: the row
 * is a margin on the section's own box, and a box with nothing in it still has its margin.
 */
const BETWEEN_SECTIONS = 1;

/**
 * WHAT THE PAGE OPENS WITH on a terminal of a given width: the box, or the absence of one
 * and the same lines instead.
 *
 * The two halves travel together because they are one answer to one question, and the
 * answer changes with the width: a terminal too narrow for a box gets none and gets
 * {@link panelLines} landed like any other line, so a width that crosses that threshold
 * moves the drawing from one half of this value to the other. Whoever asked for it at one
 * width and asked again at another has to be handed both, or the second answer would be a
 * box the console still had to work out where to put.
 *
 * `lines` is not only the panel's. It is everything the page opens with — the session adds
 * the sentence that says what it refuses — which is why this file composes none of it and
 * only says what the shape is.
 */
export interface Opening {
  /** The box, or none when the terminal is too narrow for one. */
  readonly panel: Panel | undefined;
  /** What is landed as the page opens, already bytes, in reading order. */
  readonly lines: readonly string[];
  /**
   * HOW MANY ROWS OF THIS TERMINAL the whole of it takes — folds counted.
   *
   * It is here rather than worked out by whoever wants it because the two things it is
   * made of are here: what the box costs around its content, and how wide each line that
   * lands under the box is. A caller counting the lines would be counting a value the
   * terminal is about to fold, which is the arithmetic this field exists to stop
   * ({@link openingFor}).
   */
  readonly rows: number;
}

/**
 * Whether two openings are the same drawing — asked by whoever has one on the screen and
 * has just composed another.
 *
 * IT EXISTS BECAUSE THE SIZE STOPPED BEING THE QUESTION. The console used to know a page
 * was stale by comparing the WIDTH it was drawn for against the width the terminal has,
 * on the premise that nothing else could move a glyph of it. The name gives way by HEIGHT
 * now (`presentation/banner.ts`), so the premise is gone — and the answer that replaces it
 * is not "either measurement moved" but the one that was always underneath: is what would
 * be drawn what is drawn? A window dragged from forty rows to ten changes no glyph and
 * costs the caller nothing; one dragged to four changes the mark, and that is a page.
 *
 * COMPARED AS A WHOLE rather than field by field, and that is the point of it being here
 * rather than at the call site: a field added to the panel tomorrow is a field this
 * comparison cannot forget, which is the shape of defect a hand-written list of fields
 * produces. Both values come out of {@link panelFor} and {@link Opening}, so the keys are
 * in the same order and the comparison is over the same shape twice.
 *
 * It is cheap by construction: an opening is the dozen or so lines the box holds, already
 * bytes, and it is asked once per settled resize rather than per frame.
 */
export function sameOpening(one: Opening, other: Opening): boolean {
  return JSON.stringify(one) === JSON.stringify(other);
}

/** How many rows the box costs around what is in it: its two edges, and the arrangement. */
function boxRows(panel: Panel): number {
  const withTheMark = panel.mark.length + panel.standing.length;
  // NOTHING INSIDE A BOX FOLDS, and that is by construction rather than by luck: the form
  // was chosen because its content fits across this terminal, title and gaps counted
  // ({@link panelFor}), so every row in here is one row. The lines that land UNDER the box
  // had no such choice made for them, which is why they are counted differently below.
  const inside =
    panel.form === 'columns'
      ? Math.max(withTheMark, panel.record.length)
      : withTheMark + BETWEEN_SECTIONS + panel.record.length;
  return TITLE_ROW + inside + UNDER_THE_BOX;
}

/**
 * How many rows of a terminal `columns` wide some lines take — one each, and more for
 * every one that FOLDS.
 *
 * ⚠️ THIS IS THE HALF THE FIRST ARITHMETIC HERE DID NOT HAVE, and a real screen is what
 * found it: at sixty columns the sentence under the box is seventy-six columns long, so it
 * is two rows, and a page counted as though it were one opened with its own top already in
 * the scrollback. It is the rule the input area has had since it learnt about width — a row
 * the terminal would fold is not one row (`area.ts`) — asked of the lines the box does not
 * cover.
 *
 * ⚠️ AND IT DID THE ARITHMETIC ITSELF, which is what the renderer that folds falsified. It
 * read `ceil(widthOf(line) / columns)` — the terminal's own rule, fill and break at the
 * margin — and a product that folds between words with a hanging indent does not break
 * there: a continuation holds fewer characters than the first row, so a line can take one
 * row more than the division says. Measured on a real pseudo-terminal, one row was exactly
 * what it cost. So the count ASKS the fold now (`presentation/folded.ts`, `rowsAt`) rather
 * than predicting it, which is the same rule read once instead of twice.
 *
 * A width nobody reported folds nothing: it is not a width to guess at, and what it chooses
 * is a page that cannot fit anyway.
 */
function foldedRows(lines: readonly Line[], columns: number): number {
  if (columns <= 0) return lines.length;
  return lines.reduce((rows, line) => rows + rowsAt(line, columns), 0);
}

/** Everything the page opens with, as lines, before anything decides how much fits. */
export interface OpeningRequest extends PanelRequest {
  /**
   * What the session lands UNDER the box — the sentence saying what it refuses.
   *
   * It arrives as lines rather than as bytes because two things are asked of it: how it
   * READS, which the renderer answers, and how WIDE it is, which decides whether the
   * terminal folds it into a row nothing counted.
   */
  readonly beneath: readonly Line[];
}

/**
 * WHAT THE PAGE OPENS WITH on a terminal of a given width, and how many rows of it that
 * takes.
 *
 * THE TWO HALVES ARE ONE ANSWER, which is why they are composed together rather than by a
 * caller holding a box in one hand and a count in the other. Whether there is a box, what is
 * landed instead when there is not, and what the whole of it costs are three readings of one
 * arrangement, and a second place that worked out the third would be the count and the
 * drawing coming apart — which is exactly the defect this file's column costs were pulled
 * together to prevent.
 *
 * IT IS CALLED PER CANDIDATE DRAWING and that is the point of it being cheap. The name gives
 * way when the PAGE stops fitting rather than when the drawing does (`presentation/banner.ts`
 * says why), so each drawing is composed, measured and either kept or dropped. Composing is
 * a render of a dozen lines and no read of anything.
 */
export function openingFor(request: OpeningRequest): Opening {
  const panel = panelFor(request);
  // A terminal too narrow for a box gets no box, and the same lines land instead — which is
  // why the layout has two forms and not three.
  const bare = panel.form === 'bare';
  const landed: readonly Line[] = bare
    ? [request.title, ...request.mark, ...request.standing, ...request.record, ...request.beneath]
    : request.beneath;
  return {
    panel: bare ? undefined : panel,
    lines: [...(bare ? panelLines(panel) : []), ...request.beneath.map(request.render)],
    rows: (bare ? 0 : boxRows(panel)) + foldedRows(landed, request.columns),
  };
}

/**
 * Every line of the panel, in reading order — what a terminal with no room for a box
 * gets.
 *
 * The `bare` form is not a third drawing: it is the SAME lines, landed the way every
 * other line of this session lands, which is what the console printed before there was a
 * panel at all. So the order lives here, once, and the two boxed forms are the only place
 * anything is arranged.
 */
export function panelLines(panel: Panel): readonly string[] {
  return [panel.title, ...panel.mark, ...panel.standing, ...panel.record];
}

/** How wide the widest of some lines is, and zero when there are none. */
function widest(lines: readonly Line[]): number {
  return lines.reduce((most, line) => Math.max(most, widthOf(line)), 0);
}

/**
 * The panel for a terminal `columns` wide: the widest form that fits, and its lines as
 * bytes.
 *
 * `columns` is asked of the DEVICE by whoever opens the session and handed in, for the
 * reason the banner gives: nothing that composes a line may look at a terminal, and this
 * does not compose one.
 *
 * THIS USED TO SAY IT WAS ANSWERED ONCE, when the session opened, and that "a panel that
 * redrew itself narrower on a resize would be rewriting what the caller can scroll back
 * to". What falsified it is the box taking the width of the TERMINAL: while the drawing
 * was as wide as its own content, a terminal that shrank to eighty columns still had room
 * for it, and not redrawing cost nothing. Corner to corner, a session opened at a hundred
 * and twenty columns and shrunk to seventy is eight rows the terminal folds in half —
 * not-redrawing became the broken drawing. So the answer is asked again whenever the width
 * changes, and what the old sentence was protecting is protected by something else: the
 * page is carried into the scrollback before the new one is drawn, so nothing the caller
 * could scroll back to is rewritten, and this function is CALLED again rather than being a
 * value somebody mutated. It is still pure, it still reads nothing, and the record behind
 * `record` is still the one the session paid for when it opened
 * (`tests/the-page-follows-the-terminal.test.ts`, and the read counter in
 * `tests/the-name-and-the-hints.test.ts`).
 */
export function panelFor(request: PanelRequest): Panel {
  const { columns, render, title, mark, standing, record } = request;
  const left = Math.max(widest(mark), widest(standing));
  const right = widest(record);
  // The top border carries the title, so a box narrower than the title is a box whose
  // own name does not fit on it — which is a width the content alone cannot see.
  const titled = widthOf(title) + AROUND_TITLE;
  const sideBySide = Math.max(BORDER + INSIDE + left + BETWEEN + DIVIDER + BESIDE + right, titled);
  const oneOverTheOther = Math.max(BORDER + INSIDE + Math.max(left, right), titled);
  const form: PanelForm =
    sideBySide <= columns ? 'columns' : oneOverTheOther <= columns ? 'stacked' : 'bare';
  return {
    form,
    columns,
    title: render(title),
    mark: mark.map(render),
    standing: standing.map(render),
    record: record.map(render),
  };
}
