/**
 * THE PAGE'S LEFT EDGE — how many columns the console keeps to the left of everything it
 * SAYS, which is THE SAME NUMBER IT KEEPS TO THE RIGHT: none.
 *
 * IT IS ONE STATEMENT WITH THREE READERS, and that is the reason it is a module of its own
 * rather than a number in the layout. The margin is DRAWN by the layout (`region.ts`), the roll
 * is folded and measured against what is left of the width (`console.ts`), and the arrangement
 * at the top is chosen against the same number (`session.ts`) — so a column the drawing spends
 * and the arithmetic does not know about is a row of the page folded where nobody expected it,
 * which is the defect this surface has paid for once already in the other direction (`area.ts`,
 * `ABOVE_THE_PALETTE`).
 *
 * WHY IT IS ZERO. The margin was six columns because a purple guide ran down it, drawn beside
 * every row of the roll, marking the region a caller was reading. The guide is gone — what marks
 * where a caller's own words begin is a band behind each command, and what marks where an answer
 * begins is a glyph on its first row (`echo.ts`, `region.ts`) — and the six columns stayed as a
 * space nothing was drawn in, wider than the nothing there is on the right, where a row runs to
 * the edge the terminal gives it. The left edge is now the right one: the roll, the opening, the
 * rules and the row being typed all begin in the first column, so what a caller reads is aligned
 * on one line, and the transcript handed back to the shell is as wide as the page was.
 *
 * WHAT IT COSTS the page at the floor is nothing, and the arithmetic stays the expression it
 * was: the shortest window this console draws on is eighty columns (`floor.ts`) and the widest
 * thing drawn there is the drawing of the name at fifty (`presentation/banner.ts`).
 *
 * `tests/the-margins-are-the-same-width.test.ts` holds the two sides equal, measured on the
 * pseudo-terminal at widths from eighty to two hundred; a margin put back on one side only
 * turns it red.
 */
export const THE_INSET = 0;

/**
 * How far an ANSWER sits in from the edge of the roll, which is one level of the step this page
 * moves by (`presentation/plain.ts`, `INDENT`): the glyph that opens an answer takes the first
 * of the columns and the words after it begin on the second, and every row after the first sits
 * under those words. What an answer is folded to is the width inside the margin less these two,
 * so a row of it never reaches the edge the terminal would break it at.
 */
export const THE_ANSWER_INDENT = 2;

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

/**
 * How wide an ANSWER may be: the page inside its margin, less the indent every row of an answer
 * carries. The same rule about a width nobody reported — zero stays zero.
 */
export function insideAnAnswer(columns: number): number {
  const inside = insideTheMargin(columns);
  return inside === 0 ? 0 : Math.max(1, inside - THE_ANSWER_INDENT);
}
