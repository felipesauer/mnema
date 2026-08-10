/**
 * THE PAGE OPENS CLEAN, THE BOX OPENS AT THE TOP, AND THE INPUT SITS AT THE FOOT — and the
 * whole of how is: everything on the screen is carried INTO the scrollback, the cursor goes
 * back to the top, the opening is drawn there, and under it go as many rows with nothing on
 * them as it takes for the input area to end on the last row a caller has.
 *
 * A console that opens over whatever the caller's last command left behind opens in the
 * middle of somebody else's output, and this one draws a box: half a page of `git log`
 * above a frame reads as one thing rather than two. So the page is cleared. WHAT
 * "CLEARED" MEANS is the whole decision, and there are three ways to take it:
 *
 *   - THE ALTERNATE SCREEN, which is what a full-screen program takes and what the
 *     reference this box was drawn from takes. Refused, and it was refused before this:
 *     the alternate screen has NO SCROLLBACK, so whoever takes it has to build their own
 *     rolling — measured on the reference, which turns mouse tracking on in the same
 *     breath as it switches buffers — and it throws away everything the session said on
 *     the way out. This console prints REPORTS, and the terminal's own scrollback is the
 *     roller it was designed around (`region.ts`).
 *   - ERASING, which is `ESC[2J` for the screen and `ESC[3J` for the history above it.
 *     ⛔ The second is forbidden here and it is not a matter of taste: the history above
 *     the session belongs to the caller, and a product that reads a record has no
 *     business deleting the log of what they were doing before they opened it. The
 *     reference does not use it either (measured: zero occurrences). And the first is not
 *     wanted either, because what it does with the rows it erases is not the same on
 *     every emulator.
 *   - SCROLLING, which is this. Writing a row with nothing on it at the bottom of the
 *     page moves everything up by one, and the row that leaves the top goes into the
 *     scrollback — that is the ONE operation defined to feed it, which is exactly why its
 *     effect is the same everywhere. A page's worth of them carries the whole screen up,
 *     and the cursor comes back to the top of an empty one.
 *
 * SO NOTHING OF THE CALLER'S IS DESTROYED. It is above, one scroll away, in the order it
 * was written — which is the same promise the session makes about its own output when it
 * leaves. `tests/a-page-that-opens-clean.test.ts` reads it off a real terminal both ways:
 * what is on the screen, and what is in the bytes.
 *
 * ⚠️ AND THE ROWS WITH NOTHING ON THEM USED TO GO BEFORE THE OPENING. It was written here in
 * those words — *the blank rows go BEFORE the opening, so what the session says fills the
 * page downwards and the input area ends where a caller's eye already is* — and the input
 * really did end at the foot. WHAT FALSIFIED IT IS WHERE THE EMPTINESS THEN WAS: measured on
 * a real terminal at a hundred and twenty by forty, the page opened with twenty-one blank
 * rows at the TOP and the box pushed down against the input, so the first thing a reader
 * looks at was the last thing on the screen. The anchoring was right and the direction was
 * not. The rows go UNDER the opening now: the box is at the top, the input is at the foot,
 * and the emptiness is between them, which is where emptiness costs a reader nothing
 * (`tests/the-gap-goes-under-the-box.test.ts` reads both off a real screen).
 *
 * ⚠️ AND IT WAS WRITTEN DOWN BEFORE THAT THAT ANCHORING REQUIRED TAKING THE SCREEN, which is
 * the premise the anchoring itself falsified and it is still false. The study that designed
 * this console recorded, as a decision left open, that *anchoring the input at the foot is
 * what the reference does by taking the alternate screen, and there is no cheap third way
 * with this library*. That reasoning assumed anchoring meant filling the rows AFTER the
 * input, which makes the region the layout redraws as tall as the viewport — the one
 * condition under which the library erases the caller's history. Filling above it costs
 * nothing of the sort, and it costs nothing of the sort whether the rows go over the opening
 * or under it. The argument against the alternate screen above is untouched.
 *
 * SO THE ROWS ARE LINES OF THE FLOW AND NO LONGER BYTES OF THIS FILE, and that is forced
 * rather than chosen: the opening is drawn by the LAYOUT, after these bytes have been
 * written, so nothing written here can land under it. What this file answers is how MANY
 * there are; the console hands them to the layout as lines with nothing on them, in the part
 * of the page that is written once and never taken back ({@link blankRows}).
 *
 * THE ROW UNDER THE AREA IS THE LAYOUT'S, and it is the one row the flow stops short of.
 * It is the same row `area.ts` keeps so that the region is redrawn in PART
 * ({@link BELOW_THE_VIEWPORT}) — read here rather than counted again, which is also what
 * makes the arithmetic below safe: the drawing of the name is chosen so that the opening,
 * the area and that row fit (`session.ts`), so there is never less room than there is page.
 * Measured, on a real terminal: the library writes a newline after the last row of its
 * frame, so a flow that ended on the very last row would scroll the screen by one and land
 * in exactly the same place — one row of the caller's history carried away for nothing.
 *
 * IT IS ONE FUNCTION AND TWO CALLERS, and that is the other half of the design. The page
 * opens clean and the caller can ask for a clean one again; those are the same page and
 * therefore the same bytes, and what differs is only who writes them — the device
 * directly, before the layout is mounted, or the layout's own door once it is
 * (`console.ts`). A page turned for a caller who resized their window is the third, and it
 * is the one that has something to say already: what the session HAS said is part of the
 * flow, so it is counted with the opening.
 */

import { BELOW_THE_VIEWPORT } from './area.js';

/**
 * One escape byte, written as an escape.
 *
 * Like every other unusual byte in this repository's sources: a control character typed
 * into a source file is invisible in review and survives an edit made around it.
 */
const ESC = '\u001b';

/** A row with nothing on it. Written at the bottom of the page, it is what scrolls. */
const A_BLANK_ROW = '\n';

/** A line with nothing on it. Handed to the layout, it is a row of the page with nothing drawn. */
const A_BLANK_LINE = '';

/** What ends a sequence that puts the cursor somewhere. */
const PUT_THE_CURSOR = 'H';

/** Back to the top-left corner. It MOVES the cursor; it erases nothing. */
const THE_TOP = `${ESC}[${PUT_THE_CURSOR}`;

/** The first column of the last row, so that every row written after it scrolls. */
const theLastRow = (rows: number): string => `${ESC}[${rows};1${PUT_THE_CURSOR}`;

/**
 * WHERE THE FLOW HAS GOT TO AND HOW MUCH ROOM IS LEFT UNDER IT — the three numbers it takes
 * to answer how much of the page is still empty.
 *
 * Every one of them is ALREADY ANSWERED somewhere else, and that is the point of them
 * arriving as numbers: this module does one subtraction, and a second opinion about how tall
 * an opening is would be the count and the drawing coming apart.
 */
export interface ThePage {
  /**
   * How tall the caller's terminal is, asked of the DEVICE by whoever owns the streams
   * (`console.ts`).
   */
  readonly rows: number;
  /**
   * HOW MANY ROWS OF THE FLOW ARE ON THE SCREEN — everything written since the page was
   * carried away, in rows rather than in lines.
   *
   * ⚠️ IT WAS TWO FIELDS, `opening` AND `said`, and they were the same question asked in
   * halves: the flow is what the page opens with plus what has been said under it, and a
   * caller who had to add them up before asking was a caller who could get the addition
   * wrong. It is one number now, and the two callers of {@link theGap} differ in exactly
   * how they know it — one has just written the flow and can count it, the other knows
   * where the flow ENDS because the area was anchored against it (`console.ts`).
   *
   * IT IS ROWS AND NOT LINES, and the difference is a line the terminal folds: a landed line
   * arrives already folded to the width the session started at (`presentation/folded.ts`), so
   * it is one row until a caller NARROWS their window, and after that it can be two. What the
   * difference costs is a page anchored a row or two low, which the terminal absorbs by
   * scrolling — the area is still at the foot, and what goes past the top is what a longer
   * session would have carried up anyway.
   */
  readonly flow: number;
  /** How many rows the region the layout redraws takes (`area.ts`, `Area.height`). */
  readonly area: number;
}

/**
 * HOW MANY ROWS WITH NOTHING ON THEM GO UNDER THE FLOW, so that the area ends on the last
 * row the layout leaves to it.
 *
 * ONE SUBTRACTION AND NO NUMBER OF ITS OWN: the page is what the flow has taken plus the
 * area, the row under it is the layout's, and what is left over is empty. Nothing fits into
 * a negative number of rows, so a page that already fills the screen gets none — which is
 * the behaviour this surface had before there were any, and the case is the same one rather
 * than a new branch.
 *
 * TWO CALLERS ASK IT AND THEY ASK THE SAME QUESTION, which is the whole reason it is one
 * function (`console.ts`):
 *
 *   - A PAGE THAT WAS JUST TURNED knows its flow by counting: the opening's rows and the
 *     lines the session had already said.
 *   - AND A SESSION WHOSE AREA GAVE ROWS BACK knows it by where the flow ENDS. The area is
 *     anchored against the flow, so the flow ends exactly `area + BELOW_THE_VIEWPORT` rows
 *     above the bottom — and when the area shrinks, that many rows are missing. Growing needs
 *     nothing: a frame that will not fit scrolls the screen, and the terminal puts it back at
 *     the foot by itself. Shrinking does not un-scroll anything, which is why this is asked
 *     on every frame and not only when a page is turned.
 *
 * THE HEIGHT CANCELS FOR THE SECOND CALLER, and that is what makes a resize safe here rather
 * than a fourth number: it passes a flow worked out from the same `rows` this subtracts, so
 * what is left is the difference between the two areas whatever the window did. A window that
 * changed size is answered by turning the page (`console.ts`), which is the first caller.
 */
export function theGap(page: ThePage): number {
  return Math.max(0, page.rows - page.flow - page.area - BELOW_THE_VIEWPORT);
}

/**
 * HOW MANY ROWS OF FLOW THERE ARE ABOVE AN AREA THAT IS AT THE FOOT — the second caller's way
 * of knowing where the flow got to, counted back from the bottom of the screen.
 *
 * IT IS THE SAME ARITHMETIC READ THE OTHER WAY ROUND, and it is a function rather than a
 * subtraction spelled out at the call site so that this file stays the only one that reads how
 * many rows under the area are not the flow's ({@link BELOW_THE_VIEWPORT}). Once a page has been
 * placed the flow ends exactly there — because the leftover put it there, or, on a page too full
 * for a leftover, because the terminal scrolled it there — so a console that knows how tall the
 * area WAS knows how much flow is above it without counting a row.
 *
 * WHAT IT BUYS IS THAT THE HEIGHT CANCELS: handed to {@link theGap} beside the height it was
 * worked out from, what is left is the difference between the two areas and nothing about the
 * window. So a caller whose window changed size in the same breath is not answered with rows it
 * did not ask for — a window that changed size is answered by turning the page (`console.ts`).
 */
export function theFlowAbove(rows: number, area: number): number {
  return rows - area - BELOW_THE_VIEWPORT;
}

/**
 * The gap as the layout receives it: that many lines with nothing on them.
 *
 * ⛔ THEY GO IN WHAT IS KEPT AND NOT IN WHAT IS REDRAWN, which is the whole safety of them.
 * They are lines of the FLOW — the part of the page written once and never taken back — and
 * not rows of the frame, so the region stays exactly as tall as the area and the height at
 * which the library gives up on redrawing PART of the screen (and erases the caller's history
 * on the way) is as far away as it was. Asserted from both ends: the region is the same size
 * on a tall terminal as on a short one, and the erase is bracketed at the height where one row
 * more IS it (`tests/the-gap-goes-under-the-box.test.ts`).
 */
export function blankRows(many: number): readonly string[] {
  return Array.from({ length: many }, () => A_BLANK_LINE);
}

/**
 * The bytes that carry a page into the scrollback and come back to the top, so the opening
 * is drawn on an empty screen.
 *
 * The cursor is put on the LAST row first, and that is not decoration: a blank row
 * written anywhere above the bottom only moves the cursor down, so scrolling by a whole
 * page from wherever the cursor happens to be would carry away only the part of the
 * screen that is above it. From the bottom, `rows` of them scroll `rows`, whatever was
 * where.
 *
 * ⚠️ IT USED TO END WITH THE LEFTOVER, and that is what put the emptiness at the top of the
 * screen. Nothing written here can land under the opening, because the opening is the
 * layout's to draw and it is drawn after these bytes — so the leftover left this file
 * altogether and is answered as a count ({@link theGap}) for the console to hand over as
 * lines. What survives is the half that was never about the direction: the rows are the
 * FLOW's, wherever they go.
 *
 * A terminal that reports no height gets nothing at all rather than a guess: there is no
 * page to carry, and a sequence written against a height nobody reported would be this
 * module inventing a device.
 */
export function carriedIntoTheScrollback(rows: number): string {
  if (rows <= 0) return '';
  return theLastRow(rows) + A_BLANK_ROW.repeat(rows) + THE_TOP;
}
