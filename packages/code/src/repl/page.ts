/**
 * THE PAGE OPENS CLEAN AND IT OPENS AT THE FOOT — and the whole of how is: everything on
 * the screen is carried INTO the scrollback, the cursor goes back to the top, and then as
 * many blank rows as it takes for the input to end up on the last row a caller has.
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
 * AND THE INPUT SITS AT THE FOOT OF IT, which is the same operation asked once more. The
 * page used to be drawn from the top, so a session opened on a tall terminal put the row
 * being typed in the middle of the screen with nothing under it. What is under it now is
 * nothing at all: the blank rows go BEFORE the opening, so what the session says fills the
 * page downwards and the input area ends where a caller's eye already is.
 *
 * ⚠️ IT WAS WRITTEN DOWN THAT THIS REQUIRED TAKING THE SCREEN, and it was wrong. The study
 * that designed this console recorded, as a decision left open, that *anchoring the input at
 * the foot is what the reference does by taking the alternate screen, and there is no cheap
 * third way with this library*. What falsified it is the direction: that reasoning assumed
 * anchoring meant filling the rows AFTER the input, which makes the region the layout
 * redraws as tall as the viewport — the one condition under which the library erases the
 * caller's history. Filling BEFORE it costs nothing of the sort. The argument against the
 * alternate screen above is untouched and still the reason this console does not take it;
 * what fell is only the belief that the two came together.
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
 * flow, so it is counted with the opening ({@link ThePage.said}).
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

/** What ends a sequence that puts the cursor somewhere. */
const PUT_THE_CURSOR = 'H';

/** Back to the top-left corner. It MOVES the cursor; it erases nothing. */
const THE_TOP = `${ESC}[${PUT_THE_CURSOR}`;

/** The first column of the last row, so that every row written after it scrolls. */
const theLastRow = (rows: number): string => `${ESC}[${rows};1${PUT_THE_CURSOR}`;

/**
 * THE PAGE THAT IS ABOUT TO BE DRAWN, as the four numbers it takes to place it.
 *
 * Every one of them is ALREADY ANSWERED somewhere else, and that is the point of them
 * arriving as numbers: this module writes bytes and does one subtraction, and a second
 * opinion about how tall an opening is would be the count and the drawing coming apart.
 */
export interface ThePage {
  /**
   * How tall the caller's terminal is, asked of the DEVICE by whoever owns the streams
   * (`console.ts`).
   */
  readonly rows: number;
  /**
   * How many rows what the page OPENS with takes, folds counted — the box and the lines
   * under it (`panel.ts`, `Opening.rows`).
   */
  readonly opening: number;
  /**
   * How many lines the session has SAID since the page opened, one row each.
   *
   * IT IS A COUNT OF LINES AND NOT OF ROWS, and the difference is a line the terminal
   * folds: a landed line arrives already folded to the width the session started at
   * (`presentation/folded.ts`), so it is one row until a caller NARROWS their window, and
   * after that it can be two. What the difference costs is a page anchored a row or two low,
   * which the terminal absorbs by scrolling — the area is still at the foot, and what goes
   * past the top is what a longer session would have carried up anyway. What it buys is the
   * whole of the resized case: a page turned with fifteen lines already on it and the flow
   * counted as though there were none would carry the box and half of what the caller was
   * reading into the scrollback (measured at a hundred by thirty: twelve rows).
   */
  readonly said: number;
  /** How many rows the region the layout redraws takes (`area.ts`, `Area.height`). */
  readonly area: number;
}

/**
 * HOW MANY BLANK ROWS GO BEFORE THE OPENING, so that the flow ends on the last row the
 * layout leaves to it.
 *
 * ONE SUBTRACTION AND NO NUMBER OF ITS OWN: the page is what the opening takes plus what
 * has been said plus the area, the row under it is the layout's, and what is left over is
 * blank. Nothing fits into a negative number of rows, so a page that already fills the
 * screen gets none — which is the behaviour this surface had before there were any, and the
 * case is the same one rather than a new branch.
 */
function beforeTheOpening(page: ThePage): number {
  return Math.max(0, page.rows - page.opening - page.said - page.area - BELOW_THE_VIEWPORT);
}

/**
 * The bytes that carry a page into the scrollback, come back to the top, and leave the
 * cursor where the opening has to start for the input to end up at the foot.
 *
 * The cursor is put on the LAST row first, and that is not decoration: a blank row
 * written anywhere above the bottom only moves the cursor down, so scrolling by a whole
 * page from wherever the cursor happens to be would carry away only the part of the
 * screen that is above it. From the bottom, `rows` of them scroll `rows`, whatever was
 * where.
 *
 * THE BLANK ROWS AFTER THE TOP ARE THE OTHER KIND, and the same character does both because
 * the terminal does: at the bottom of the page a blank row SCROLLS, and on a page that is
 * already empty it only moves the cursor down. So nothing above the flow is written over and
 * nothing extra is carried away — the rows the flow does not reach are blank because the
 * page was carried away, not because something was drawn on them.
 *
 * ⛔ AND THEY GO OUTSIDE THE REGION THE LAYOUT REDRAWS, which is the whole safety of it.
 * They are bytes of the FLOW — the part of the page that is written once and never taken
 * back — and not rows of the frame, so the region stays exactly as tall as the area and the
 * height at which the library gives up on redrawing PART of the screen (and erases the
 * caller's history on the way) is as far away as it was. Asserted from both ends: the region
 * is the same size on a tall terminal as on a short one, and the erase is bracketed at the
 * height where one row more IS it (`tests/the-prompt-sits-at-the-foot.test.ts`).
 *
 * A terminal that reports no height gets nothing at all rather than a guess: there is no
 * page to carry, and a sequence written against a height nobody reported would be this
 * module inventing a device.
 */
export function carriedIntoTheScrollback(page: ThePage): string {
  if (page.rows <= 0) return '';
  return (
    theLastRow(page.rows) +
    A_BLANK_ROW.repeat(page.rows) +
    THE_TOP +
    A_BLANK_ROW.repeat(beforeTheOpening(page))
  );
}
