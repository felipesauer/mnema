/**
 * THE PAGE OPENS CLEAN — and the whole of how is: everything on the screen is carried
 * INTO the scrollback, and the cursor goes back to the top.
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
 * IT IS ONE FUNCTION AND TWO CALLERS, and that is the other half of the design. The page
 * opens clean and the caller can ask for a clean one again; those are the same page and
 * therefore the same bytes, and what differs is only who writes them — the device
 * directly, before the layout is mounted, or the layout's own door once it is
 * (`console.ts`).
 */

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
 * The bytes that carry a page `rows` tall into the scrollback and come back to the top.
 *
 * The cursor is put on the LAST row first, and that is not decoration: a blank row
 * written anywhere above the bottom only moves the cursor down, so scrolling by a whole
 * page from wherever the cursor happens to be would carry away only the part of the
 * screen that is above it. From the bottom, `rows` of them scroll `rows`, whatever was
 * where.
 *
 * A terminal that reports no height gets nothing at all rather than a guess: there is no
 * page to carry, and a sequence written against a height nobody reported would be this
 * module inventing a device.
 */
export function carriedIntoTheScrollback(rows: number): string {
  if (rows <= 0) return '';
  return theLastRow(rows) + A_BLANK_ROW.repeat(rows) + THE_TOP;
}
