/**
 * THE PAGE'S LEFT EDGE — how many columns the console keeps to the left of everything it
 * SAYS.
 *
 * IT IS ONE STATEMENT WITH THREE READERS, and that is the whole reason it is a module of
 * its own rather than three numbers in the layout. The margin is DRAWN by the layout
 * (`region.ts`), the roll is folded and measured against what is left of the width
 * (`console.ts`), and the arrangement at the top is chosen against the same number
 * (`session.ts`) — so a column the drawing spends and the arithmetic does not know about
 * is a row of the page folded where nobody expected it, which is the defect this surface
 * has paid for once already in the other direction (`area.ts`, `ABOVE_THE_PALETTE`).
 *
 * WHAT IT IS FOR is a page whose text is not jammed against the edge of the terminal. THERE
 * WAS A GUIDE DOWN IT: a purple line the width of one column, drawn beside every row of the roll,
 * marking the region a caller was reading. It is gone, and the margin is the width it had with
 * the guide in it, so not a column of the page moved: what marks where a caller's own words
 * begin is now a band behind each command, and what marks where an answer begins is a glyph on
 * its first row (`echo.ts`, `region.ts`).
 *
 * WHICH REGIONS IT REACHES, and why the third is left out. The top region and the middle
 * one are what the session SAYS — the arrangement it opens with and the roll of everything
 * after — so both sit inside the margin and share one width. The input area does not: its
 * two rules are drawn corner to corner, which is what makes the length of one the width
 * the process read off its device (`tests/support/screen.ts`), and the row being typed
 * begins at the left edge because the caret is a COLUMN into it — an inset there would be
 * arithmetic on the one number that has to be exact (`console.ts`, `Shown.column`).
 *
 * SIX, AND IT WAS FOUR PLUS THE GUIDE PLUS ONE. Four is the column the row under the prompt
 * begins at plus one level, which is the step this page moves by and the only unit of
 * horizontal distance it has: the hint is an `aside`, so it sits one indent in
 * (`presentation/plain.ts`, `INDENT`), and what the page says begins clear of it rather than on
 * it. It costs the page nothing at the floor, which is the half a number chosen for its looks
 * would not have: the shortest window this console draws on is eighty columns (`floor.ts`), the
 * widest thing drawn inside the margin there is the drawing of the name at fifty
 * (`presentation/banner.ts`), and the margin leaves seventy-four.
 */
export const THE_INSET = 6;

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
