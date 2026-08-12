/**
 * HOW MUCH OF THE OPENING PANEL FITS — the arithmetic, and nothing about what it says.
 *
 * The console opens with the name drawn, and beside it what the session is, where it is
 * standing and what the record is. That is a drawing with a WIDTH, and a terminal too narrow
 * to hold the two side by side has to be given them one over the other. So there are three
 * forms, the richest one that fits is the one drawn, and this file is the measurement.
 *
 * AND IT FITS ON TWO MEASUREMENTS, WHERE IT USED TO FIT ON ONE. Every sentence in this file
 * asked how WIDE a form was and none of them asked how TALL, and what falsified that is the
 * arrangement being FIXED: it is drawn at the top of every frame and never scrolls, so its rows
 * are rows the session's answers can never have. Measured on the fixture this surface is tested
 * over, at eighty by twenty-four: the arrangement spent FIFTEEN of the twenty-four rows, the
 * input area five, and the reader was left four — so a caller who asked what the session runs
 * was shown the last four rows of the answer and none of the verbs. What the height buys the
 * chooser is one more way for a form to not fit ({@link panelFor}), and the degradation that was
 * already there does the rest.
 *
 * THERE WAS A BOX AROUND ALL OF IT, and this file was the arithmetic of the box: a title
 * on its top border, two columns with a rule between them, and a border that cost two
 * columns on the sides and two rows at the ends. THE FRAME IS GONE, and it went for the
 * reason it was drawn for — the console it was measured against does not have one. Measured
 * on both openings: the reference spends FOUR rows of chrome and writes its name, its build
 * and its context in text beside its logo; this one spent TWELVE, of which two were the
 * border, one was the blank row the stacked arrangement needed and the rest was the same
 * content stacked instead of beside. What is left is NINE, and nine is the height of the
 * drawing of the name — so the chrome now costs the mark and nothing else.
 *
 * THE RIGHT-HAND SIDE HELD TWO SECTIONS AND HOLDS ONE. The second was `Hints`, and what
 * it said was that a word lists the verbs — which the row under the prompt says too, out of
 * the palette a slash opens, in a place that never scrolls away. Two sentences about one
 * session is a thing this bench has paid for; the one that survives is the one a caller can
 * still see after ten reads.
 *
 * HOW WIDE THE BOX WAS DRAWN USED TO BE THE OTHER QUESTION HERE, and it was answered with
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
 * THE FIRST TWO WERE `the box` AND `the box, one column`, and the third was `no box`. The
 * frame is gone from all three, so what tells them apart is the ARRANGEMENT alone: whether
 * the text is beside the mark or under it, and whether the whole of it was measured to fit
 * across this terminal — which is what `bare` says it was not, and why its lines are landed
 * where a line the terminal may FOLD belongs ({@link openingFor}).
 *
 * AND `bare` IS WHAT A SCREEN TOO SHORT FOR AN ARRANGEMENT GETS TOO, which is the second
 * reason it can be reached and not a second form. The two questions are *does it fit across*
 * and *does it fit inside its share of the way down* ({@link panelFor}); the answer to either
 * being no drops one rung, and the rung under the last one is the same lines on the roll.
 *
 * AND THE SHORT SCREEN IS NO LONGER ONE OF THE TWO WAYS THERE. A floor under the window
 * (`floor.ts`) means no page is laid out under twenty-four rows, and the cheapest arrangement
 * costs six — one row of drawing and the five the text beside it takes — which wants eighteen. So
 * `bare` is reached ACROSS: a window narrower than the widest row the arrangement holds, and the
 * widest is usually the one that says where the session is standing, which is a path. The rule
 * did not move and neither did this ladder; what moved is which of the two questions a device can
 * still answer no to.
 */
export type PanelForm = 'columns' | 'stacked' | 'bare';

/**
 * The three forms, richest first — the order the choice below walks.
 *
 * IT IS A LIST RATHER THAN A CHAIN OF CONDITIONS, and the reason is the shape the banner
 * already answers in (`presentation/banner.ts`, `FORMS`): the ladder is walked, the first rung
 * that fits is the answer, and the last rung is the floor that fits whatever the size. Written
 * as nested ternaries — which is what this was — a third question about a form is a third
 * branch in an expression that already had two, and the two measurements would be asked in
 * different places.
 */
const THE_FORMS: readonly PanelForm[] = ['columns', 'stacked', 'bare'];

/**
 * HOW MUCH OF THE SCREEN THE CHROME MAY TAKE, as a divisor: one part in three.
 *
 * IT IS A NUMBER SOMEBODY CHOSE, which every other threshold on this surface refuses to be —
 * so it is chosen out loud rather than quietly. The other thresholds can be the content's own
 * measurement because what they rule on is whether something is DRAWN whole or folded; this
 * one rules on how much of a caller's screen a thing that says nothing about the record may
 * hold, and there is no measurement of the drawing that answers that. What the three is
 * defensible by:
 *
 *   - WHAT THIS PANEL WAS MEASURED AGAINST spends FOUR rows of chrome and writes its name, its
 *     build and its context in text beside its logo ({@link BETWEEN_COLUMNS} has the rest of
 *     that measurement). Four of twenty-four is one row under a sixth; a third is twice as
 *     generous as the reference and still a bound.
 *   - ON THE SCREEN EVERYBODY HAS, twenty-four rows, a third is eight and the input area takes
 *     about five — so what is left for the answer a caller asked for is around eleven rows
 *     rather than four.
 *   - AND THE PEOPLE WHO LIVE IN TWENTY-FOUR ROWS are the ones in a tmux pane, an editor's
 *     embedded terminal or an ssh session, which is not a degenerate size to be tolerated but
 *     the ordinary one.
 */
const A_THIRD = 3;

/**
 * THE SHORTEST SCREEN AN ARRANGEMENT OF THIS MANY ROWS MAY BE DRAWN ON — the share, read from
 * the other end.
 *
 * IT IS EXPORTED BECAUSE THE CHOICE OF THE DRAWING NEEDS IT, and that is the A3 shape rather
 * than a convenience. The name gives way when the page it is on stops working
 * (`presentation/banner.ts`), and what "stops working" means is now partly this rule: a drawing
 * so tall that the arrangement around it would bust its share is a drawing that costs the
 * ARRANGEMENT, which is the one thing the opening exists to keep. The composer asks that
 * question with this function (`session.ts`), so there is one statement of the share with two
 * readers rather than a number copied into the question.
 *
 * THE SHARE IS SPELLED AGAINST THE SCREEN rather than as a number of rows worked out first,
 * and that is deliberate: `chrome * 3 <= rows` and `chrome <= ⌊rows / 3⌋` are the same
 * statement about whole rows, and only the first says what it is measured against in the
 * expression that decides. A rounded number computed above and compared below is a threshold
 * one edit away from being a constant nobody can trace back to a screen.
 */
export function theShortestScreenFor(chrome: number): number {
  return chrome * A_THIRD;
}

/**
 * Whether an arrangement of a given height is inside its share of a screen this tall.
 *
 * A DEVICE THAT REPORTED NO HEIGHT keeps only the form that costs nothing, for the reason the
 * width gives about the same silence: a height nobody reported is not a height to guess at,
 * and a fixed region drawn against a guess is the one thing that cannot be scrolled back to.
 */
function withinItsShare(chrome: number, rows: number): boolean {
  return theShortestScreenFor(chrome) <= rows;
}

/** What the panel is made of, as lines, before anything decides how much fits. */
export interface PanelRequest {
  /** How wide the terminal is, asked of the DEVICE by whoever opens the session. */
  readonly columns: number;
  /**
   * HOW TALL IT IS, asked of the same device in the same reading — never in a second one.
   *
   * TWO NUMBERS TAKEN AT TWO INSTANTS ARE TWO TERMINALS, which is the rule the whole
   * geometry of this surface rests on and which the console learnt by measuring a frame that
   * came out twenty-four rows by a hundred and twenty when no terminal was ever that shape
   * (`console.ts`, `theSize`). So the pair arrives together, from the one place that asks the
   * device anything, exactly as it arrives at the drawing of the name (`presentation/
   * banner.ts`).
   */
  readonly rows: number;
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
   * IT WAS ON THE BOX'S TOP BORDER, and it is a row like the two under it now. It was
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
 * IT WAS FIVE COLUMNS IN THREE CONSTANTS: two before the rule that divided the columns,
 * the rule's own column, and two after it. The rule is gone, so what is left of the five is
 * the four the drawing already spent on either side of it — a subtraction rather than a
 * number somebody picked. It is ONE constant rather than two of the same value, for the
 * reason the layout gives about the same shape of decision (`region.ts`, `IN_THE_MIDDLE`):
 * how far apart two columns sit is one decision, and the two halves of it were only ever
 * two because there was something between them.
 *
 * AND THREE OTHERS WENT WITH THE FRAME. `BORDER` was the two columns the border took,
 * `INSIDE` the two between the border and its content, and `AROUND_TITLE` the five the title
 * cost on the top edge — a stub of border, a space on each side, and the corner after it. That
 * last one was a FLOOR on both forms, because a box narrower than its own title is a box whose
 * name does not fit on it; the title is inside the arrangement now, so its width is measured
 * with the two rows it sits above and floors nothing of its own.
 *
 * EXPORTED, AND READ BY THE DRAWING. THE COLUMN COSTS USED TO BE COPIED — this file said so,
 * in as many words: *two copies of these numbers is two panels, one of which fits* — and the
 * copy was the justification rather than the mechanism. One constant with two readers is what
 * the rule this bench states everywhere else asks for, and the drawing imports it
 * (`region.ts`).
 */
export const BETWEEN_COLUMNS = 4;

/**
 * The title, which is ONE row wherever it goes: beside the mark, or over it.
 *
 * IT WAS `TITLE_ROW` AND IT MEANT THE BOX'S TOP EDGE — the row the title was laid on,
 * which the frame would have drawn whether there was a title or not. It is renamed because it
 * is a different row: the frame is gone, so this is the title's own row and it exists because
 * the title does.
 *
 * AND `UNDER_THE_BOX` WENT WITH THE FRAME. It was the bottom edge, one row under everything
 * inside; there is nothing to close, so it is one of the three rows the chrome no longer costs.
 */
const THE_TITLE = 1;

/**
 * The blank row over the record's section — what separates it from the group above it.
 *
 * IT WAS THE STACKED FORM'S ALONE, on a premise this delivery falsified: *there is no such
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
   *
   * IT IS THE WHOLE OPENING AND NOT THE FIXED PART OF IT, which is what the drawing of the name
   * is chosen against: whether the page FITS is a question about all of it at once
   * (`session.ts`, `bannerFor`), whichever half of it is drawn where.
   */
  readonly rows: number;
  /**
   * HOW MANY ROWS THE FIXED TOP REGION TAKES — the arrangement, and nothing else.
   *
   * THE TWO HALVES OF AN OPENING GO TO TWO DIFFERENT PLACES, and this is the number that says
   * where the boundary is. The ARRANGEMENT is chrome: it is drawn at the top of the screen on
   * every frame and it never moves. The LINES are what the session SAYS, so they go on the roll
   * with everything else it says — which is also what makes the `bare` form what its own doc has
   * always claimed it is, *the same lines landed the way every other line of this session lands*,
   * rather than a third drawing.
   *
   * NOUGHT FOR A TERMINAL WITH NO ROOM FOR AN ARRANGEMENT, which is the case that forced the
   * split. A drawing that does not fit used to scroll away one row at a time and the reader kept
   * whatever was at the bottom of it; a fixed region that does not fit can only be CLIPPED, and
   * a clipped drawing loses the rows that say what the session is and what the record proved. On
   * the roll it loses nothing at all — the reader sees the end of it and scrolls back for the
   * rest.
   *
   * AND *NO ROOM* MEANT TOO NARROW, which is the premise this delivery took a second half
   * away from. A screen with the width for an arrangement and not the HEIGHT for it drew one
   * anyway, and it stayed drawn: fifteen rows of a twenty-four-row terminal, for ever, so the
   * answer to whatever the caller typed got four. The nought is now reached from either
   * measurement ({@link panelFor}), and what it means here did not move — everything that is not
   * a fixed region goes on the roll, and the roll can be scrolled.
   */
  readonly above: number;
}

/**
 * WHETHER TWO OPENINGS WERE THE SAME DRAWING used to be asked here, and nothing asks it any
 * more.
 *
 * IT EXISTED TO DECIDE WHETHER TO TURN A PAGE. The console lived in the caller's own buffer, so
 * changing what the opening looked like meant carrying a screen of theirs into their scrollback
 * and writing the new one over it — an expensive, visible, irreversible act — and this was the
 * one guard in front of it: is what would be drawn what is drawn? A window dragged from forty
 * rows to ten changes no glyph, and a page turned for it was a page turned for nothing.
 *
 * THERE ARE NO PAGES TO TURN. The opening is a REGION now, redrawn with the other two on every
 * frame at the size the device has at that instant (`console.ts`, `region.ts`), so a drawing
 * that did not change is a frame the layout library writes no bytes for — which is the same
 * saving, made by the library, without anybody comparing anything. What replaced the guard is a
 * cache on the COMPOSITION, keyed by the size it was composed at, and that answers a different
 * question: not *should the page turn* but *has this already been worked out*
 * (`console.ts`, `theOpening`).
 */

/**
 * How many rows the text beside the mark takes: what the session is, where it is standing,
 * and the record's section under a blank row.
 *
 * ONE FUNCTION FOR BOTH FORMS, because it is the same three groups in both — what differs is
 * whether they sit beside the mark or under it, which is {@link rowsOfTheForm}' one branch.
 *
 * IT TOOK A PANEL AND IT TAKES THE TWO COUNTS, and that is what let the height into the
 * choice at all: the form is what a {@link Panel} is built WITH, so a measurement that could
 * only be made once there was one could not be an input to choosing it. The counts are the same
 * numbers either way — a group's rows are its lines, whether they have been rendered yet or not.
 */
function besideTheMark(standing: number, record: number): number {
  return THE_TITLE + standing + BETWEEN_SECTIONS + record;
}

/**
 * HOW MANY ROWS OF THE SCREEN A FORM TAKES FOR EVER: the mark, and the text either beside it
 * or under it — and none at all for the one that is not an arrangement.
 *
 * THE ONE PLACE THIS IS ANSWERED, and both readers of it are what makes that worth saying:
 * the CHOICE asks it of a form it has not settled on yet ({@link panelFor}), and the page asks
 * it of the form that was settled on ({@link panelRows}). Two arithmetics would be an
 * arrangement chosen as though it cost one thing and budgeted against as though it cost
 * another, which is the same class of defect as the column costs this file already pulled
 * together ({@link BETWEEN_COLUMNS}).
 *
 * IT WAS `panelRows` AND IT BRANCHED ON A PANEL, and before that it was `boxRows` and it
 * counted a frame — a row for the title's border, a row for the bottom edge, and the taller of
 * the mark-and-place against the record in between. There are no edges, and the title is a row
 * of the text rather than a row of a border. Measured at a hundred and twenty by forty, on the
 * fixture this surface is tested over: twelve rows, of which nine survive.
 *
 * NOUGHT FOR `bare`, and it is the same nought {@link Opening.above} means rather than a second
 * one: the form is what a terminal with no room gets, its lines go on the roll, and a fixed
 * region it does not have costs no rows. It is answered here rather than by a caller's ternary
 * so that the ladder can be walked without a rung that has to be special-cased.
 *
 * NOTHING IN AN ARRANGEMENT FOLDS, and that is by construction rather than by luck: the form
 * was chosen because its content fits across this terminal, the gap between the columns
 * counted ({@link panelFor}), so every row in here is one row. The lines of a `bare` opening
 * had no such choice made for them, which is why they are counted differently below.
 */
function rowsOfTheForm(form: PanelForm, mark: number, beside: number): number {
  switch (form) {
    case 'columns':
      return Math.max(mark, beside);
    case 'stacked':
      return mark + beside;
    case 'bare':
      return 0;
  }
}

/**
 * HOW MANY COLUMNS A FORM NEEDS ACROSS: the mark and the text with the gap between them, or
 * the wider of the two, or nothing at all.
 *
 * THE OTHER HALF OF {@link rowsOfTheForm}, and it is a function of the same shape for the same
 * reason: the choice asks it of every rung of the ladder, and a width worked out inside a
 * chain of conditions could not be asked that way.
 *
 * NOUGHT FOR `bare`, which is what makes the ladder total: there is no terminal too narrow for
 * lines that are allowed to fold, and the floor of this ladder has to be answered at every
 * width there is — the same shape of floor the drawing of the name has (`presentation/
 * banner.ts`, which still says the name in a terminal too narrow for anything).
 *
 * THE LADDER IS STILL TOTAL AND THE WIDTHS UNDER EIGHTY ARE NO LONGER ASKED, because nothing
 * is laid out on a window that narrow (`floor.ts`). It is answered at every width for the reason
 * it always was — a function of a number has to answer for the number — and not because a device
 * can be any width there is.
 */
function columnsOfTheForm(form: PanelForm, mark: number, beside: number): number {
  switch (form) {
    case 'columns':
      return mark + BETWEEN_COLUMNS + beside;
    case 'stacked':
      return Math.max(mark, beside);
    case 'bare':
      return 0;
  }
}

/**
 * How many rows of the screen this panel's arrangement takes — the form's own cost, asked of
 * the one function that answers it.
 */
function panelRows(panel: Panel): number {
  return rowsOfTheForm(
    panel.form,
    panel.mark.length,
    besideTheMark(panel.standing.length, panel.record.length),
  );
}

/**
 * How many rows of a terminal `columns` wide some lines take — one each, and more for
 * every one that FOLDS.
 *
 * THIS IS THE HALF THE FIRST ARITHMETIC HERE DID NOT HAVE, and a real screen is what
 * found it: at sixty columns the sentence under the box is seventy-six columns long, so it
 * is two rows, and a page counted as though it were one opened with its own top already in
 * the scrollback. It is the rule the input area has had since it learnt about width — a row
 * the terminal would fold is not one row (`area.ts`) — asked of the lines the box does not
 * cover.
 *
 * AND IT DID THE ARITHMETIC ITSELF, which is what the renderer that folds falsified. It
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
  // A terminal with no room for an arrangement gets none, and the same lines land instead —
  // which is why the layout has two forms and not three. IT SAID *TOO NARROW* AND THERE ARE
  // TWO WAYS TO HAVE NO ROOM NOW: too narrow across, or an arrangement that would take more of
  // the way down than the chrome's share ({@link panelFor}).
  const bare = panel.form === 'bare';
  const landed: readonly Line[] = bare
    ? [...request.mark, request.title, ...request.standing, ...request.record, ...request.beneath]
    : request.beneath;
  // THE FORM'S OWN COST, ASKED OF THE FORM — nought for the one that is not an arrangement, and
  // that nought is the function's answer rather than a ternary here ({@link rowsOfTheForm}).
  const above = panelRows(panel);
  return {
    panel: bare ? undefined : panel,
    lines: [...(bare ? panelLines(panel) : []), ...request.beneath.map(request.render)],
    rows: above + foldedRows(landed, request.columns),
    above,
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
 * THE TITLE USED TO COME FIRST, and the frame is what put it there: it was on the box's top
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
 * The panel for a terminal of a given SIZE: the richest form that fits across it and inside
 * the chrome's share of the way down it, and its lines as bytes.
 *
 * A FORM USED TO GIVE WAY WHEN IT DID NOT FIT, AND *FIT* MEANT ACROSS. The premise under
 * that was the one the whole file was written on — that the arrangement is a DRAWING and a
 * drawing's question is its width — and what falsified it is where the drawing ended up: it is
 * the fixed region at the top of the screen, redrawn on every frame and never scrolled, so
 * every row of it is a row the session's answers can never be given. Measured on this
 * surface's own fixture at eighty by twenty-four: fifteen rows of arrangement, five of input
 * area, four left for the answer — and `/help` showed the last four rows of what it printed,
 * with none of the verbs on the screen. Nothing about the width rule moved; a second question
 * was added beside it, and the same three forms answer both.
 *
 * THE TWO QUESTIONS ARE NOT THE SAME KIND OF THRESHOLD, which is why one of them is a number.
 * Across, the threshold is the CONTENT'S own width, never a number somebody chose — a row
 * wider than the terminal would be folded, and nothing inside an arrangement may fold. Down,
 * nothing is folded and nothing is cut: every form fits down a screen of any ordinary height,
 * so the content's own measurement answers nothing at all. What is being ruled on is how much
 * of a caller's screen a region that says nothing about the record may hold for ever, and that
 * is a share rather than a fit ({@link A_THIRD}).
 *
 * THE SIZE IS ASKED OF THE DEVICE by whoever opens the session and handed in, both halves of
 * it in one reading, for the reason the banner gives: nothing that composes a line may look at
 * a terminal, and this does not compose one.
 *
 * THIS USED TO SAY IT WAS ANSWERED ONCE, when the session opened, and that "a panel that
 * redrew itself narrower on a resize would be rewriting what the caller can scroll back
 * to". What falsified it is the box taking the width of the TERMINAL: while the drawing
 * was as wide as its own content, a terminal that shrank to eighty columns still had room
 * for it, and not redrawing cost nothing. Corner to corner, a session opened at a hundred
 * and twenty columns and shrunk to seventy is eight rows the terminal folds in half —
 * not-redrawing became the broken drawing. So the answer is asked again whenever the size
 * changes, and what the old sentence was protecting is protected by something else: nothing
 * the caller could scroll back to is on this screen at all, and this function is CALLED again
 * rather than being a value somebody mutated. It is still pure, it still reads nothing, and the
 * record behind `record` is still the one the session paid for when it opened (the read counter
 * in `tests/the-name-and-the-hints.test.ts`).
 *
 * AND THE FRAME THAT FALSIFIED IT IS GONE, WHICH DOES NOT PUT THE OLD SENTENCE BACK. It
 * is asked for whichever size the device has when a frame is built, because the FORM is a
 * function of that size and a terminal dragged past either threshold has the wrong one on its
 * screen — a window made SHORTER is now as much a reason to answer again as one made narrower.
 * What keeps that from being a composition per keystroke is that the ANSWER is kept for the
 * size it was asked at, which is a cache rather than a delay (`repl/console.ts`,
 * `theOpening`).
 */
export function panelFor(request: PanelRequest): Panel {
  const { columns, rows, render, title, mark, standing, record } = request;
  const left = widest(mark);
  // WHAT THE SESSION IS, WHERE IT IS STANDING AND WHAT THE RECORD IS are one column: three
  // groups of rows, so the column is as wide as the widest row of the three. THE PLACE USED
  // TO BE ON THE LEFT, under the mark, and the title on the border above both — so this was the
  // record's width alone and the border's own cost was added to it.
  const right = Math.max(widthOf(title), widest(standing), widest(record));
  const beside = besideTheMark(standing.length, record.length);
  // THE LADDER, WALKED — and the two questions asked of every rung rather than of some of them.
  // The floor answers yes to both whatever the size, so this is total by construction and the
  // fallback is the same rung said twice rather than a case nothing covers.
  const fits = (form: PanelForm): boolean =>
    columnsOfTheForm(form, left, right) <= columns &&
    withinItsShare(rowsOfTheForm(form, mark.length, beside), rows);
  const form: PanelForm = THE_FORMS.find(fits) ?? 'bare';
  return {
    form,
    title: render(title),
    mark: mark.map(render),
    standing: standing.map(render),
    record: record.map(render),
  };
}
