/**
 * THE PAGE OPENS CLEAN, THE BOX OPENS AT THE TOP, AND THE INPUT SITS AT THE FOOT — and the
 * whole of how is: everything on the screen is carried INTO the scrollback, the cursor goes
 * back to the top, the opening is drawn there, and under it go as many rows with nothing on
 * them as it takes for the input area to end on the last row a caller has.
 *
 * A console that opens over whatever the caller's last command left behind opens in the
 * middle of somebody else's output, and this one draws the name: half a page of `git log`
 * above a wordmark reads as one thing rather than two. ⚠️ IT SAID *a box*, and the frame is
 * gone; what the argument needs is that the opening is a DRAWING, and it still is. So the page
 * is cleared. WHAT
 * "CLEARED" MEANS is the whole decision, and there are three ways to take it:
 *
 *   - THE ALTERNATE SCREEN, which is what a full-screen program takes and what the
 *     reference this console was drawn from takes. Refused, and it was refused before this:
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
 *
 *     ⚠️ *NOT WANTED* WAS TRUE OF WHAT THIS FILE WRITES AND FALSE OF WHAT REACHES THE
 *     CALLER, and the difference is a sequence somebody ELSE asks for. The layout library
 *     starts the page over with both of them in one write when the region it last drew is
 *     as tall as the window the caller now has, so refusing to write them left them
 *     reaching the terminal anyway. They are TRANSLATED now rather than refused
 *     ({@link theEraseAsAScroll}): the screen erase becomes the scroll below, which is
 *     the same empty screen by this file's own third way, and the history erase becomes
 *     nothing at all. Refusing the second ALONE is not available and it is not a
 *     preference either — the two arrive in one write, and a library that believes it
 *     cleared the page paints over rows that are still on it.
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
 * rows at the TOP and the opening pushed down against the input, so the first thing a reader
 * looks at was the last thing on the screen. The anchoring was right and the direction was
 * not. The rows go UNDER the opening now: the panel is at the top, the input is at the foot,
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
 * SO THE ROWS ARE NO LONGER BYTES OF THIS FILE, and that is forced rather than chosen: the
 * opening is drawn by the LAYOUT, after these bytes have been written, so nothing written here
 * can land under it. What this file answers is how MANY there are; the drawing of them is the
 * layout's ({@link theGap}).
 *
 * ⚠️ AND THEY WERE LINES OF THE FLOW, which is the premise this delivery falsified. It was
 * written here in those words — *they go in what is KEPT and not in what is redrawn, which is
 * the whole safety of them: the region stays exactly as tall as the area, and the height at
 * which the library gives up on redrawing PART of the screen is as far away as it was*. The
 * safety was real; the anchoring was not, because THE AREA CHANGES HEIGHT. A list of words opens
 * twenty rows tall, a region that grows scrolls the screen, and what scrolls off the top is in
 * the scrollback for good — nothing un-scrolls. Measured on a real terminal at a hundred and
 * twenty by forty: ONE opening and shutting of the list, and the box was gone and did not come
 * back. The rows that were landed to make up the difference were empty ones, because the flow is
 * written once and what went up cannot be pulled down.
 *
 * SO THE ROWS ARE THE REGION'S, and that is what makes the area grow without pushing anything:
 * the list takes its room out of the LEFTOVER instead of out of the screen — twenty-one rows of
 * nothing become one while the area goes from five to twenty-five — so the region's whole height
 * does not move and nothing scrolls at all. The leftover was always the room the area could take;
 * it was in the wrong half of the page.
 *
 * AND WHAT SCROLLED AWAY IS REMEMBERED, WHICH IS THE ONE THING A REDRAWN LEFTOVER STILL NEEDS. A
 * page whose flow and frame together outgrow the screen loses rows off the top, and nothing brings
 * them back — so the flow this subtracts is the flow ON THE SCREEN and not the flow the session
 * has said ({@link ThePage.flow}). Measured, before it was: at a hundred by thirty a list opened
 * and shut left the input fourteen rows above the foot, on a page that had scrolled thirteen rows
 * away and been placed as though it had not. ⚠️ AND OUTGROWING THE SCREEN WAS NAMED AS THE WAY IT
 * HAPPENS, which is one of two: a terminal the caller made SHORTER anchors what is on it at the
 * foot, so the top of the flow goes into the scrollback with nothing written at all
 * (`console.ts`, `whatTheWindowTook`).
 *
 * AND THE BOUNDARY IS KEPT BY THE ROW IT WAS ALWAYS KEPT BY, which is why this costs the erase
 * nothing. The region is the leftover and the area, and the leftover is what is left over after
 * {@link BELOW_THE_VIEWPORT} — so `gap + area` is at most `rows − flow − 1`, one row short of the
 * height at which the library redraws the whole screen, at every height and with the flow as
 * short as a flow gets. Measured across nine heights and bracketed
 * (`tests/the-gap-goes-under-the-box.test.ts`).
 *
 * ⛔ AND THAT IS TRUE OF THE HEIGHT A FRAME IS DRAWN AT AND OF NO OTHER, which is the premise a
 * window the caller makes SHORTER falsifies. The sentence above says *at every height*, and what
 * it can only mean is every height the page was drawn ON: the library decides whether to redraw
 * the whole screen by comparing the frame it LAST drew against the viewport the caller has NOW,
 * so a region that was one row short of the screen it was written on is over the boundary the
 * moment that screen becomes shorter — and nothing this file counts can prevent it, because the
 * comparison is against a frame that is already on the page. Measured on the binary over
 * twenty-six pairs, and the rule has no exception: the erase appears exactly when the region last
 * drawn is as tall as the new window. From forty rows the frontier is at twenty-three, which is
 * the region a page that has just opened leaves; after a shrink that carries the flow off the top,
 * ONE row is enough.
 *
 * AND THE HOLE IS CLOSED WITHOUT THE COMPARISON MOVING, which is the whole shape of the answer:
 * the library goes on asking at exactly the same frontier, and what it asks for is answered on the
 * way out instead of being avoided on the way in ({@link theEraseAsAScroll}). The rule above is
 * still the rule — it is what says WHICH windows ask — and what changed is that asking no longer
 * costs the caller anything: the erase is nought on every pair of the frontier, and what was on
 * the screen is in the scrollback rather than gone (`tests/the-page-follows-the-terminal.test.ts`,
 * *a window made SHORTER asks for the erase, and the caller's history survives it*).
 *
 * THE ROW UNDER THE AREA IS THE LAYOUT'S, and it is the one row the page stops short of.
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

/** What ends a sequence that puts the cursor somewhere. */
const PUT_THE_CURSOR = 'H';

/**
 * WHAT ERASES THE SCREEN THE SESSION IS ON — every row of it, in place.
 *
 * It is not this file's way of emptying a page and never was: what a terminal does with the
 * rows it erases is not defined, so the rows are simply not there any more on some emulators
 * and blanked in place on others. This product empties a page by SCROLLING it
 * ({@link carriedIntoTheScrollback}), which is the one operation whose effect is the same
 * everywhere. It is named here because the LIBRARY writes it, and something has to answer.
 */
const ERASES_THE_SCREEN = `${ESC}[2J`;

/**
 * ⛔ WHAT ERASES THE CALLER'S HISTORY — the rows above the screen, which a scroll put there and
 * nothing brings back.
 *
 * It is the one sequence this product refuses, for the reason at the top of this file, and the
 * refusal is now enforced on the way OUT rather than by nobody writing it: this is the string the
 * door looks for ({@link theEraseAsAScroll}), which is why the module that explains the refusal is
 * also the only one that names it (`tests/the-console-on-ink.test.ts`).
 */
const ERASES_THE_HISTORY = `${ESC}[3J`;

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
   * HOW MANY ROWS OF THE FLOW ARE ON THE SCREEN — and the words mean exactly what they say: the
   * rows a reader can SEE, in rows rather than in lines.
   *
   * ⚠️ IT USED TO BE EVERYTHING WRITTEN SINCE THE PAGE WAS CARRIED AWAY, which is a different
   * number the moment anything scrolls — and the leftover moving into the frame is what made the
   * difference matter. A page whose flow and frame together outgrow the screen loses rows off the
   * TOP, for good; a leftover subtracted from the flow the console HOLDS would then place the
   * frame that many rows short of the foot. Measured, at a hundred by thirty and at eighty by
   * twenty-four: a list of words opened and shut left the input fourteen and seventeen rows above
   * the foot. So what the caller hands over is what the screen still has (`console.ts`,
   * `flowOnScreen`), and this file does the same subtraction over it.
   *
   * ⚠️ IT WAS TWO FIELDS, `opening` AND `said`, and they were the same question asked in
   * halves: the flow is what the page opens with plus what has been said under it, and a
   * caller who had to add them up before asking was a caller who could get the addition
   * wrong. It is one number now, and it is FOLLOWED rather than added up — it grows by what
   * lands, it is capped by what the frame left room for, and it gives up what a window the
   * caller made SHORTER carried off the top, all of them in the console that asks
   * (`console.ts`, `whatTheWindowTook`). ⚠️ THE COUNT SAID *both of them* and there are three: a
   * terminal that shrinks anchors its content at the foot, so rows leave the screen for a reason
   * that has nothing to do with what the page outgrew — measured as the input left as many rows
   * above the foot as the window lost, in every pair where the flow was longer than the loss.
   *
   * ⚠️ AND IT WAS KNOWN A SECOND WAY, which went with the premise above: a frame whose area had
   * given rows back worked the flow out BACKWARDS, from where the area was anchored, because
   * the rows it was anchored with were part of the flow and nobody had counted them. Nothing is
   * anchored against anything now — the leftover is redrawn with the area on every frame — so
   * there is one way to know the flow, which is the one that was always the honest one.
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
 * HOW MANY ROWS WITH NOTHING ON THEM GO BETWEEN THE FLOW AND THE AREA, so that the area ends
 * on the last row the layout leaves to it.
 *
 * ONE SUBTRACTION AND NO NUMBER OF ITS OWN: the page is what the flow has taken plus the
 * area, the row under it is the layout's, and what is left over is empty. Nothing fits into
 * a negative number of rows, so a page that already fills the screen gets none — which is
 * the behaviour this surface had before there were any, and the case is the same one rather
 * than a new branch.
 *
 * ONE CALLER ASKS IT, ON EVERY FRAME, and it is the frame itself: the leftover is drawn with
 * the area, above it, in the region the layout redraws (`console.ts`, `region.ts`). So the
 * answer is never remembered and never repaired — a list of words that opens takes its rows
 * out of this subtraction, and one that shuts gives them back to it, both of them by the
 * area's height changing and this being asked again.
 *
 * ⚠️ IT USED TO HAVE TWO CALLERS, and the second one is what this delivery removed. The rows
 * were the FLOW's, so they could only ever be APPENDED: a page that was just turned counted
 * its own flow and got them, and a session whose area had shrunk had to work the flow out
 * backwards from where the area was anchored, so that the difference could be landed as more
 * of them. That repair is what a leftover redrawn every frame makes impossible to need, and
 * what it was repairing — a page whose top had already scrolled away — it could not undo.
 */
export function theGap(page: ThePage): number {
  return Math.max(0, page.rows - page.flow - page.area - BELOW_THE_VIEWPORT);
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

/**
 * BYTES ON THEIR WAY TO THE CALLER'S TERMINAL, WITH THE ERASE WRITTEN THIS PRODUCT'S WAY — the
 * screen erase as the scroll above, and the history erase as nothing at all.
 *
 * IT IS HERE BECAUSE SOMEBODY ELSE ASKS FOR IT. Every other way this file empties a page is a
 * page this file was asked for; this one is the LAYOUT LIBRARY starting the page over on its own,
 * out of its own memory of the frame it last drew, and it decides that before anything of this
 * surface runs at the new size (`console.ts`, {@link ThePage}). So there is no frame to compose
 * differently and no size to ask again: the only place left is the one the bytes have to pass
 * through on the way out, and this is the answer they are given there.
 *
 * TRANSLATED AND NOT DROPPED, and the difference is what the library then believes. It writes the
 * page again immediately after, out of everything it was keeping, and it writes it from the top —
 * so a screen erase merely taken away leaves the old rows underneath the new ones, which is a page
 * with two pages on it. The scroll answers the same request honestly: the screen really is empty
 * afterwards, the cursor really is at the top, and what was on it is ABOVE rather than gone.
 *
 * THE TWO ARE ONE DECISION AND STILL TWO RULES, which is what makes this total rather than a
 * pattern match. They arrive in one write today (`ansi-escapes`, `clearTerminal`: the screen, the
 * history, then the top-left corner), so a rule about the contiguous three would answer today's
 * library and nothing else. A rule per sequence answers whatever order they come in, either of
 * them alone, and both of them split across two writes — and the composition over the sequence the
 * library actually writes is exactly one scroll followed by the corner it asked for.
 *
 * ⛔ WHAT IT CANNOT ANSWER is a sequence split INSIDE itself: a caller who wrote `ESC[` in one
 * call and `3J` in the next would get both through, because this reads one call's worth of bytes
 * and holds nothing between them. Nothing writes that way — the library concatenates one constant
 * into one write and this surface writes the output of one function — and the measurement is the
 * proof rather than the claim: the erase is nought across every pair of the frontier, which a
 * library that split its own sequence would not be
 * (`tests/the-page-follows-the-terminal.test.ts`).
 *
 * A page nobody reported a height for is a page there is nothing to scroll, which
 * {@link carriedIntoTheScrollback} already answers with nothing — so a request to erase the
 * screen on a device that says nothing about itself is dropped rather than guessed at. It cannot
 * arrive: the library reaches this path only after comparing its frame against a viewport it read
 * off a terminal.
 */
export function theEraseAsAScroll(bytes: string, rows: number): string {
  // THE COMMON CASE IS EVERY FRAME OF EVERY SESSION, so it is one scan and no allocation: a
  // keystroke's frame has neither sequence in it, and what this function is for happens at most
  // twice for a window the caller resized.
  if (!bytes.includes(ERASES_THE_SCREEN) && !bytes.includes(ERASES_THE_HISTORY)) return bytes;
  return bytes
    .split(ERASES_THE_SCREEN)
    .join(carriedIntoTheScrollback(rows))
    .split(ERASES_THE_HISTORY)
    .join('');
}
