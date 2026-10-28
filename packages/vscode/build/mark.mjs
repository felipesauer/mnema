/**
 * The mark of the extension: the letter M of the repository's banner, read from the console's
 * wordmark (`THE_BLOCKS`, `packages/code/src/presentation/banner.ts`) and nowhere else. Two files
 * draw it, and both start here, so a letter changed in the wordmark is a letter changed in both:
 * `icon.mjs` paints the 128 pixel icon of the stores, and `drawActivityIcon` below writes the
 * monochrome SVG of the side bar. Both are written when the extension is packed; none is kept in
 * the tree.
 */

/**
 * The first letter of the wordmark: each row up to the column of the last row's second `╝`, which
 * is where the M ends (the next letter starts in the very next column, with no gap).
 * @param {readonly string[]} blocks
 */
export const firstLetter = (blocks) => {
  const last = [...(blocks.at(-1) ?? '')];
  let seen = 0;
  let end = last.length - 1;
  for (let i = 0; i < last.length; i++) {
    if (last[i] === '╝' && ++seen === 2) {
      end = i;
      break;
    }
  }
  return blocks.map((row) => [...row].slice(0, end + 1));
};

/**
 * The cells of the first letter that are full blocks, as [column, row]. The thin strokes of the
 * wordmark are not cells: they vanish at the sizes the mark is drawn at.
 * @param {readonly string[]} blocks
 * @returns {[number, number][]}
 */
export const letterCells = (blocks) => {
  const cells = [];
  firstLetter(blocks).forEach((row, r) => {
    row.forEach((glyph, c) => {
      if (glyph === '█') cells.push([c, r]);
    });
  });
  return cells;
};

/**
 * The full blocks of each row of the first letter, the cells that touch fused into one run: the
 * shapes both the side bar's SVG and the status bar's font fill, so the two cannot disagree about
 * where the letter has ink. Each run is its first column, its row and how many columns it spans,
 * in the wordmark's own cells, ordered by row and then by column.
 * @param {readonly string[]} blocks
 * @returns {{ column: number, row: number, columns: number }[]}
 */
export function letterRuns(blocks) {
  const cells = letterCells(blocks);
  const runs = [];
  for (const row of [...new Set(cells.map(([, r]) => r))].sort((a, b) => a - b)) {
    const inRow = cells
      .filter(([, r]) => r === row)
      .map(([c]) => c)
      .sort((a, b) => a - b);
    let start = inRow[0] ?? 0;
    let previous = start;
    for (const c of [...inRow.slice(1), Number.POSITIVE_INFINITY]) {
      if (c === previous + 1) {
        previous = c;
        continue;
      }
      runs.push({ column: start, row, columns: previous - start + 1 });
      start = c;
      previous = c;
    }
  }
  return runs;
}

/** One cell on the 24 by 24 grid of the side bar: the banner's cell is 12 by 24 (1:2), here 2 by 4. */
const CELL_W = 2;
const CELL_H = 4;
const GRID = 24;

/**
 * The M as one SVG path on a 24 by 24 grid, filled with `currentColor` so the editor paints it as
 * it paints every icon of the bar. A cell is 2 by 4 pixels, so every edge falls on a whole pixel;
 * the letter's own ink (the full blocks) is centred, and the cells of a row that touch are one
 * rectangle. No other colour, no text, no reference to anything outside the file.
 * @param {readonly string[]} blocks
 * @returns {string}
 */
export function drawActivityIcon(blocks) {
  const cells = letterCells(blocks);
  if (cells.length === 0) throw new Error('the wordmark has no full block to draw');
  const columns = cells.map(([c]) => c);
  const rows = cells.map(([, r]) => r);
  const left = Math.min(...columns);
  const top = Math.min(...rows);
  const width = (Math.max(...columns) - left + 1) * CELL_W;
  const height = (Math.max(...rows) - top + 1) * CELL_H;
  if (width > GRID || height > GRID) throw new Error('the letter does not fit the 24 pixel grid');
  const x0 = (GRID - width) / 2;
  const y0 = (GRID - height) / 2;
  const runs = letterRuns(blocks).map(({ column, row, columns: span }) => {
    const run = span * CELL_W;
    return `M${x0 + (column - left) * CELL_W} ${y0 + (row - top) * CELL_H}h${run}v${CELL_H}h-${run}z`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${GRID}" height="${GRID}" viewBox="0 0 ${GRID} ${GRID}"><path fill="currentColor" d="${runs.join('')}"/></svg>\n`;
}
