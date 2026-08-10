/**
 * HOW MUCH OF THE OPENING PANEL FITS — the arithmetic, and nothing about what it says.
 *
 * The console opens with the name drawn, and beside it what the session is, where it is
 * standing and what the record is. That is a drawing with a WIDTH, and a terminal too narrow
 * to hold the two side by side has to be given them one over the other. So there are three
 * forms, the widest one that fits is the one drawn, and this file is the measurement.
 *
 * ⚠️ THERE WAS A BOX AROUND ALL OF IT, and this file was the arithmetic of the box: a title
 * on its top border, two columns with a rule between them, and a border that cost two
 * columns on the sides and two rows at the ends. THE FRAME IS GONE, and it went for the
 * reason it was drawn for — the console it was measured against does not have one. Measured
 * on both openings: the reference spends FOUR rows of chrome and writes its name, its build
 * and its context in text beside its logo; this one spent TWELVE, of which two were the
 * border, one was the blank row the stacked arrangement needed and the rest was the same
 * content stacked instead of beside. What is left is NINE, and nine is the height of the
 * drawing of the name — so the chrome now costs the mark and nothing else.
 *
 * ⚠️ THE RIGHT-HAND SIDE HELD TWO SECTIONS AND HOLDS ONE. The second was `Hints`, and what
 * it said was that a word lists the verbs — which the row under the prompt says too, out of
 * the palette a slash opens, in a place that never scrolls away. Two sentences about one
 * session is a thing this bench has paid for; the one that survives is the one a caller can
 * still see after ten reads.
 *
 * ⚠️ HOW WIDE THE BOX WAS DRAWN USED TO BE THE OTHER QUESTION HERE, and it was answered with
 * the width of the TERMINAL — corner to corner, the way the reference did it before it stopped
 * drawing a frame at all. That question has no subject any more: nothing this file measures is
 * drawn to an edge, so the only width question left is the one that was always the content's,
 * which is which of the three arrangements it has room for. What the frame's departure cost the
 * arithmetic is written where each constant was ({@link BETWEEN_COLUMNS}).
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
 *   - `columns` — the mark on the left, and beside it what the session is, where it is
 *     standing and what the record is. What the reference shows.
 *   - `stacked` — the same groups, one under the other. What a terminal too narrow to
 *     put the text beside the mark can still hold.
 *   - `bare` — the same lines, in the same order, landed the way every other line of this
 *     session lands, which is what it printed before there was a panel at all.
 *
 * ⚠️ THE FIRST TWO WERE `the box` AND `the box, one column`, and the third was `no box`. The
 * frame is gone from all three, so what tells them apart is the ARRANGEMENT alone: whether
 * the text is beside the mark or under it, and whether the whole of it was measured to fit
 * across this terminal — which is what `bare` says it was not, and why its lines are landed
 * where a line the terminal may FOLD belongs ({@link openingFor}).
 */
export type PanelForm = 'columns' | 'stacked' | 'bare';

/** What the panel is made of, as lines, before anything decides how much fits. */
export interface PanelRequest {
  /** How wide the terminal is, asked of the DEVICE by whoever opens the session. */
  readonly columns: number;
  /** How a line becomes bytes, resolved once for the whole session. */
  readonly render: Render;
  /** What the session is: the product, the build, and what a caller is looking at. */
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
   * What the session is — the first of the three rows that go beside the mark.
   *
   * ⚠️ IT WAS ON THE BOX'S TOP BORDER, and it is a row like the two under it now. It was
   * never a different string: what changed is where it lands, which is what took the box's
   * own width out of this file altogether.
   */
  readonly title: string;
  /** The mark. The one group the layout paints, because it is chrome. */
  readonly mark: readonly string[];
  /** Where the session is standing. */
  readonly standing: readonly string[];
  /** The record's section: its heading and its lines. */
  readonly record: readonly string[];
}

/**
 * THE GAP BETWEEN THE MARK AND THE TEXT BESIDE IT, in columns — the one measurement of the
 * arrangement that is not a length of something.
 *
 * ⚠️ IT WAS FIVE COLUMNS IN THREE CONSTANTS: two before the rule that divided the columns,
 * the rule's own column, and two after it. The rule is gone, so what is left of the five is
 * the four the drawing already spent on either side of it — a subtraction rather than a
 * number somebody picked. It is ONE constant rather than two of the same value, for the
 * reason the layout gives about the same shape of decision (`region.ts`, `IN_THE_MIDDLE`):
 * how far apart two columns sit is one decision, and the two halves of it were only ever
 * two because there was something between them.
 *
 * ⚠️ AND THREE OTHERS WENT WITH THE FRAME. `BORDER` was the two columns the border took,
 * `INSIDE` the two between the border and its content, and `AROUND_TITLE` the five the title
 * cost on the top edge — a stub of border, a space on each side, and the corner after it. That
 * last one was a FLOOR on both forms, because a box narrower than its own title is a box whose
 * name does not fit on it; the title is inside the arrangement now, so its width is measured
 * with the two rows it sits above and floors nothing of its own.
 *
 * EXPORTED, AND READ BY THE DRAWING. ⚠️ THE COLUMN COSTS USED TO BE COPIED — this file said so,
 * in as many words: *two copies of these numbers is two panels, one of which fits* — and the
 * copy was the justification rather than the mechanism. One constant with two readers is what
 * the rule this bench states everywhere else asks for, and the drawing imports it
 * (`region.ts`).
 */
export const BETWEEN_COLUMNS = 4;

/**
 * The title, which is ONE row wherever it goes: beside the mark, or over it.
 *
 * ⚠️ IT WAS `TITLE_ROW` AND IT MEANT THE BOX'S TOP EDGE — the row the title was laid on,
 * which the frame would have drawn whether there was a title or not. It is renamed because it
 * is a different row: the frame is gone, so this is the title's own row and it exists because
 * the title does.
 *
 * ⚠️ AND `UNDER_THE_BOX` WENT WITH THE FRAME. It was the bottom edge, one row under everything
 * inside; there is nothing to close, so it is one of the three rows the chrome no longer costs.
 */
const THE_TITLE = 1;

/**
 * The blank row over the record's section — what separates it from the group above it.
 *
 * ⚠️ IT WAS THE STACKED FORM'S ALONE, on a premise this delivery falsified: *there is no such
 * row in the two-column form, where nothing precedes the section*. That was true while the
 * right-hand column held the record and nothing else. The title and the place are in it now,
 * so something precedes the section in BOTH forms — and a section that started on the next row
 * would read as part of the group before it either way.
 *
 * It is counted even when the section is empty, because the drawing spends it either way: the
 * row is a margin on the section's own box, and a box with nothing in it still has its margin.
 *
 * EXPORTED for the reason {@link BETWEEN_COLUMNS} is: the arithmetic and the drawing have to
 * agree about it, and one constant with two readers is how that is made true rather than
 * promised.
 */
export const BETWEEN_SECTIONS = 1;

/**
 * WHAT THE PAGE OPENS WITH on a terminal of a given width: the arrangement, or the absence
 * of one and the same lines instead.
 *
 * The two halves travel together because they are one answer to one question, and the
 * answer changes with the width: a terminal too narrow for an arrangement gets none and gets
 * {@link panelLines} landed like any other line, so a width that crosses that threshold
 * moves the drawing from one half of this value to the other. Whoever asked for it at one
 * width and asked again at another has to be handed both, or the second answer would be a
 * drawing the console still had to work out where to put.
 *
 * `lines` is not only the panel's. It is everything the page opens with — the session adds
 * the sentence that says what it refuses — which is why this file composes none of it and
 * only says what the shape is.
 */
export interface Opening {
  /** The arrangement, or none when the terminal is too narrow for one. */
  readonly panel: Panel | undefined;
  /** What is landed as the page opens, already bytes, in reading order. */
  readonly lines: readonly string[];
  /**
   * HOW MANY ROWS OF THIS TERMINAL the whole of it takes — folds counted.
   *
   * It is here rather than worked out by whoever wants it because the two things it is
   * made of are here: how many rows the arrangement takes, and how wide each line that
   * lands under it is. A caller counting the lines would be counting a value the
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
 * be drawn what is drawn? A window dragged from forty rows to ten changes no glyph; one
 * dragged to four changes the mark, and that is a page.
 *
 * ⚠️ AND IT ONLY STARTED ANSWERING THAT QUESTION WHEN THE FRAME WENT. The panel carried the
 * terminal's own width as a field, because the box was drawn corner to corner and every
 * column of the window was a column of the drawing — so this comparison said "not the same"
 * for every width there is, and the sentence above was a rule the value could not keep.
 * Nothing is drawn to an edge now, so a window one column narrower really is the same page,
 * and a WIDTH reaches this comparison only through the two things it can still move: which
 * arrangement there is room for, and how many rows the sentence under it folds into
 * ({@link openingFor}).
 *
 * ⚠️ AND IT IS NO LONGER THE WHOLE QUESTION A CALLER ASKS. This said that a height changing
 * no glyph *costs the caller nothing*, and the delivery that put the input at the FOOT of the
 * terminal falsified it: a page is now a drawing AND a placement, and the rows before the
 * opening are how many the height leaves over (`repl/page.ts`). What is here is still the
 * drawing, whole and unchanged — a panel that has no idea how tall a device is could not
 * answer the other half — and the console asks both
 * (`repl/console.ts`, `placedAt`; `tests/the-page-follows-the-terminal.test.ts`).
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

/**
 * How many rows the text beside the mark takes: what the session is, where it is standing,
 * and the record's section under a blank row.
 *
 * ONE FUNCTION FOR BOTH FORMS, because it is the same three groups in both — what differs is
 * whether they sit beside the mark or under it, which is {@link panelRows}' one branch.
 */
function besideTheMark(panel: Panel): number {
  return THE_TITLE + panel.standing.length + BETWEEN_SECTIONS + panel.record.length;
}

/**
 * How many rows the arrangement takes: the mark, and the text either beside it or under it.
 *
 * ⚠️ IT WAS `boxRows` AND IT COUNTED THE FRAME — a row for the title's border, a row for the
 * bottom edge, and the taller of the mark-and-place against the record in between. It is
 * renamed because it counts a different thing: there are no edges, and the title is a row of
 * the text rather than a row of a border. Measured at a hundred and twenty by forty, on the
 * fixture this surface is tested over: twelve rows, of which nine survive.
 *
 * NOTHING IN AN ARRANGEMENT FOLDS, and that is by construction rather than by luck: the form
 * was chosen because its content fits across this terminal, the gap between the columns
 * counted ({@link panelFor}), so every row in here is one row. The lines of a `bare` opening
 * had no such choice made for them, which is why they are counted differently below.
 */
function panelRows(panel: Panel): number {
  return panel.form === 'columns'
    ? Math.max(panel.mark.length, besideTheMark(panel))
    : panel.mark.length + besideTheMark(panel);
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
  // A terminal too narrow for an arrangement gets none, and the same lines land instead —
  // which is why the layout has two forms and not three.
  const bare = panel.form === 'bare';
  const landed: readonly Line[] = bare
    ? [...request.mark, request.title, ...request.standing, ...request.record, ...request.beneath]
    : request.beneath;
  return {
    panel: bare ? undefined : panel,
    lines: [...(bare ? panelLines(panel) : []), ...request.beneath.map(request.render)],
    rows: (bare ? 0 : panelRows(panel)) + foldedRows(landed, request.columns),
  };
}

/**
 * Every line of the panel, in reading order — what a terminal with no room for an
 * arrangement gets.
 *
 * The `bare` form is not a third drawing: it is the SAME lines, landed the way every
 * other line of this session lands, which is what the console printed before there was a
 * panel at all. So the order lives here, once, and the two arranged forms are the only place
 * anything is placed.
 *
 * ⚠️ THE TITLE USED TO COME FIRST, and the frame is what put it there: it was on the box's top
 * border, which is above everything by construction. It is the first row BESIDE the mark now,
 * so the reading order of the arrangement is the mark and then the text — and this is that
 * order rather than a second one, which is what keeps a terminal that lost the arrangement
 * from reading in a different sequence than one that has it.
 */
export function panelLines(panel: Panel): readonly string[] {
  return [...panel.mark, panel.title, ...panel.standing, ...panel.record];
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
 *
 * ⚠️ AND THE FRAME THAT FALSIFIED IT IS GONE, WHICH DOES NOT PUT THE OLD SENTENCE BACK. It
 * is asked again on every settled resize, exactly as it is above, because the FORM is a
 * function of the width and a terminal that narrowed past the threshold has the wrong one on
 * its screen. What changed is only how OFTEN the answer differs: nothing is drawn to an edge,
 * so a window one column narrower is the same arrangement and the console draws nothing at all
 * ({@link sameOpening}).
 */
export function panelFor(request: PanelRequest): Panel {
  const { columns, render, title, mark, standing, record } = request;
  const left = widest(mark);
  // WHAT THE SESSION IS, WHERE IT IS STANDING AND WHAT THE RECORD IS are one column: three
  // groups of rows, so the column is as wide as the widest row of the three. ⚠️ THE PLACE USED
  // TO BE ON THE LEFT, under the mark, and the title on the border above both — so this was the
  // record's width alone and the border's own cost was added to it.
  const right = Math.max(widthOf(title), widest(standing), widest(record));
  const sideBySide = left + BETWEEN_COLUMNS + right;
  const oneOverTheOther = Math.max(left, right);
  const form: PanelForm =
    sideBySide <= columns ? 'columns' : oneOverTheOther <= columns ? 'stacked' : 'bare';
  return {
    form,
    title: render(title),
    mark: mark.map(render),
    standing: standing.map(render),
    record: record.map(render),
  };
}
