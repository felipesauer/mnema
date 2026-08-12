/**
 * THE PAGE'S LEFT EDGE — how many columns the console keeps to the left of everything it
 * SAYS, and what is drawn in them.
 *
 * IT IS ONE STATEMENT WITH THREE READERS, and that is the whole reason it is a module of
 * its own rather than three numbers in the layout. The margin is DRAWN by the layout
 * (`region.ts`), the roll is folded and measured against what is left of the width
 * (`console.ts`), and the arrangement at the top is chosen against the same number
 * (`session.ts`) — so a column the drawing spends and the arithmetic does not know about
 * is a row of the page folded where nobody expected it, which is the defect this surface
 * has paid for once already in the other direction (`area.ts`, `ABOVE_THE_PALETTE`).
 *
 * WHAT IT IS FOR is the thing a caller asked for by drawing it on a screenshot: a page
 * whose text is not jammed against the edge of the terminal, and a line down the margin
 * marking the region they are READING — the guide an editor draws down the left of a file.
 * The two are one decision, because the bar has to live somewhere and the somewhere is the
 * margin.
 *
 * THE BAR IS CHROME, AND CHROME OBEYS THE RENDERER. It carries the accent, so a terminal
 * that takes no colour — `NO_COLOR`, a pipe, a stream that says no — draws it with no hue
 * at all, and it still occupies its column. That is the same posture the rest of the
 * surface takes: what a reader without colour loses is the tone, never the structure.
 *
 * WHICH REGIONS IT REACHES, and why the third is left out. The top region and the middle
 * one are what the session SAYS — the arrangement it opens with and the roll of everything
 * after — so both sit inside the margin and share one width. The input area does not: its
 * two rules are drawn corner to corner, which is what makes the length of one the width
 * the process read off its device (`tests/support/screen.ts`), and the row being typed
 * begins at the left edge because the caret is a COLUMN into it — an inset there would be
 * arithmetic on the one number that has to be exact (`console.ts`, `Shown.column`).
 */

/**
 * The blank columns before the bar — the margin proper.
 *
 * TWO, and it is a number somebody chose rather than a measurement, so it is chosen out
 * loud: one column reads as an accident of the terminal and three is a page that has given
 * away four percent of the narrowest window this console draws on. It is what the console
 * this surface is measured against keeps to the left of what it says.
 */
export const BEFORE_THE_BAR = 2;

/** The bar's own column. One, because a rule is one glyph wide however tall it is. */
export const THE_BAR = 1;

/**
 * The column between the bar and the text.
 *
 * ONE, and it is the difference between a guide and a prefix: text against the bar reads
 * as though the bar were a character of it, which is what a quote block looks like and is
 * not what this is.
 */
export const AFTER_THE_BAR = 1;

/** How many columns of every page are the margin, whatever is drawn in them. */
export const THE_INSET = BEFORE_THE_BAR + THE_BAR + AFTER_THE_BAR;

/**
 * How wide the page is INSIDE the margin — what a line of the session is folded to,
 * measured at, and what the arrangement at the top is chosen to fit across.
 *
 * A WIDTH NOBODY REPORTED STAYS NOBODY'S. Zero in is zero out rather than a negative
 * number: it is the answer the whole surface gives about a device that said nothing (see
 * `console.ts`, `NO_WIDTH`), and everything downstream already reads it as *do not fold, do
 * not choose, do not guess*.
 */
export function insideTheMargin(columns: number): number {
  return Math.max(0, columns - THE_INSET);
}
