/**
 * WHAT IS ON THE SCREEN — a terminal's own answer, worked out from the bytes it received.
 *
 * Everything else this surface is tested by asks what was WRITTEN. That is the right
 * question for a line: a line is bytes, and a golden holds them. It is the wrong question
 * for a PAGE. "The console opens with nothing of the caller's above it" is a statement
 * about the twenty-four rows a person is looking at, and a byte stream cannot answer it —
 * the caller's output is in the stream either way, because it was written before the
 * session started. What tells the two apart is whether it is still in the viewport, and
 * only a screen has one.
 *
 * SO THIS IS A SCREEN, and it is deliberately the smallest one that can answer: a grid,
 * a cursor, and the sequences this product and its layout library actually write —
 * moving, erasing a row, erasing the display, and the newline at the bottom that scrolls.
 * A row that scrolls off the top is GONE from it, which is exactly the fact under test:
 * it went into the scrollback, which is not the screen and is not this model's business.
 *
 * IT IS AN INSTRUMENT, AND IT IS PROVED BEFORE IT IS BELIEVED. A model that quietly did
 * nothing would say the page is clean about every page there is, so the case that uses it
 * renders the screen from BEFORE the session opened and finds the caller's output on it
 * (`tests/a-page-that-opens-clean.test.ts`).
 *
 * ⚠️ AND IT USED TO SAY THAT ANYTHING IT DID NOT UNDERSTAND WAS SKIPPED RATHER THAN
 * PRINTED, "which is the safe direction: an unhandled escape becomes nothing on the page
 * instead of becoming text that was never there". That is true of a glyph and it is the
 * OPPOSITE of true for a sequence that moves something. A scroll this model did not
 * perform leaves every row of its answer one out, and what a case then reads is a number
 * that is wrong for a reason nothing on the screen mentions — which is the shape of red
 * that costs a reviewer an afternoon. So skipping is now a NAMED list with a reason each
 * ({@link CHANGES_ONLY_HOW_IT_LOOKS}), and everything outside it is accused
 * (`tests/the-screen-says-what-it-was-drawn-at.test.ts`).
 *
 * ⚠️ AND THE OTHER HALF: A REPLAY IS NOT A TERMINAL, and the size is the seam. This model
 * is handed the size the CASE asked for, and the bytes were written by a process that read
 * the size from a DEVICE. When those two are not the same number, every row under the first
 * thing that folds is off — and the case fails on a count, which says nothing about the
 * disagreement that produced it. The frame the console opens with is drawn corner to corner
 * (`src/repl/panel.ts`), so the width the process read is ON THE PAGE: it is measured here
 * ({@link everyWidthDrawnOn}) and it has to be one of the widths this screen was replayed
 * at, or the replay is accused instead of the product.
 */

/** One escape byte, written as an escape so no control byte enters a source file. */
const ESC = '\u001b';

/** What a row is made of before anything is written on it. */
const BLANK = ' ';

/**
 * WHAT A FRAME IS DRAWN OUT OF — the run, and the four corners it ends at.
 *
 * Spelled by code point rather than typed, like every other unusual glyph in this
 * repository: a run is one keystroke away from a hyphen and a corner from its mirror, and a
 * character a reader cannot tell from a neighbouring one is a character an edit destroys
 * without anybody seeing it happen.
 */
const RUN = '\u2500';
/** The two corners a horizontal edge BEGINS at: the box's top-left and its bottom-left. */
const OPENS_AN_EDGE = '\u256d\u2570';
/** The two it ENDS at: the top-right and the bottom-right. */
const CLOSES_AN_EDGE = '\u256e\u256f';

/** Whether a glyph — or the nothing off the end of the page — is one of `of`. */
function isOneOf(glyph: string | undefined, of: string): boolean {
  return glyph !== undefined && of.includes(glyph);
}

/**
 * EVERY WIDTH THE PAGE WAS DRAWN AT, read off the drawing rather than off a number.
 *
 * THE FRAME IS THE WITNESS. The box the console opens with is drawn corner to corner and
 * the input area's rules run the whole way across (`src/repl/panel.ts`, `src/repl/area.ts`),
 * so the distance from one end of an edge to the other IS the width the process read off
 * its device. Nothing here knows what that number ought to be; it answers what is there.
 *
 * THE ROWS ARE JOINED because a row wider than the screen does not stop at the screen: it
 * carries on at the first column of the next one, which is what a terminal does and what
 * {@link screenOf} models. Joined, an edge is contiguous whether it fitted or not, so the
 * measurement works in BOTH directions — a frame narrower than the replay ends in blanks,
 * and one wider than it ends on the row below.
 *
 * WHAT COUNTS AS AN EDGE is a maximal run of {@link RUN}, and what it is worth depends on
 * what bounds it:
 *
 *   - CORNER TO CORNER — the box's bottom edge. Its width is the run and the two corners.
 *   - NEITHER END A CORNER — one of the input area's rules, which has none. Its width is
 *     the run itself.
 *   - ONE END ONLY — the box's TOP edge, which the title cuts in two. Neither half is a
 *     width and neither is counted: a page that offered them would be offering two numbers
 *     that are each smaller than the terminal, and a wrong witness is worse than none.
 */
export function everyWidthDrawnOn(rows: readonly string[]): readonly number[] {
  const page = rows.join('');
  const widths: number[] = [];
  for (let at = 0; at < page.length; ) {
    if (page[at] !== RUN) {
      at += 1;
      continue;
    }
    let end = at;
    while (end < page.length && page[end] === RUN) end += 1;
    const opens = isOneOf(page[at - 1], OPENS_AN_EDGE);
    const closes = isOneOf(page[end], CLOSES_AN_EDGE);
    if (opens && closes) widths.push(end - at + 2);
    else if (!opens && !closes) widths.push(end - at);
    at = end;
  }
  return widths;
}

/**
 * ACCUSES A SCREEN REPLAYED AT A WIDTH NOTHING ON IT WAS DRAWN AT.
 *
 * ONE WITNESS IS ENOUGH, and that is deliberate rather than lax. A page can honestly hold
 * two widths at once: a session opened at a hundred and twenty columns and narrowed to
 * seventy leaves the old drawing above, folded, and those rows are a true record of a
 * terminal that really was that wide (`tests/the-input-has-its-own-place.test.ts` says so
 * where it reads the rules by position rather than by counting them). What may not happen
 * is NOTHING on the page having been drawn at the width it is being read at — that is a
 * replay and a process that never agreed about the device, and every row under the first
 * fold is out by the difference.
 *
 * A page with no frame on it is not accused and cannot be: a screen the box has scrolled
 * off says nothing about a width, and an instrument that guessed would be inventing one.
 */
function theWidthIsTheOneItWasDrawnAt(rows: readonly string[], columns: number): void {
  const drawn = everyWidthDrawnOn(rows);
  if (drawn.length === 0 || drawn.includes(columns)) return;
  const measured = [...new Set(drawn)].sort((one, other) => one - other).join(', ');
  throw new Error(
    `this screen was replayed ${columns} columns wide and nothing on it was drawn that wide: ` +
      `the frame's own edges measure ${measured}. The box and the rules are drawn corner to ` +
      `corner, so the width of an edge IS the width the process read off its device. Whether ` +
      `that device was the size the case asked for is answered where the session is driven — ` +
      `\`support/pty.ts\` accuses it there — so if nothing was said there, the console drew at ` +
      `a width the terminal never reported; and if this screen is simply being read at a size ` +
      `the run was never driven at, the case is asking the wrong question. Either way an ` +
      `assertion about a row further down is out by whatever the difference folds, and that ` +
      `off-by-one is the SYMPTOM rather than the finding.`,
  );
}

/**
 * THE SEQUENCES THIS MODEL DELIBERATELY DOES NOTHING ABOUT, and the reason it is safe to do
 * nothing about them.
 *
 *   - `m` — SGR, which is colour and weight. It changes how a glyph LOOKS and never where
 *     one goes, and this model answers what is on the page rather than what colour it is.
 *
 * A private sequence (`ESC[?…`) never reaches this: it is a mode being switched, and a mode
 * changes nothing on the page either.
 *
 * MEASURED RATHER THAN GUESSED AT: a session that opens at a hundred by thirty, lists the
 * words a slash offers and leaves writes eight distinct finals — `H`, `h`, `l`, `m`, `A`,
 * `B`, `G` and `K` — and every one but `m` is acted on below. So this list is one letter
 * long because there is one letter to put in it, not because the rest were never looked for.
 */
const CHANGES_ONLY_HOW_IT_LOOKS = 'm';

/** A screen, as a reader would see it. */
export interface Screen {
  /** Every row, top first, each exactly as wide as the terminal. */
  readonly rows: readonly string[];
  /** The same rows with their trailing blanks off, joined — what a reader reads. */
  readonly text: string;
  /**
   * WHERE THE CARET IS LEFT, in rows from the top of the screen and columns from its
   * left edge.
   *
   * It is on the model because it is the only way to ask a question this surface now
   * makes: the row being typed stopped being the first of the redrawn ones, so "the caret
   * is where the caller is typing" is an offset the product works out (`repl/area.ts`) and
   * the layout is told. Nothing but a screen can say where it ended up — the bytes say
   * `up three rows`, and how many rows there were is exactly what is under test.
   */
  readonly cursor: { readonly row: number; readonly column: number };
}

/** Where the cursor is, and what is under it. */
interface Grid {
  readonly cells: string[][];
  row: number;
  column: number;
}

/** Replays `bytes` onto a screen `columns` by `rows`, and answers with what is on it. */
export function screenOf(bytes: string, columns: number, rows: number): Screen {
  const grid: Grid = {
    cells: Array.from({ length: rows }, () => Array.from({ length: columns }, () => BLANK)),
    row: 0,
    column: 0,
  };
  for (let at = 0; at < bytes.length; at++) {
    const byte = bytes[at] as string;
    if (byte === ESC) {
      at = sequence(bytes, at, grid, columns, rows);
      continue;
    }
    printable(byte, grid, columns, rows);
  }
  const lines = grid.cells.map((cells) => cells.join(''));
  // THE ONE PLACE THE SIZE IS CHECKED, and it is here rather than at the three dozen call
  // sites for the reason the A3 amarra is about: a rule read in two places is a rule that
  // comes apart, and a case added tomorrow would be a site that forgot. Everything that
  // reads a screen of this surface reads it from here.
  theWidthIsTheOneItWasDrawnAt(lines, columns);
  return {
    rows: lines,
    text: lines.map((line) => line.replace(/ +$/, '')).join('\n'),
    cursor: { row: grid.row, column: grid.column },
  };
}

/** Puts one ordinary byte on the grid. */
function printable(byte: string, grid: Grid, columns: number, rows: number): void {
  if (byte === '\n') {
    // The output side of a terminal turns a newline into a new row at column one, which
    // is what `onlcr` does and what every pty this is read from has on.
    grid.column = 0;
    down(grid, rows);
    return;
  }
  if (byte === '\r') {
    grid.column = 0;
    return;
  }
  // Every other control byte is skipped rather than drawn: a tab, a bell or a backspace
  // that became a character would be text on the page that nobody wrote.
  if (byte < ' ') return;
  if (grid.column >= columns) {
    grid.column = 0;
    down(grid, rows);
  }
  (grid.cells[grid.row] as string[])[grid.column] = byte;
  grid.column += 1;
}

/** One row further down, scrolling the whole page when there is no further down. */
function down(grid: Grid, rows: number): void {
  if (grid.row + 1 < rows) {
    grid.row += 1;
    return;
  }
  grid.cells.shift();
  grid.cells.push(Array.from({ length: (grid.cells[0] as string[]).length }, () => BLANK));
}

/**
 * Acts on the escape sequence starting at `at`, and answers with the index of its last
 * byte.
 *
 * Only the CSI family is understood, which is the only family this product's layout writes.
 * A private sequence (`ESC[?…`) is a mode being switched and changes nothing on the page.
 *
 * ⚠️ ANYTHING ELSE USED TO BE STEPPED OVER, and the header of this file says what falsified
 * that: a sequence outside CSI is not a sequence that does nothing. `ESC M` scrolls the page
 * backwards, `ESC 7` and `ESC 8` put the cursor somewhere and fetch it back, and `ESC ]`
 * opens a string that runs until its own terminator — stepped over one byte at a time, the
 * TITLE inside it is printed onto the page as text nobody wrote. So it is accused, which is
 * the only answer that cannot be wrong: this model does not have to grow a case for a
 * sequence the product does not write, it has to stop pretending it read one.
 */
function sequence(bytes: string, at: number, grid: Grid, columns: number, rows: number): number {
  if (bytes[at + 1] !== '[') {
    // A lone escape at the very end of the bytes is a slice taken mid-sequence and not a
    // sequence: there is nothing after it to have been misread.
    if (at + 1 >= bytes.length) return bytes.length;
    throw new Error(
      `this screen was replayed from bytes holding an escape outside the CSI family — ` +
        `ESC ${JSON.stringify(bytes.slice(at + 1, at + 8))} — which this model does not ` +
        `understand and therefore did not perform. What is above is a page the terminal ` +
        `never showed, so anything read off it is about the model rather than the product.`,
    );
  }
  let end = at + 2;
  while (end < bytes.length && /[0-9;?]/.test(bytes[end] as string)) end += 1;
  const final = bytes[end];
  if (final === undefined) return bytes.length;
  const body = bytes.slice(at + 2, end);
  if (body.startsWith('?')) return end;
  const numbers = body.split(';').map((part) => (part === '' ? undefined : Number(part)));
  const first = numbers[0] ?? 1;
  switch (final) {
    case 'A':
      grid.row = Math.max(0, grid.row - first);
      break;
    case 'B':
      grid.row = Math.min(rows - 1, grid.row + first);
      break;
    case 'C':
      grid.column = Math.min(columns - 1, grid.column + first);
      break;
    case 'D':
      grid.column = Math.max(0, grid.column - first);
      break;
    case 'G':
      grid.column = Math.min(columns - 1, Math.max(0, first - 1));
      break;
    case 'H':
    case 'f':
      grid.row = Math.min(rows - 1, Math.max(0, first - 1));
      grid.column = Math.min(columns - 1, Math.max(0, (numbers[1] ?? 1) - 1));
      break;
    case 'J':
      eraseDisplay(numbers[0] ?? 0, grid, columns, rows);
      break;
    case 'K':
      eraseRow(numbers[0] ?? 0, grid, columns);
      break;
    default:
      // NOT A DEFAULT THAT DOES NOTHING. Every final above moves something or erases
      // something, and so do the ones that are not here — `S` and `T` scroll, `L` and `M`
      // open and close rows, `r` sets the region a scroll happens in. A model that shrugged
      // at them would answer with a page that is right everywhere except by a row, which is
      // the one kind of wrong nothing on the screen shows.
      if (!CHANGES_ONLY_HOW_IT_LOOKS.includes(final)) {
        throw new Error(
          `this screen was replayed from bytes holding ESC[${body}${final}, which this model ` +
            `does not act on. It is not one of the sequences that only change how a glyph ` +
            `LOOKS (${CHANGES_ONLY_HOW_IT_LOOKS}), so the page above is one the terminal ` +
            `never showed and anything read off it is about the model rather than the ` +
            `product. Give it a case here, or say here why it moves nothing.`,
        );
      }
      break;
  }
  return end;
}

/** Erases part of the page: from the cursor down, up to it, or all of it. */
function eraseDisplay(how: number, grid: Grid, columns: number, rows: number): void {
  // 3 is the SCROLLBACK, which is not on the screen and therefore not modelled — and it
  // is the one sequence this product refuses to write at all.
  if (how === 3) return;
  const blank = (row: number): void => {
    grid.cells[row] = Array.from({ length: columns }, () => BLANK);
  };
  if (how === 2) {
    for (let row = 0; row < rows; row++) blank(row);
    return;
  }
  if (how === 1) {
    for (let row = 0; row < grid.row; row++) blank(row);
    eraseRow(1, grid, columns);
    return;
  }
  for (let row = grid.row + 1; row < rows; row++) blank(row);
  eraseRow(0, grid, columns);
}

/** Erases part of the row the cursor is on: to its end, to its start, or all of it. */
function eraseRow(how: number, grid: Grid, columns: number): void {
  const cells = grid.cells[grid.row] as string[];
  const from = how === 0 ? grid.column : 0;
  const to = how === 1 ? grid.column + 1 : columns;
  for (let column = from; column < to; column++) cells[column] = BLANK;
}
