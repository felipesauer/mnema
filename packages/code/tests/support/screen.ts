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
 * (`tests/a-page-that-opens-clean.test.ts`). Anything it does not understand is skipped
 * rather than printed, which is the safe direction for the same reason: an unhandled
 * escape becomes nothing on the page instead of becoming text that was never there.
 */

/** One escape byte, written as an escape so no control byte enters a source file. */
const ESC = '\u001b';

/** What a row is made of before anything is written on it. */
const BLANK = ' ';

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
 * Only the CSI family is understood, which is the only one this product's layout writes;
 * anything else is stepped over. A private sequence (`ESC[?…`) is a mode being switched
 * and changes nothing on the page.
 */
function sequence(bytes: string, at: number, grid: Grid, columns: number, rows: number): number {
  if (bytes[at + 1] !== '[') return at + 1;
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
