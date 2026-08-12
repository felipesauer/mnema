/**
 * WHERE A LINE LANDS — and nothing at all about what it says.
 *
 * This is the whole of the console's layout, and it is deliberately the only file on
 * this surface that a layout library reaches. Everything in it POSITIONS: the opening at the
 * top, a window onto what the session has said under it, a row for what is being typed, the
 * caret at the offset the caller's arrows put it at, a place for the words a Tab could not
 * choose between, and a place for what the caller can do next.
 *
 * THREE REGIONS, AND EVERY ONE OF THEM IS REDRAWN. The opening is FIXED at the top and never
 * moves; the input area is FIXED at the foot and never moves; between them is a WINDOW onto
 * the roll of what the session has said, and that is where the scroll works. The three
 * together are exactly as tall as the terminal, on every frame — which is what makes the first
 * and the last fixed at all.
 *
 * ⚠️ AND IT WAS THE OPPOSITE OF THAT, WHICH IS THE MODEL THIS DELIVERY REPLACED. What the
 * session said used to be written ONCE, into a region the library keeps and never redraws, and
 * the caller's own scrollback was the roll: a line that left the top of the screen went into
 * their history, where they could scroll back to it. So the opening was CONTENT — the first
 * item of that kept region — and it rose off the screen the moment enough was printed. A fixed
 * header is not a thing that model can have, and eight deliveries of this frontier were patches
 * on that impossibility: rows with nothing on them under the opening, the input anchored at the
 * foot by arithmetic, a page turned when the drawing changed, a subtraction for the rows a
 * shrinking window carried away, a window onto the list of words. Each closed one symptom and
 * the next appeared beside it.
 *
 * ⚠️ AND THE ARGUMENT AGAINST TAKING THE SCREEN WAS WRITTEN HERE, in as many words: *the
 * alternate screen DISCARDS the scrollback when the program exits, which is the opposite of a
 * session whose whole output a caller wants to keep reading afterwards*. It was not wrong, it
 * was incomplete — the cost it named is real, and it is PAID rather than avoided: everything
 * the session said is written into the caller's own buffer on the way out, so their history
 * still ends with the whole of it (`scrolling.ts`, `console.ts`).
 *
 * NOTHING HERE COMPOSES A LINE, and that is the limit the whole decision to take a
 * layout library rests on. Five deliveries built ONE model of what a line of this
 * product says: `presentation/` answers with parts that carry a role, a renderer turns
 * them into bytes, and a golden holds the two renderers to saying the same thing. A
 * component that put a sentence together would be a SECOND model of that, and the most
 * expensive lesson of this series is that two ways of saying the same thing diverge in
 * silence — it was the opaque summary, the vocabulary typed out at twenty-seven sites,
 * the three READMEs that disagreed.
 *
 * So the rule is: a component receives strings and puts them somewhere. It never adds a
 * word, a separator, a padding or a punctuation mark of its own. That is not a habit,
 * it is checked — a scan over this file refuses a text literal, a template and a
 * concatenation, and the case that proves the scan works makes a component say
 * something and watches it go red.
 *
 * THE STYLE DECISIONS HERE ARE NOT ABOUT A REPORT, and there are two of them. The PALETTE
 * is dimmed — the words a caller could type next, whether a slash or a Tab asked for them
 * — and it is the console's own affordance rather than a line of the record. It used to be
 * one row and it is a list now; the decision is the same one and it did not grow.
 * THE TIPS ARE NOT A SECOND ONE, and the difference is the whole
 * reason they read the same: they are dim because the renderer made them dim
 * (`presentation/detail.ts`, `aside`), so what says "you may skip this" is the same table
 * that says it about an id and an instant, and this file did not decide anything about
 * them at all. THE BADGE IN THE CORNER IS NOT A THIRD: it says what the record proved, so
 * it is a line of the record, composed and rendered where every other one is
 * (`session.ts`) and only PLACED here — at the far end of its row, which is a position.
 *
 * THE SECOND IS THE ACCENT, AND IT IS CHROME. This sentence used to end "no line that
 * came from a renderer is touched, painted, padded or trimmed here", and the opening
 * panel is what falsified it: a box has a border, a border has a colour, and the title on
 * it and the mark inside it are the same object as the border — the frame the session
 * puts around itself. What survived, and what the guard now says, is the part that was
 * load-bearing: NO LINE OF THE RECORD is painted here. A verdict, a project's path, a
 * hint — everything that says something about what is written down — arrives with the
 * weight and the hue its renderer gave it and leaves with the same ones.
 *
 * ⚠️ AND THERE IS NO FRAME LEFT TO CARRY THE ACCENT. The box went — the console this was drawn
 * from writes its name and its context as text beside its logo and draws none — so what the
 * accent is spent on is the two things it was always really on: the MARK and the TITLE, which
 * say what the product is and nothing about the record. The rules the input area sits between
 * are the third and they are the frame's last surviving siblings ({@link rule}). The rule did
 * not change and the count did not change: ONE hue, spent in this file, and none of the three
 * severities.
 *
 * SO COLOUR ON THIS SURFACE HAS TWO AXES NOW, and they may not meet. DATA is painted by
 * severity and by nothing else, which is `presentation/styled.ts` and unchanged. CHROME
 * is painted by ONE accent, spent here, and the accent is MAGENTA — the hue this product
 * is marked by. ⚠️ IT WAS CYAN, AND THE ARGUMENT FOR IT WAS *chosen by elimination rather
 * than by taste*: red, green and yellow are the three severities, blue is a link, and cyan
 * was what was left. Elimination NARROWS and it does not choose — magenta survives the same
 * elimination, so what the argument really said was that any survivor would do, and the mark
 * of the product is a better reason than alphabetical luck. Nothing about the rule moved:
 * `tests/the-panel.test.ts` holds both halves, exactly one hue in this file and it is none of
 * the three severities.
 */

import { Box, Text, useCursor, useInput } from 'ink';
import { createElement as node, type ReactNode, useSyncExternalStore } from 'react';
import type { Area } from './area.js';
import type { Keystroke } from './editing.js';
// THE TWO MEASUREMENTS OF THE ARRANGEMENT, read from where the arithmetic that chooses the
// form reads them. ⚠️ THEY WERE COPIED, and the copy was defended in as many words — *two
// copies of these numbers is two panels, one of which fits* — which named the risk and then
// took it. One constant, two readers.
import { BETWEEN_COLUMNS, BETWEEN_SECTIONS, type Panel } from './panel.js';

/**
 * The one hue this layout spends, on the things it draws — the mark, what the session is, and
 * the two rules the input area sits between.
 *
 * ⚠️ IT WAS SPENT ON A FRAME: the panel's border, the rule down the middle of it and the title
 * laid on its top edge. The frame is gone and the hue is not — what it is on is what the frame
 * was around.
 *
 * MAGENTA, and it is the mark of the product rather than the survivor of an elimination.
 * ⚠️ THE DOC HERE SAID *cyan by elimination* and the elimination is unchanged — the three
 * severities have red, green and yellow, so a frame in any of them would read as a verdict
 * about what it frames, and blue is a link. What that argument could not do is CHOOSE: it
 * leaves cyan and magenta both admissible, and this product is marked in one of the two.
 * There is still no second accent, and that is checked rather than intended.
 */
const ACCENT = 'magenta';

/**
 * How an EDGE is drawn — the library's own set, asked for by the only thing on this surface
 * that still has one: the two rules the input area sits between.
 *
 * ⚠️ IT WAS `How the box is drawn` AND IT NAMED THE PANEL'S FRAME. The frame is gone — the
 * console this was measured against writes its name and its context as text beside its logo
 * and draws no box at all — so what is left of the set is the top edge of a box with nothing
 * in it, which is how a rule across the terminal is drawn ({@link rule}). The four constants
 * that were the frame's geometry went with it: the stub of border before the title, the gap
 * inside the border, and the two halves of the gap on either side of the rule that divided the
 * columns.
 */
const BORDER = 'round';

/**
 * Where the badge sits on its row: at the far end of it.
 *
 * It is POSITION and nothing else, which is what makes it this file's to answer. The row
 * is as wide as the terminal, so the badge ends on the last column at every width and at
 * every length — no line is padded here, and no number about a terminal is written down.
 * A column chosen instead would be a badge that stops short on a wide screen and folds on
 * a narrow one, which is what the reference this was measured from does NOT do (its mark
 * lands on column 102 of 120, and the run after it ends on 120).
 */
const AT_THE_FAR_END = 'flex-end';

/**
 * THE MIDDLE — where the text beside the mark sits down the height the mark gave the row.
 *
 * ⚠️ IT ARRANGED BOTH COLUMNS AND IT ARRANGES ONE. ACROSS the left column its groups used to
 * sit in the middle of the widest of them, because the mark and the line under it were both in
 * there and one of the two was always much the wider. The place moved to the other column, so
 * the left one holds the drawing and nothing else — a column with one group in it has nothing
 * to centre, and an alignment kept there would be a word that could never change an answer.
 *
 * DOWN THE TEXT COLUMN it stayed, and it is the half with a measurement behind it. ⚠️ THE
 * SECTION SAT AT THE TOP and nothing said so — its top row lined up with the top row of the
 * drawing because that is where a column starts, not because anybody chose it. Measured at a
 * hundred and forty columns: fourteen rows of box, three of them the record, and NINE blank
 * rows under it. Centred, the gap is halved and shared, and what the text says sits at the
 * height of the mark it is beside.
 *
 * IT IS POSITION AND NOTHING ELSE. No line is padded, trimmed or lengthened; where a group
 * starts is exactly the kind of question a layout is allowed to answer.
 */
const IN_THE_MIDDLE = 'center';

/**
 * ⛔ WHERE A LINE TOO WIDE FOR THE SCREEN IS BROKEN: at the margin, and nowhere else.
 *
 * IT IS THE LIBRARY'S OWN NAME FOR *break at the width and do not look for a word*, and both
 * halves of that are the decision. Breaking at the margin is what a TERMINAL does to a line that
 * does not fit, so nothing on the page moves by asking for it — the same glyphs land on the same
 * rows. What changes is WHO knows: a frame whose rows the library counted and the terminal then
 * folded is a frame the library believes is shorter than it is, and on a page that is exactly the
 * screen that one row is the difference between writing in place and scrolling.
 *
 * ⛔ AND WORD WRAPPING IS REFUSED, which is what the other half rules out. Where a sentence
 * divides is a decision about what a line SAYS, and this surface has one place for that
 * (`presentation/folded.ts`, which folds between words with the continuation indented, before a
 * line ever reaches here). A layout that broke at a space would be a second such place — the
 * exact shape of divergence the header of this file is about.
 */
const THE_MARGIN = 'hard';

/** Everything the console is showing, as one value read at one instant. */
export interface Shown {
  /**
   * THE TOP REGION: the arrangement the page opens with, or nothing when this terminal has no
   * room for one.
   *
   * ⚠️ IT USED TO BE THE FIRST ITEM OF WHAT WAS KEPT, above every line the session had said,
   * and that is what made it CONTENT: enough output and it rose off the screen for good, which
   * is the defect the whole of this delivery is about. It is a region of its own now, drawn on
   * every frame at the top of the screen, and nothing the session says can move it.
   *
   * ⛔ AND IT IS THE ARRANGEMENT ALONE. The LINES an opening lands are on the roll with
   * everything else the session said (`scrolling.ts`), which is what the narrow case forced: a
   * fixed region that does not fit can only be CLIPPED, and a clipped drawing loses exactly the
   * rows that say what the session is and what the record proved. On the roll it loses nothing —
   * the reader sees the end of it and scrolls back for the rest.
   */
  readonly panel: Panel | undefined;
  /**
   * THE MIDDLE REGION: the lines of the roll a reader can see right now, oldest first.
   *
   * Composed and CUT before it arrives, like every other line here: which lines are in the
   * window is a function of how far back the reader has walked and how many rows each line
   * takes at this width, and both are answered where the roll is (`scrolling.ts`). This file
   * has nothing to measure and nothing to choose.
   */
  readonly window: readonly string[];
  /**
   * HOW WIDE THE CALLER'S TERMINAL IS, asked of the DEVICE in the same breath as the height.
   *
   * ⚠️ IT WAS THE LIBRARY'S TO KNOW AND THAT IS WHAT A RESIZE FALSIFIED. The frame declared its
   * HEIGHT and left its width to the library, which sets the root of the layout from its own
   * reading of the device — and the two readings do not happen at the same instant. On a resize
   * the console rebuilds this value and re-renders synchronously, before the library has had its
   * own listener run: the tree then has the NEW height and the root still has the OLD width, so
   * the frame comes out with rules a hundred and twenty columns long on an eighty-column screen,
   * which the terminal folds — and a folded frame is a frame taller than the screen. Measured on
   * a loaded machine: a shrink wrote `24 rows / 120 columns` before the two correct frames.
   *
   * SO THE FRAME DECLARES BOTH OF ITS MEASUREMENTS. They come from one reading of one device on
   * one frame (`console.ts`, `showing`), so there is no instant at which the page is half one
   * size and half another.
   */
  readonly columns: number;
  /**
   * HOW TALL THE CALLER'S TERMINAL IS, asked of the DEVICE by the module that owns the streams
   * and handed over as the height of the frame.
   *
   * ⛔ IT IS THE ONE NUMBER THAT MAKES THE THREE REGIONS FIXED, and it is a number rather than
   * an arrangement for a reason the library forces. The frame is laid out to exactly this
   * height, so the middle takes whatever the other two leave and the whole is the screen — which
   * is what the library needs to write the frame IN PLACE instead of appending a row under it.
   * Measured, before the height was declared: the library counted a folded line as one row where
   * the terminal counted two, decided the frame was short of the viewport, wrote the newline it
   * writes under a frame that is, and the page scrolled by one — the top row of the drawing gone,
   * on a screen where nothing is supposed to move.
   */
  readonly rows: number;
  /** The row being typed: the prompt and what is on it, already put together. */
  readonly present: string;
  /**
   * THE PALETTE: the words a caller could type next, one already-composed row each, top
   * first. Empty when there is none open.
   *
   * ⚠️ IT USED TO BE `candidates`, AND IT USED TO BE ONE STRING. What a Tab could not
   * choose between was joined into a row of bare tokens; it is a list of rows now, with a
   * column saying what each word is, and it is opened by a slash as well as by a Tab
   * (`palette.ts`). Renamed rather than redefined, because a field that keeps its
   * spelling while what it holds changes leaves whatever read it asserting the new shape
   * by accident.
   *
   * Composed and CUT before it arrives, like every other line here. How many rows there
   * are is the area's answer (`area.ts`) and how wide each one is is the palette's, so
   * this file has nothing to measure and nothing to shorten.
   */
  readonly palette: readonly string[];
  /** Which column of {@link present} the caret sits in. */
  readonly column: number;
  /**
   * WHICH ARRANGEMENT THE INPUT AREA IS IN, and where the caret goes inside it.
   *
   * It travels with what is shown rather than arriving as a prop, and the two reasons are
   * the two things it is a function of: how TALL the caller's terminal is, which changes
   * when they drag the bottom edge of their window, and whether a Tab left words on the
   * page, which changes on a keystroke. Both are answered before this value is built
   * (`area.ts`, `console.ts`); nothing is measured here.
   */
  readonly area: Area;
}

/** What the layout reads and what it reports back to. The console implements it. */
export interface Watched {
  /** What is showing right now. A new value whenever anything changed. */
  readonly now: () => Shown;
  /** Call back on every change; the answer stops the calling back. */
  readonly watch: (changed: () => void) => () => void;
  /**
   * A key the caller pressed — or a notch of the wheel, which arrives by the same road.
   * What either of them MEANS is decided elsewhere.
   */
  readonly pressed: (stroke: Keystroke) => void;
}

/**
 * The console: the opening at the top, what the session has said in the middle, and the input
 * at the foot — the badge in the corner, the row being typed between two rules, and what to do
 * next.
 *
 * THE TIPS AND THE BADGE ARE PROPS AND EVERYTHING ELSE IS WATCHED, and the line between them
 * is what each one is a function of: those two were resolved once when the session opened and
 * nothing that happens inside a session changes either, so putting them in the value rebuilt
 * on every keystroke would have said they might.
 *
 * ⚠️ THE OPENING USED TO BE A PROP TOO, then it joined the watched value, and now it is watched
 * for a different reason than the one it joined for. It joined because a caller who narrowed
 * their window past a threshold got the page again with a different arrangement, on a new
 * identity — a page TURN. There are no pages to turn: it is watched because it is a REGION,
 * rebuilt with the other two whenever anything moves, and it is composed for the size read at
 * the moment of the drawing rather than for a size that has settled (`console.ts`).
 *
 * WHAT THE OLD SENTENCE WAS PROTECTING IS UNTOUCHED, and it is worth saying plainly
 * because it is the expensive half: the panel is the one thing on this surface paid for
 * with a read of the record, and nothing here re-reads it. A recomposition is the console
 * calling a pure function over lines that already exist; a value the LAYOUT re-read on every
 * frame would still be a replay loop, and this is not one
 * (`tests/the-name-and-the-hints.test.ts` counts the reads).
 */
export function Region({
  watched,
  tips,
  badge,
}: {
  readonly watched: Watched;
  readonly tips: string;
  readonly badge: string;
}): ReactNode {
  const shown = useSyncExternalStore(watched.watch, watched.now, watched.now);
  const { setCursorPosition } = useCursor();

  useInput((input, key) => {
    watched.pressed({ input, ...key });
  });

  // THE REAL CARET, on the row being typed, at the offset the arrows moved it to — and at
  // the depth the three regions put that row at. IT USED TO BE THE FIRST ROW OF THE REGION
  // and the doc here said so: everything above it was in the scrollback and out of this
  // frame. Everything above it is IN this frame now — the opening, the window onto the roll,
  // and the rows of the area over the row being typed — and every one of those numbers is
  // counted where it is answered ({@link Shown.above}, `area.ts`).
  //
  // ⚠️ IT WAS HANDED OVER IN AN EFFECT, AND AN EFFECT IS ONE FRAME LATE. Measured: the
  // caret opened three rows BELOW the prompt — where the terminal leaves it after the last
  // row of a frame — and corrected itself on the first keystroke. The library keeps what it
  // is handed in a ref and pushes it to the page during the COMMIT (`ink`, `useCursor`: an
  // insertion effect, which runs before the frame is written); a passive effect runs after
  // that, so what it sets is a position for the NEXT frame, and on the opening frame there
  // is no next one until a key is pressed. Handing it over while the frame is being
  // composed is what puts the caret on the row a caller is about to type on — and it is a
  // ref rather than state, so nothing is rendered twice for it
  // (`tests/the-opening-fits-the-screen.test.ts` compares the opening with the frame after
  // one keystroke: they used to disagree).
  // ⚠️ AND IT IS COUNTED UP FROM THE FOOT RATHER THAN DOWN FROM THE TOP, which is the one way
  // it can be exact. Counted downwards it would be the top region plus the middle one, and
  // neither of those is a number this side of the layout knows: how many rows a drawing really
  // takes is the library's arithmetic over what it was handed, and a console that predicted it
  // would be a second opinion that goes one out on the first line that folds. The area is at the
  // foot of a frame that is exactly as tall as the screen, so the row being typed is as many
  // rows up from the bottom as the area is tall, less what the arrangement draws over it — two
  // numbers, both of them already answered ({@link Shown.rows}, `area.ts`).
  setCursorPosition(theCaretOn(shown));

  return node(
    Box,
    // ⛔ THE FRAME IS THE SCREEN, and this is where that is said. Everything else about the
    // three regions follows from it: the two fixed ones take what they take, the middle takes
    // what is left, and there is no row under the last one for the library to write a newline
    // into. What is outside it is CLIPPED rather than allowed to push — a frame one row taller
    // than the terminal scrolls the page, and the top region moving is the defect this whole
    // model exists to remove.
    {
      flexDirection: 'column',
      width: shown.columns > 0 ? shown.columns : undefined,
      height: shown.rows > 0 ? shown.rows : undefined,
      overflow: 'hidden',
    },
    shown.panel === undefined ? null : node(Header, { panel: shown.panel }),
    node(Middle, { window: shown.window }),
    node(Present, {
      present: shown.present,
      palette: shown.palette,
      area: shown.area,
      tips,
      badge,
    }),
  );
}

/**
 * ⚠️ WHERE THE CARET GOES, WITH THE LIBRARY'S OWN OFF-BY-ONE ANSWERED — one row lower than the
 * row it is meant to be on.
 *
 * THE LIBRARY MOVES THE CARET UP FROM THE BOTTOM, and it says in its own words what it is
 * counting from: *assumes cursor is at (col 0, line visibleLineCount) — i.e. just after the last
 * output line*. That is true of every frame it writes with a newline under it, and FALSE of a
 * frame that fills the viewport: it deliberately leaves the newline off that one, so the caret
 * is left at the end of the LAST line rather than on the line after it, and every position it is
 * then asked for comes out one row high. Measured on a real terminal at a hundred by forty: the
 * caret opened on the rule above the row being typed.
 *
 * SO THE NUMBER HANDED OVER IS THE ROW PLUS ONE, which is the library's own origin expressed in
 * the library's own terms rather than a fudge: it is being told where the caret is relative to
 * the place it thinks it is standing. It is here, in one expression, so the compensation cannot
 * be applied twice or forgotten (`tests/the-input-has-its-own-place.test.ts` reads the caret's
 * row off a real screen).
 *
 * A DEVICE THAT REPORTS NO HEIGHT GETS NO CARET AT ALL. The frame is not the screen there — it
 * is whatever its content is — so there is no row to count back from, and a position invented
 * against a height nobody reported would put the caret somewhere nothing is drawn.
 */
function theCaretOn(shown: Shown): { readonly x: number; readonly y: number } | undefined {
  if (shown.rows <= 0) return undefined;
  return { x: shown.column, y: shown.rows - shown.area.height + shown.area.above + 1 };
}

/**
 * THE TOP REGION: the name drawn, and what the session is — in whichever of the two
 * arrangements the terminal has room for.
 *
 * IT IS FIXED AND IT IS REDRAWN, which used to be a contradiction and is the whole shape of
 * this delivery. In the model this replaces, "fixed" could only be bought by writing something
 * once and never touching it again — and a thing written once cannot stay at the top of a
 * screen that scrolls. The screen does not scroll now, so being at the top is a POSITION and
 * being fixed is the consequence of drawing it there on every frame.
 *
 * A terminal too narrow for either arrangement gets none, which is decided before this
 * component is reached (`panel.ts`, `session.ts`) — so there is no third branch here, and the
 * narrow case is not a drawing but the absence of one, with the same lines on the roll instead.
 *
 * ⚠️ THERE WAS A BOX AROUND IT, drawn corner to corner, with the title laid on its top edge
 * in three pieces — a stub of border, the title with a space on each side, and the rest
 * running to the corner. All of it is gone: the reference this panel was measured against
 * writes its name, its build and its context as text beside its logo and draws no frame, and
 * the frame was the one thing on this surface a component painted for a reason that was not
 * the record's. What the box cost is measured rather than remembered — two rows of edge, four
 * columns of border and gap, and the arrangement that had to be chosen around them — and what
 * replaces it costs the drawing of the name and nothing more.
 *
 * ⚠️ AND WITH IT WENT THE WIDTH. The box took the terminal's, so this component was handed one;
 * nothing here is drawn to an edge now, so every row is as wide as what is on it and the panel
 * has no width to be told (`panel.ts`, {@link Panel}).
 */
function Header({ panel }: { readonly panel: Panel }): ReactNode {
  return node(
    Box,
    // IT GIVES WAY BEFORE THE INPUT DOES, which is the only ordering a degenerate terminal can
    // have: on a screen with no room for both, what a caller can still TYPE on matters more than
    // what the product is called. It cannot happen on a terminal anybody opens — the arrangement
    // is chosen to fit and there is none at all when it cannot be (`panel.ts`) — and it is said
    // here so that the case which cannot happen does not happen by pushing the prompt off.
    {
      flexDirection: panel.form === 'columns' ? 'row' : 'column',
      flexShrink: 1,
      overflow: 'hidden',
    },
    ...(panel.form === 'columns' ? sideBySide(panel) : oneOverTheOther(panel)),
  );
}

/**
 * ONE LINE ON ONE ROW, with nothing added to it — the shape every line of this page is drawn
 * in, wherever it is drawn.
 *
 * The box's two measurements are the two ways a layout can quietly change a line it was only
 * asked to place:
 *
 *   - A ROW TALL WHATEVER IS IN IT, because a line with NOTHING on it is still a line.
 *     Text alone occupies no rows, so a report that separates its sections with blank
 *     lines would arrive with the separations gone. Measured against two reads of this
 *     product that do exactly that.
 *   - BROKEN AT THE MARGIN BY THE LAYOUT AND NEVER BY THE TERMINAL, which is the half this
 *     delivery inverted. ⚠️ IT USED TO BE *AS WIDE AS THE LINE IS LONG*, with the reason
 *     written out: the line arrives already folded between words with the continuation
 *     indented (`presentation/folded.ts`), so a layout that re-wrapped it would fold it twice
 *     and the second fold is the one at the margin. WHAT FALSIFIED IT IS WHO COUNTS. A box as
 *     wide as its line does not stop the line being folded — the TERMINAL folds it, at exactly
 *     the margin, and the only thing the width bought was that the LIBRARY did not know. On a
 *     page that scrolled, a frame the library measured one row short of the truth cost nothing;
 *     on a frame that is the screen, it costs the library a newline it writes under a frame it
 *     believes has room, and the page scrolls. Measured after a resize to eighty columns: the
 *     top row of the drawing gone, and a blank row at the foot.
 *
 *     So the break happens where it was always going to happen and the layout is the one that
 *     makes it: `hard` is a break at the margin and nothing else — no word wrapping, which
 *     would be this file deciding where a sentence divides. Same glyphs on the same rows, and a
 *     library that knows how many rows there are.
 */
function landed(line: string, index: number): ReactNode {
  return node(Box, { key: String(index), minHeight: 1 }, node(Text, { wrap: THE_MARGIN }, line));
}

/**
 * THE MIDDLE REGION: the part of the roll a reader can see, and the emptiness under it.
 *
 * ⛔ IT IS A WINDOW AND NOT A LIST THAT GROWS, and that distinction is the one this surface has
 * been paying for since it had two regions. A region whose height followed what a session had
 * to SAY walks into the height at which the library stops redrawing part of the screen; a
 * region whose height is what the terminal has left after the two fixed ones cannot, at any
 * length of session, because nothing about what was said is in the arithmetic. What is said
 * goes on a roll of its own, and this shows as much of it as there is room for
 * (`scrolling.ts`).
 *
 * THE EMPTINESS IS A ROW AND NOT A LINE, which is what keeps this file from composing one: a
 * box with a minimum height is a row of the page with nothing put on it, exactly like the row
 * over the palette. And ONE box rather than one per row: what it is is a single stretch of
 * nothing, and a stretch of nothing has a height and no parts.
 *
 * NONE AT ALL IS NO BOX, and not a box of no rows: a middle region the window fills exactly is
 * the ordinary case of a session that has printed, and it draws what it drew then.
 */
function Middle({ window }: { readonly window: readonly string[] }): ReactNode {
  return node(
    Box,
    // ⛔ IT TAKES WHAT THE OTHER TWO LEAVE, and that is a property of the layout rather than a
    // number anybody works out. The frame is the screen and the two fixed regions are as tall as
    // their content, so this one growing into the rest is what makes the arithmetic exact
    // without anybody predicting how many rows a drawing takes.
    //
    // THE EMPTINESS IS UNDER THE LINES, which is where a page reads downwards to: the opening at
    // the top, what the session said following it, and the room to spare between that and the
    // input. Measured, when it was the other way round: at a hundred and twenty by forty the
    // page opened with twenty-one blank rows at the TOP and the drawing shoved down against the
    // input, so the first thing there was to read was the last thing on the screen.
    { flexDirection: 'column', flexGrow: 1, flexShrink: 1, overflow: 'hidden' },
    ...window.map((line, index) => landed(line, index)),
  );
}

/**
 * Some already-rendered lines, one to a row, with nothing added to any of them.
 *
 * `accented` is the CHROME switch and it is false for everything that says something about
 * the record. What it is true for is the two things that say nothing about it: the mark — the
 * name drawn, which carries no fact — and the title, which says what the product and the
 * session are. ⚠️ IT WAS TRUE FOR THE MARK ALONE, and the border and the title on it were
 * painted where they were drawn; with the border gone the title is a row like any other, so
 * the switch is what carries the accent onto it. There is no third, and that is checked rather
 * than intended (`tests/the-panel.test.ts`).
 *
 * No width is set, unlike the rows above: inside the panel each group is as wide as its widest
 * child and the library measures a line the way a terminal does, so a painted line takes the
 * room it takes on a screen rather than the room its bytes take. That the two measurements
 * agree with the one the FORM was chosen by is the panel's whole geometry, and it is asserted
 * (`tests/the-panel.test.ts`).
 */
function rows(lines: readonly string[], accented = false): ReactNode[] {
  return lines.map((line, index) =>
    node(
      Box,
      { key: String(index), minHeight: 1 },
      node(Text, accented ? { color: ACCENT, wrap: THE_MARGIN } : { wrap: THE_MARGIN }, line),
    ),
  );
}

/**
 * The mark, and beside it what the session is — with the text in the middle of the height the
 * mark gave the row.
 *
 * THE TEXT COLUMN IS AS TALL AS THE ROW, by construction rather than by a number: a column of
 * a row takes the row's height, and the row is as tall as its tallest child, which is the
 * drawing. So {@link IN_THE_MIDDLE} has a height to be in the middle of, and nothing here
 * counts a row.
 *
 * THE GAP IS ON THE MARK'S SIDE OF IT, which is one place rather than two: it used to be a
 * padding on each of them with a rule in between, and there is nothing in between.
 */
function sideBySide(panel: Panel): ReactNode[] {
  return [
    node(
      Box,
      { key: 'mark', flexDirection: 'column', paddingRight: BETWEEN_COLUMNS },
      ...rows(panel.mark, true),
    ),
    node(
      Box,
      { key: 'beside', flexDirection: 'column', justifyContent: IN_THE_MIDDLE },
      ...whatItSays(panel),
    ),
  ];
}

/**
 * The same groups, one under the other, for a terminal too narrow to put the text beside the
 * mark.
 *
 * THE MARK IS FIRST, and it is the same reading order the other form has across the screen
 * rather than a second one: the drawing, then what the session is. ⚠️ THE TITLE USED TO BE
 * FIRST here, because the frame drew it above everything.
 */
function oneOverTheOther(panel: Panel): ReactNode[] {
  return [group('mark', panel.mark, true), ...whatItSays(panel)];
}

/**
 * WHAT THE SESSION IS, WHERE IT IS STANDING, AND WHAT THE RECORD IS — the three groups that
 * go beside the mark, in that order, in both arrangements.
 *
 * ⚠️ THE FIRST OF THEM WAS ON THE BOX'S TOP BORDER and the second was under the mark. Moving
 * them here is the whole of what the frame's departure bought: the drawing is nine rows and
 * the text is five, so text BESIDE the mark costs the page the mark alone, and text under it
 * cost the page both.
 *
 * THE TITLE IS PAINTED AND THE OTHER TWO ARE NOT, which is the same switch the mark is drawn
 * with and the same reason: it says what the session is rather than anything about the record.
 * It is the accent's second and last place, exactly as it was when the border carried it.
 */
function whatItSays(panel: Panel): ReactNode[] {
  return [group('title', [panel.title], true), group('standing', panel.standing), theRecord(panel)];
}

/**
 * Some already-rendered lines as one group of rows, under a key of its own.
 *
 * ONE BOX PER GROUP rather than rows poured into one parent, and the reason is the library's:
 * a row is identified inside its parent by its POSITION, so two groups sharing a parent would
 * each have a first row claiming the same place.
 */
function group(key: string, lines: readonly string[], accented = false): ReactNode {
  return node(Box, { key, flexDirection: 'column' }, ...rows(lines, accented));
}

/**
 * WHAT THE RECORD IS: the one section of the panel, and everything it says that is not the
 * name, the build or the place.
 *
 * A BLANK ROW OVER IT, IN BOTH ARRANGEMENTS. ⚠️ IT WAS THE STACKED FORM'S ALONE, on a premise
 * this delivery falsified: *beside the mark there is nothing above it and its top row lines up
 * with the top of the drawing*. That was true while the column held the record and nothing
 * else. What the session is and where it is standing are above it in both forms now, so a
 * section that started on the next row would read as part of the group before it either way —
 * and the argument the two forms differed by is the same argument that now applies to both.
 *
 * ⚠️ IT USED TO BE TWO SECTIONS WITH A RULE BETWEEN THEM, and this was `sections`. The
 * second section said what to type; it went because the row under the prompt says it too,
 * in the place that does not scroll away (`session.ts`, `tips`). The rule went WITH it —
 * with one section there is nothing left to divide — and the function is renamed rather
 * than emptied, so a case that was using the rule as a means went red instead of quietly
 * measuring nothing.
 */
function theRecord(panel: Panel): ReactNode {
  return node(
    Box,
    { key: 'record', flexDirection: 'column', marginTop: BETWEEN_SECTIONS },
    ...rows(panel.record),
  );
}

/**
 * THE INPUT AREA: the row being typed, between two rules, with the badge over it and the
 * hint under it.
 *
 * IT USED TO BE THREE ROWS IN ONE ORDER — the row being typed, then the words a Tab could
 * not choose between, then the tips — and the doc here said the order was "how far each
 * one is from the keystroke". WHAT FALSIFIED IT IS THE REFERENCE, measured rather than
 * remembered: the input of the console this was drawn from is not a box, it is two runs of
 * the terminal's full width with the row between them, and the badge is one row above the
 * upper one, at the far end of it. Both rules are drawn corner to corner, which is why
 * nothing here says how wide anything is.
 *
 * THE WORDS A TAB OFFERED MOVED ABOVE THE RULES, and that is the one part of the old order
 * that changed on purpose rather than by measurement: they answer the key that was just
 * pressed, and what answers a keystroke belongs over the input rather than under it. That
 * is also where the list of commands went, exactly as this paragraph said it would: the
 * PALETTE is those rows, opened by a slash as well as by a Tab, and two things that answer
 * the same key may not appear on opposite sides of the row it was typed on.
 *
 * WHICH ROWS THERE ARE IS NOT DECIDED HERE. A terminal without the height for all of them
 * gets fewer, tallest arrangement first, and a terminal too narrow for the hint or the
 * badge to be ONE row gets neither — both are `area.ts`, which is the same split the panel
 * already has between how much fits and what is drawn. A row with nothing in it is still
 * left out rather than left blank, which is the half of the old shape that survived whole.
 *
 * THE RULES ARE DRAWN AND NOT WRITTEN: a box with nothing in it and one edge switched on, so
 * the run of glyphs is the library's. A string of dashes typed here would be text a component
 * put on the page. They are CHROME and they take the one accent this file spends. ⚠️ THIS SAID
 * *exactly as the one inside the panel is* and *like the frame they are the siblings of*, and
 * the panel has neither: the frame went, and these two are the only edges left on the surface.
 */
function Present({
  present,
  palette,
  area,
  tips,
  badge,
}: {
  readonly present: string;
  readonly palette: readonly string[];
  readonly area: Area;
  readonly tips: string;
  readonly badge: string;
}): ReactNode {
  const ruled = area.form !== 'bare';
  return node(
    Box,
    { flexDirection: 'column', flexShrink: 0 },
    palette.length > 0
      ? node(Box, { flexDirection: 'column' }, breathing(), ...dimmed(palette))
      : null,
    area.form === 'full'
      ? node(Box, { justifyContent: AT_THE_FAR_END }, node(Text, { wrap: THE_MARGIN }, badge))
      : null,
    ruled ? rule() : null,
    node(Text, { wrap: THE_MARGIN }, present),
    ruled ? rule() : null,
    area.hint ? node(Text, { wrap: THE_MARGIN }, tips) : null,
  );
}

/**
 * The palette's rows, one to a row, dimmed.
 *
 * THE ONE PLACE THIS FILE DECIDES A WEIGHT, and it is the same decision it has made since
 * a Tab first offered two words: what a caller could type next is the console's own
 * affordance rather than a line of the record, so it reads as one. It is not a hue and it
 * is not a severity — nothing about the record is being ruled on — and it is not a second
 * accent, because dimming is the absence of colour rather than a colour.
 *
 * Nothing is added to a row and nothing is taken off one: they arrive composed, padded and
 * cut (`palette.ts`), and all this does is put each on a row of its own.
 */
function dimmed(list: readonly string[]): ReactNode[] {
  return list.map((row, index) =>
    node(Text, { key: String(index), dimColor: true, wrap: THE_MARGIN }, row),
  );
}

/**
 * THE BLANK ROW OVER THE PALETTE: a box with nothing in it, one row tall.
 *
 * A ROW AND NOT A LINE, which is what keeps this file from composing one. There is no string
 * here, empty or otherwise — a box with a minimum height is a row of the page with nothing
 * put on it, exactly like the row a landed empty line gets above.
 *
 * WHY IT IS HERE AT ALL is the palette reading as part of what is above it rather than as an
 * answer to the key just pressed. The row is COUNTED where the region's height is worked out
 * (`area.ts`, `ABOVE_THE_PALETTE`), because a row this file drew and that file did not count
 * is a frame one row taller than the screen it is drawn on.
 */
function breathing(): ReactNode {
  return node(Box, { key: 'breathing', minHeight: 1 });
}

/**
 * One rule across the whole terminal: a box with nothing in it and its top edge on.
 *
 * AS WIDE AS THE TERMINAL BY CONSTRUCTION, and that is the whole reason it is drawn this
 * way. With nothing inside it, the box takes the width its parent gives it, and its parent
 * is the column the library laid out at the width of the device — so the run follows a
 * caller who resizes their window without anything here being told a number. A run
 * composed from a width would be this file doing arithmetic about a terminal, and the one
 * measurement of a terminal on this surface is asked in one place (`console.ts`).
 */
function rule(): ReactNode {
  return node(Box, {
    borderStyle: BORDER,
    borderColor: ACCENT,
    borderBottom: false,
    borderLeft: false,
    borderRight: false,
  });
}
