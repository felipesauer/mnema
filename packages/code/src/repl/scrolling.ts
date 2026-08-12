/**
 * WHAT THE SESSION HAS SAID, AND WHICH PART OF IT A READER IS LOOKING AT — the roll the
 * console keeps, now that the terminal no longer keeps one for it.
 *
 * THE CONSOLE TAKES THE SCREEN, and taking the screen takes the scrollback with it: the
 * alternate screen buffer has none, on purpose, which is exactly why a full-screen program
 * uses it — nothing it draws lands in the caller's own history. So the roll is OURS. What
 * a terminal used to do for free — keep what left the top, and give it back when somebody
 * scrolled — is this file.
 *
 * ⚠️ IT WAS REFUSED FOR THAT REASON AND THE REFUSAL IS REVOKED, and the argument was not
 * wrong, it was incomplete. It said: *the alternate screen has no scrollback, so whoever
 * takes it has to build their own rolling, and it throws away everything the session said
 * on the way out*. Both halves are still true. What changed is that the first half became a
 * REQUIREMENT — the middle region of the page is where the scroll works, and the caller
 * asked for it in those words — and the second half acquired a fix: the whole of this is
 * written to the caller's own buffer when the session leaves ({@link theTranscript}). A
 * refusal whose cost became a requirement is not a refusal any more.
 *
 * THREE THINGS LIVE HERE AND NOTHING ELSE DOES: the lines, a ceiling over them, and how far
 * back a reader has walked. Nothing here draws, nothing here measures a terminal, and
 * nothing here knows what a line says — a line arrives as bytes a renderer already produced,
 * exactly as it does everywhere else on this surface.
 *
 * HOW FAR BACK IS COUNTED FROM THE TAIL, and that is the decision the rest falls out of.
 * Counted from the TOP it would have to be corrected every time the ceiling dropped a line, and
 * a correction that is forgotten is a view that jumps under a reader's eyes; counted from the
 * tail, *following the tail* is the single value nought rather than a flag beside a number that
 * can disagree with it, and the ceiling costs nothing.
 *
 * ⚠️ AND THE FIRST VERSION OF THAT SENTENCE ENDED *so dropping the oldest line moves nothing at
 * all*, WHICH LEFT OUT THE END IT MATTERS AT. A distance from the tail is a distance from
 * something that MOVES: land a line and the same number names the line after the one a reader
 * was looking at, so five lines landing walked their page five lines forward — which is exactly
 * the jump this whole value exists to prevent. It went red in the case that lands while a reader
 * has walked back. What it costs to fix is one line ({@link landedIn}): a reader who has walked
 * back walks one further for every line that lands, so the CONTENT under their eyes is what
 * stands still. A reader at the tail is left at nought, because the tail is where the new line
 * went and following it is what they asked for by not walking away from it.
 */

import { withoutSequences } from '../presentation/folded.js';

/**
 * HOW MANY LINES THE CONSOLE KEEPS — and what falls off the top when there are more.
 *
 * TEN THOUSAND, and the number is a decision rather than an accident. A roll of our own is
 * MEMORY of our own: unbounded, a session that runs for a day and prints is a leak with a
 * pleasant name. The market has already chosen, and it chose a range rather than a number —
 * a thousand lines is the narrowest default in it and ten thousand the widest.
 *
 * THIS PRODUCT TAKES THE WIDEST, and the reason is what the roll is FOR. Reading a record is
 * the whole of what this console does, and copying what it said is an audit's own gesture —
 * so a ceiling that bites is output an auditor asked for and did not get. Ten thousand lines
 * is about a megabyte of the caller's memory at the width a terminal has, which is a price
 * this process can pay once; a thousand is four screenfuls of `timeline` and would bite in an
 * ordinary afternoon.
 *
 * ⛔ AND WHAT FALLS OFF IS NOT THE RECORD. What this holds is what was SHOWN — bytes on their
 * way to a screen. The record is in `.mnema/`, signed, and every line above can be read back
 * out of it by the verb that produced it. The ceiling costs a reader a scroll, never a fact.
 *
 * LINES AND NOT PARAGRAPHS, which is the same call every terminal makes and for the reason
 * the one this product is read on writes down: its own roll operates on rows because the
 * features of a terminal are built around rows, and a roll of paragraphs makes an overlong
 * one unbounded again. What a line costs to SHOW is a different question, asked at the width
 * of the moment and nowhere else ({@link theWindowOn}).
 */
export const THE_CEILING = 10_000;

/** What the session has said, and where in it the reader is standing. */
export interface Scrolling {
  /**
   * Every line the session has said that the console still holds, oldest first, never
   * rewritten and never longer than {@link THE_CEILING}.
   */
  readonly said: readonly string[];
  /**
   * HOW MANY LINES BACK FROM THE TAIL the reader has walked, and NOUGHT when they have not.
   *
   * Nought is *following the tail* and it is not a second field, which is the whole of why
   * new output can neither jump a reader who is reading nor fail to reach one who is not: at
   * nought a line that lands is seen, and above nought it is counted, so what a reader has under
   * their eyes is the same words either way ({@link landedIn}).
   */
  readonly back: number;
}

/** A session that has said nothing, with the reader at the tail. */
export const NOTHING_SAID: Scrolling = { said: [], back: 0 };

/**
 * HOW MANY ROWS OF A SCREEN ONE LINE TAKES, at a given width.
 *
 * A LINE IS NOT A ROW, and the difference is a terminal that folds. Every line here arrives
 * already folded to the width the session opened at (`presentation/folded.ts`), so it is one
 * row until a caller NARROWS their window and two or more after that — and a window filled as
 * though every line were one row is a window taller than the region it is drawn in, which is
 * the one thing a frame on a screen we own may not be.
 *
 * THE ESCAPES COME OFF FIRST, because a terminal does not print them: a line carrying colour
 * is longer in bytes than it is in columns, and counting bytes would fold a line that fits.
 * What is left is counted in CODE POINTS, which is the same approximation the rest of this
 * surface makes about width — a glyph that takes two columns is counted as one, and what that
 * costs is a window one row short rather than one row over, which is the safe direction.
 *
 * ⚠️ AND A LINE CAN ALREADY BE SEVERAL ROWS BEFORE ANY TERMINAL FOLDS IT, which is the half the
 * first version of this left out. What lands here is what the product's own renderer produced,
 * and that renderer FOLDS: a report too wide for the session's window arrives with newlines
 * inside it, broken between words with the continuation indented (`presentation/folded.ts`). So
 * the parts are counted one by one and each of them is asked how many rows IT takes — a line
 * measured as one long run would be one number for something the screen draws as three. Measured:
 * the frame came out a row short of the terminal after a resize, which is a row of the caller's
 * screen nobody drew.
 *
 * A width nobody reported is a width to fold nothing at: one row per part, which is what this
 * answered before there was a fold to count.
 */
export function rowsForTheLine(line: string, columns: number): number {
  const parts = line.split('\n');
  if (columns <= 0) return parts.length;
  return parts.reduce(
    (rows, part) => rows + Math.max(1, Math.ceil([...withoutSequences(part)].length / columns)),
    0,
  );
}

/**
 * The session said one more line: it goes at the end, the ceiling takes the oldest when
 * there is no room, and the reader is left exactly where they were standing.
 *
 * ⛔ NOTHING HERE MOVES WHAT A READER IS LOOKING AT, and that is the promise the caller asked
 * for in as many words: content new to a session that is being READ may not pull the page out
 * from under whoever is reading it. A reader at the tail is at the tail afterwards, because the
 * tail is where the new line is; a reader who walked back is one line FURTHER back, which is the
 * same words on the same rows.
 */
export function landedIn(scrolling: Scrolling, line: string): Scrolling {
  const said = [...scrolling.said, line].slice(-THE_CEILING);
  // ONE LINE FURTHER BACK FOR A READER WHO HAD WALKED BACK, and none at all for one at the tail
  // — which is the same rule twice rather than a branch: what is held still is the CONTENT, and
  // at the tail the content that was there is the content the new line joins.
  //
  // AND THE CEILING NEEDS NOTHING BESIDE IT. When a line falls off the top for every line that
  // lands, the roll's length does not change and every surviving line's distance from the tail
  // is one greater — which is exactly what this adds, so the reader is left on the same words.
  const back = scrolling.back === 0 ? 0 : Math.min(backAtMost(said), scrolling.back + 1);
  return { said, back };
}

/** The furthest back a reader can walk: everything but the line the window opens on. */
function backAtMost(said: readonly string[]): number {
  return Math.max(0, said.length - 1);
}

/**
 * The reader, `by` lines further back — or forward, when it is negative. Clamped at both
 * ends, so nothing runs off either.
 *
 * ONE FUNCTION FOR EVERY KEY AND FOR THE WHEEL, which is what keeps a page's worth of
 * scrolling and a notch of a wheel from acquiring different ideas of where the ends are.
 * How MANY lines each of them is worth is the console's to say, because a page is a function
 * of how tall the region is and only the console has asked the device.
 */
export function scrolledBy(scrolling: Scrolling, by: number): Scrolling {
  const back = Math.max(0, Math.min(backAtMost(scrolling.said), scrolling.back + by));
  return back === scrolling.back ? scrolling : { ...scrolling, back };
}

/** The reader at the oldest line this console still holds. */
export function toTheTop(scrolling: Scrolling): Scrolling {
  return scrolledBy(scrolling, backAtMost(scrolling.said));
}

/** The reader back at the tail, following whatever lands next. */
export function toTheTail(scrolling: Scrolling): Scrolling {
  return scrolling.back === 0 ? scrolling : { ...scrolling, back: 0 };
}

/** Whether the reader is at the tail — which is whether new output will be seen. */
export function followingTheTail(scrolling: Scrolling): boolean {
  return scrolling.back === 0;
}

/**
 * WHAT A READER CAN SEE: the lines that fit in `room` rows, ending where the reader is
 * standing.
 *
 * IT IS TAKEN FROM THE END BACKWARDS, which is the direction the answer is anchored in. The
 * last line the reader is looking at is fixed — the tail, or `back` lines before it — and the
 * window grows UPWARDS from there until the next line would not fit. So a region that grew
 * shows more of what is above, a region that shrank shows less, and neither moves the line the
 * reader was last looking at.
 *
 * ROWS AND NOT LINES IS WHAT `room` MEANS, and the fold is counted per line
 * ({@link rowsForTheLine}): a window of ten rows holds ten lines on a wide terminal and five
 * on one half as wide, which is what a reader sees and therefore what this has to answer.
 *
 * A LINE THAT DOES NOT FIT ON ITS OWN IS STILL DRAWN, and that is the one place this gives up
 * the invariant it is otherwise keeping. A region two rows tall and a line that folds into
 * three is a choice between drawing nothing and drawing one row too many; drawing nothing is a
 * console that answers a scroll with an empty screen, and one row too many costs a frame the
 * library redraws whole. So the FIRST line is taken unconditionally and the rest are taken
 * only if they fit.
 */
export function theWindowOn(
  scrolling: Scrolling,
  room: number,
  columns: number,
): readonly string[] {
  if (room <= 0 || scrolling.said.length === 0) return [];
  const last = scrolling.said.length - Math.min(scrolling.back, backAtMost(scrolling.said));
  const window: string[] = [];
  let used = 0;
  for (let at = last - 1; at >= 0; at -= 1) {
    const line = scrolling.said[at] as string;
    const rows = rowsForTheLine(line, columns);
    if (window.length > 0 && used + rows > room) break;
    window.unshift(line);
    used += rows;
  }
  return window;
}

/** How many rows some lines take together, at a given width. */
export function rowsOfTheWindow(window: readonly string[], columns: number): number {
  return window.reduce((rows, line) => rows + rowsForTheLine(line, columns), 0);
}

/**
 * EVERYTHING THE SESSION SAID, FOR THE CALLER'S OWN BUFFER — what is written there once the
 * screen has been given back.
 *
 * IT IS WHAT THE REFUSAL PROTECTED. The console used to live in the caller's buffer, so the
 * session's output was in their history by construction and `grep` found it afterwards; a
 * console that takes the screen has to hand that back deliberately or the trade is a loss.
 * So this is written to `stdout` AFTER the alternate screen has been left — not as a last
 * frame and not through the layout library, which treats everything written while it is
 * tearing down as disposable and says so (`console.ts`, `theTranscript`).
 *
 * IT IS THE ROLL AND NOT A SECOND COPY, which is the whole reason the ceiling is honest: two
 * lists would be two ceilings, and the one nobody was watching would be the leak. What a
 * reader could scroll to is what the caller's history ends with, exactly.
 */
export function theTranscript(scrolling: Scrolling): readonly string[] {
  return scrolling.said;
}
