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

import { aside, fact, subjectLine } from '../presentation/detail.js';
import type { Line } from '../presentation/line.js';
import type { Render } from '../presentation/render.js';

/**
 * THE SHORTEST WINDOW THIS CONSOLE DRAWS ON: eighty columns by fifty-one rows.
 *
 * THE ROWS WERE TWENTY-FOUR, and the argument was the CANONICAL TERMINAL: eighty by
 * twenty-four is what a terminal has been since the VT100, it is what every emulator opens at,
 * and it is what a tmux pane, an editor's embedded terminal and an ssh session are cut from.
 * That is a true sentence about terminals and it was never a statement about THIS console. What
 * replaced it is a definition a caller gave, in one line: *the smallest terminal is the one
 * where the name is drawn whole*. The floor is not the size the field settled on — it is the
 * size at which this product still shows what it is.
 *
 * FIFTY-ONE, AND IT IS MEASURED RATHER THAN CHOSEN. The height was searched for by driving the
 * built binary on a real pseudo-terminal at eighty columns, one row at a time, and reading
 * which drawing came back: the nine-row drawing of the name first appears at fifty-one rows and
 * the five-row one is what forty to fifty get. The arithmetic behind that number is the budget
 * that was already there and was not touched — at eighty columns the arrangement holding the
 * big drawing is the stacked one and costs seventeen rows, a fixed region may hold one part in
 * three of the screen (`panel.ts`, `A_THIRD`), and three times seventeen is fifty-one.
 *
 * AND THE COLUMNS DID NOT MOVE, because the measurement did not ask them to. The biggest
 * drawing is fifty columns wide and the page's own margin takes six (`inset.ts`), so the
 * drawing is inside the page at fifty-six; eighty is kept, which is the width every ladder on
 * this surface was measured across.
 *
 * WHAT IT COSTS IS DECLARED, and it is the reason this number is written here rather than
 * discovered. A window of twenty-four or thirty rows — a tmux pane, an editor's embedded
 * terminal, a default ssh session — no longer draws a console at all: it draws the screen
 * below, which says the size it has and the size this console needs. Two ways of keeping those
 * windows were offered and refused: loosening the share a fixed region may hold so the big
 * drawing fits in about thirty rows, and two floors, one per width. The floor is one number and
 * it is where the name is drawn.
 *
 * WHAT IT BUYS IS AN ASSUMPTION. Every ladder above this floor may now be written for a
 * screen that is at least this big, instead of degrading for ever towards a page nobody would
 * accept. What the bottom rungs of those ladders become is a question for the delivery that
 * moves them, not something this file may quietly decide — so nothing below the floor was
 * removed with it.
 *
 * AND ONE LADDER IS NOW ANSWERED AT ITS TOP RUNG FOR THE PAGE THIS WAS MEASURED ON, which is
 * a consequence to name rather than a property to claim. The drawing gives way by height when
 * the arrangement around it would bust its share, and the floor is exactly the height at which
 * it stops doing so — so on a page of the weight measured here, no window above the floor is
 * ever given a smaller drawing. It is not inert: what the arrangement costs is a function of
 * what the record SAYS — a project with a third tree spends a row more, and its big drawing
 * wants fifty-four — so a heavier page still walks the ladder above this floor
 * (`tests/the-floor-is-where-the-name-is-drawn.test.ts` pins both halves).
 */
export const THE_FLOOR = { columns: 80, rows: 51 } as const;

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
