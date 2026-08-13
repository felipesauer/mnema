/**
 * A FLOOR UNDER THE WINDOW — the shortest terminal this console draws a page on, and what a
 * window under it is shown instead.
 *
 * EVERYTHING ELSE ON THIS SURFACE GIVES WAY. The drawing of the name gives way to a smaller
 * one, the arrangement at the top gives way to the same lines on the roll, the input area
 * drops its badge and then its rules, the list of words shows fewer and says how many it could
 * not (`presentation/banner.ts`, `panel.ts`, `area.ts`, `palette.ts`). Every one of those
 * ladders was written to be TOTAL: whatever the size, there is a rung. That is what this file
 * takes away, and the reason is what the bottom rungs turned out to be — a page with no
 * arrangement, no badge, no rules and one word of a list is not a smaller console, it is a
 * prompt with the product's identity gone from the screen.
 *
 * AND FORCING THE WINDOW IS OUT. The sequence exists — `CSI 8 ; height ; width t`, which
 * asks a terminal to resize its text area — and it is refused here on two grounds rather than
 * one. It is DISABLEABLE by whoever built the terminal, and the field's own security guidance is
 * that a terminal should refuse to implement it at all, for the reason a web page may not resize
 * a browser window; and the terminal this product is developed on is VTE, which had a
 * denial-of-service exactly there (CVE-2024-37535). A program whose layout depends on being
 * allowed to move somebody's window is a program built on a permission nobody gave it. So
 * nothing here writes a byte to a terminal, and no module of this session emits that sequence —
 * asserted over the sources rather than promised (`tests/a-floor-under-the-window.test.ts`).
 *
 * SO THE ANSWER IS THE ONE THE FIELD CONVERGED ON: ask, and say what is missing. Below the
 * floor the console does not draw a worse page — it draws THIS one, which says the size the
 * window has, the size the console needs, and which of the two measurements falls short.
 *
 * IT IS A SCREEN AND NOT A REFUSAL, and every part of that is deliberate. The session stays
 * open, nothing is written to the record, nothing is read again, and the page comes back BY
 * ITSELF when the window grows — because somebody who drags an edge by accident may not lose
 * the session for it. What they had said is untouched: the roll is kept by the console
 * (`scrolling.ts`) and a window under the floor is a frame drawn OVER it, never a clearing of
 * it.
 *
 * NOTHING HERE IS PAINTED. The lines are composed as lines and turned into bytes by the frame's
 * own renderer, exactly as the list of words is (`palette.ts`), so `NO_COLOR` silences this
 * screen the way it silences everything else this product prints (`wiring/color.ts`).
 */

import { THE_BIGGEST_DRAWING, widthOfTheDrawing } from '../presentation/banner.js';
import { aside, fact, subjectLine } from '../presentation/detail.js';
import type { Line } from '../presentation/line.js';
import type { Render } from '../presentation/render.js';
import { THE_INSET } from './inset.js';
import { besideTheMark, rowsOfTheForm, theShortestScreenFor } from './panel.js';

/**
 * THE WIDTH EVERY LADDER ON THIS SURFACE WAS MEASURED ACROSS, and the one number of the floor
 * that is chosen rather than worked out.
 *
 * It is the width the panel's three forms, the input area's arrangements, the palette's list
 * and the hint under the prompt were all measured at, and it is what a terminal has been since
 * the VT100. The drawing does not dispute it — it is narrower than this with the page's margin
 * counted ({@link theFloorFor}) — so what this number really says is *no page is laid out
 * narrower than the width everything else on this surface was designed against*.
 */
const MEASURED_ACROSS = 80;

/**
 * WHERE THE SESSION IS STANDING, in rows: one.
 *
 * It is one line whatever it knows — the project and the identity are clauses of a single aside
 * (`session.ts`, `standingLine`) — so this is a shape of the page rather than a count of
 * anything a record holds.
 */
const THE_PLACE = 1;

/**
 * WHAT THE RECORD IS, in rows: its heading, and one row per tree of a project — which is two,
 * the public one and the private one (`session.ts`, `recordSection`).
 *
 * IT IS THE ONE PART OF THE FLOOR THAT IS A FACT ABOUT A PAGE rather than about the drawing,
 * and it is declared here instead of being folded into a total. A project with a third tree
 * spends a row more and its big drawing wants a screen three rows taller — so the floor is the
 * height the name is drawn at on the page a project HAS, not on every page there could be, and
 * a heavier one still walks the ladder above this floor. That is the same declared cost the
 * number carried when it was written down, said where the row is counted rather than in a
 * sentence about the number.
 *
 * MEASURED ON THE PAGE RATHER THAN BELIEVED: the arrangement at the floor is read off a real
 * console's own seam and compared with what this file works out
 * (`tests/the-floor-is-where-the-name-is-drawn.test.ts`), so a page that stopped costing this
 * is red rather than a floor quietly in the wrong place.
 */
const THE_RECORD_SAID = 3;

/** The shortest window this console draws a page on, on both measurements. */
export interface Floor {
  /** How wide, in columns. */
  readonly columns: number;
  /** How tall, in rows. */
  readonly rows: number;
}

/**
 * THE SHORTEST WINDOW A GIVEN DRAWING OF THE NAME IS STILL DRAWN WHOLE ON — the floor, as a
 * function of the art.
 *
 * THE ROWS WERE TWENTY-FOUR, and the argument was the CANONICAL TERMINAL: eighty by
 * twenty-four is what a terminal has been since the VT100, it is what every emulator opens at,
 * and it is what a tmux pane, an editor's embedded terminal and an ssh session are cut from.
 * That is a true sentence about terminals and it was never a statement about THIS console. What
 * replaced it is a definition a caller gave, in one line: *the smallest terminal is the one
 * where the name is drawn whole*.
 *
 * AND THE DEFINITION ARRIVED AS A NUMBER, WHICH IS THE PREMISE THIS FUNCTION TOOK AWAY. The
 * height was searched for by driving the built binary on a real pseudo-terminal at eighty
 * columns, one row at a time, and written down: fifty-one, with the arithmetic behind it in
 * prose — nine rows of drawing, an arrangement of seventeen, and a third of the screen. Every
 * word of that was true and none of it was CHECKED, so the day the drawing changed the floor
 * did not: a nine-row drawing became a six-row one and fifty-one was suddenly a floor nine rows
 * above where the name is drawn whole, which is a window this console refuses to draw on for no
 * reason at all. It is the class this console has already paid for three times — a number of
 * geometry worked out once and read by somebody who is not of that instant — and the answer is
 * the same one every time: ask.
 *
 * SO THE HEIGHT IS THE SHARE, READ BACKWARDS. What refuses a drawing is that its arrangement
 * would hold more than one part in three of the screen (`panel.ts`, `A_THIRD`), so the shortest
 * screen it is kept on is three times what that arrangement costs — and what it costs is asked
 * of the panel's own arithmetic ({@link rowsOfTheForm}, {@link besideTheMark}) rather than added
 * up here.
 *
 * THE ARRANGEMENT IS THE STACKED ONE, and that is a measurement rather than an assumption. At
 * the floor's width the drawing and the text cannot sit side by side: the two columns want the
 * drawing, four columns of gap and the widest row of the text — which is a path — and that is
 * past what the page has inside its margin. So the mark's rows are ADDED to the text's rather
 * than shared with them, which is the expensive of the two shapes and therefore the honest one
 * to define a floor with.
 *
 * AND THE COLUMNS ARE DERIVED TOO, which they were not while they were a number. The drawing
 * has to be inside the page, and the page keeps a margin (`inset.ts`), so the width has to be at
 * least the art plus that margin: forty-eight and six is fifty-four, which is under the width
 * everything else was measured at ({@link MEASURED_ACROSS}), so eighty is what comes back. A
 * drawing wider than seventy-four would move it, and nothing about this sentence is a promise —
 * it is the expression.
 *
 * WHAT THE FLOOR COSTS IS DECLARED. A window of twenty-four or thirty rows — a tmux pane, an
 * editor's embedded terminal, a default ssh session — draws no console at all: it draws the
 * screen below, which says the size it has and the size this console needs. Two ways of keeping
 * those windows were offered and refused: loosening the share a fixed region may hold, and two
 * floors, one per width. The floor is one pair and it is where the name is drawn.
 *
 * WHAT IT BUYS IS AN ASSUMPTION. Every ladder above this floor may be written for a screen
 * that is at least this big, instead of degrading for ever towards a page nobody would accept.
 * What the bottom rungs of those ladders become is a question for the delivery that moves them,
 * not something this file may quietly decide — so nothing below the floor was removed with it.
 *
 * AND ONE LADDER IS ANSWERED AT ITS TOP RUNG FOR THE PAGE THIS IS DEFINED AGAINST, which is a
 * consequence to name rather than a property to claim. The drawing gives way by height when the
 * arrangement around it would bust its share, and the floor is exactly the height at which it
 * stops doing so — so on a page of this weight, no window above the floor is ever given a
 * smaller drawing. It is not inert: what the arrangement costs is a function of what the record
 * SAYS ({@link THE_RECORD_SAID}), so a heavier page still walks the ladder above this floor
 * (`tests/the-floor-is-where-the-name-is-drawn.test.ts` pins both halves).
 */
export function theFloorFor(drawing: readonly Line[]): Floor {
  return {
    columns: Math.max(MEASURED_ACROSS, widthOfTheDrawing(drawing) + THE_INSET),
    rows: theShortestScreenFor(
      rowsOfTheForm('stacked', drawing.length, besideTheMark(THE_PLACE, THE_RECORD_SAID)),
    ),
  };
}

/**
 * THE SHORTEST WINDOW THIS CONSOLE DRAWS ON: eighty columns by forty-two rows.
 *
 * IT WAS EIGHTY BY FIFTY-ONE, and no decision about windows was taken to move it. The drawing
 * of the name went from nine rows to six ({@link THE_BIGGEST_DRAWING}), the arrangement round it
 * from seventeen to fourteen, and three times fourteen is forty-two: nine rows of window given
 * back to a caller by a delivery about art. That is the whole of what deriving it buys — the
 * number is a consequence of the drawing, and a drawing edited without this file being opened
 * moves it.
 *
 * ANSWERED ONCE, AT MODULE SCOPE, because the art is a constant: nothing about the drawing
 * depends on a terminal, so the floor is one arithmetic rather than one per frame.
 */
export const THE_FLOOR: Floor = theFloorFor(THE_BIGGEST_DRAWING);

/**
 * DOES THIS WINDOW SERVE? — the one place the floor is applied, over the pair the device
 * answered with.
 *
 * ONE FUNCTION AND ONE CALLER, which is the shape this bench asks for wherever a rule has to
 * hold in more than one place: the console asks it while it builds a frame (`console.ts`,
 * `showing`), and every other number on that frame is worked out on the far side of the answer.
 * A second site comparing a size with the floor would be a second floor, and the two would
 * disagree the first time one of them moved.
 *
 * BOTH MEASUREMENTS, AND THE PAIR COMES OUT OF ONE READING OF THE DEVICE. A window that is wide
 * enough and not tall enough fails, and so does the reverse: the page is three regions down the
 * screen and a table across it, so neither measurement can stand in for the other.
 *
 * A DEVICE THAT REPORTED NOTHING IS UNDER THE FLOOR, which is the same posture the rest of this
 * surface takes about the same silence — a size nobody reported is not a size to guess at, and
 * nought is not eighty.
 */
export function theWindowServes(columns: number, rows: number): boolean {
  return columns >= THE_FLOOR.columns && rows >= THE_FLOOR.rows;
}

/** What the floor screen is drawn from: the window it is drawn on, and how a line becomes bytes. */
export interface FloorRequest {
  /** How wide the window is, out of the one reading the frame was built from. */
  readonly columns: number;
  /** How tall it is, out of the same reading. */
  readonly rows: number;
  /**
   * How a line becomes bytes on a screen of THIS width — the frame's own renderer.
   *
   * It is handed in rather than resolved here for the reason the palette's is: a screen
   * composed with a renderer for another width would fold its own sentences somewhere else,
   * and this is the one screen whose whole subject is the width.
   */
  readonly render: Render;
}

/** How a size is said, in the order a terminal says it: across, then down. */
function sizeSaid(columns: number, rows: number): string {
  return `${columns}x${rows}`;
}

/** How many of something there are, with the word in the number's own form. */
function count(many: number, one: string, more: string): string {
  return `${many} ${many === 1 ? one : more}`;
}

/**
 * WHICH OF THE TWO MEASUREMENTS FALLS SHORT, and by how much.
 *
 * IT IS THE HALF A NUMBER ALONE DOES NOT GIVE. A screen that says *make your window bigger*
 * makes the reader guess which edge to drag and how far, and a screen that says only what it
 * needs makes them measure what they have. Both are on the page above this line; this says what
 * the difference IS, which is the same thing every refusal of this product does — say what
 * happened and where.
 *
 * BOTH, WHEN BOTH DO: a window dragged into a corner is short across AND down, and naming one
 * of the two would send the reader back for the other.
 */
function whatFallsShort(columns: number, rows: number): string {
  const short: string[] = [];
  if (columns < THE_FLOOR.columns) {
    short.push(count(THE_FLOOR.columns - columns, 'column', 'columns'));
  }
  if (rows < THE_FLOOR.rows) short.push(count(THE_FLOOR.rows - rows, 'row', 'rows'));
  return `${short.join(' and ')} short`;
}

/**
 * WHAT A WINDOW UNDER THE FLOOR IS SHOWN — the heading, the two sizes, what falls short, and
 * the promise that nothing was lost.
 *
 * FIVE LINES, SHORTEST FIRST IN IMPORTANCE. A window under the floor can be under it by a
 * long way, so the frame this goes into clips what does not fit (`region.ts`) — and what is
 * clipped from the foot has to be the part a reader needs least. The heading and the two
 * numbers are the answer; the sentence at the end is the reassurance.
 *
 * THE LAST LINE IS THE ONE THAT KEEPS THIS A SCREEN. A reader looking at a page that stopped
 * being the console has no way of knowing whether their session is still there, and one that
 * guesses wrong kills it.
 */
function theFloorSaid(columns: number, rows: number): readonly Line[] {
  return [
    subjectLine('The window is too small for the console'),
    fact(`this window: ${sizeSaid(columns, rows)}`),
    fact(`the console needs: ${sizeSaid(THE_FLOOR.columns, THE_FLOOR.rows)}`),
    fact(whatFallsShort(columns, rows)),
    aside('The session is still open: make the window bigger and the console comes back.'),
  ];
}

/**
 * The floor screen for a window of a given size, already bytes — what the layout draws instead
 * of the three regions.
 *
 * Pure, and asked on the frame that needs it: what it says is a function of the size and of
 * nothing else, so there is nothing to keep between frames and nothing to go stale. It reads no
 * record, exactly like everything else a frame of this console is built out of.
 */
export function theFloorScreenFor(request: FloorRequest): readonly string[] {
  return theFloorSaid(request.columns, request.rows).map(request.render);
}
