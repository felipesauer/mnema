import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { THE_BLOCKS } from '../../code/src/presentation/banner.js';
import { drawIcon } from '../build/icon.mjs';
import { drawActivityIcon, letterCells } from '../build/mark.mjs';

/** The M as the wordmark's full blocks draw it, ten columns by five rows, written out by hand. */
const THE_M = ['###....###', '####..####', '##.####.##', '##..##..##', '##......##'];

/** The rectangles of the path: each run is `M x y h w v h h -w z`, in whole pixels. */
function rectangles(svg: string): { x: number; y: number; w: number; h: number }[] {
  const d = /<path [^>]*\bd="([^"]*)"/.exec(svg)?.[1] ?? '';
  return [...d.matchAll(/M(\d+) (\d+)h(\d+)v(\d+)h-(\d+)z/g)].map((m) => {
    expect(m[3], 'the run goes back by what it went forward').toBe(m[5]);
    return { x: Number(m[1]), y: Number(m[2]), w: Number(m[3]), h: Number(m[4]) };
  });
}

/** The 24 by 24 pixels the path fills, as rows of '#' and '.'. */
function filled(svg: string): string[] {
  const grid = Array.from({ length: 24 }, () => Array<string>(24).fill('.'));
  for (const { x, y, w, h } of rectangles(svg)) {
    for (let py = y; py < y + h; py++)
      for (let px = x; px < x + w; px++) grid[py]?.splice(px, 1, '#');
  }
  return grid.map((row) => row.join(''));
}

describe('the M the side bar shows (mark.mjs, media/mnema.svg)', () => {
  it('is the same bytes on every run', () => {
    expect(drawActivityIcon(THE_BLOCKS)).toBe(drawActivityIcon(THE_BLOCKS));
  });

  it('is one path on a 24 by 24 grid, filled with the colour the editor gives its icons, and nothing else', () => {
    const svg = drawActivityIcon(THE_BLOCKS);
    expect(svg).toMatch(
      /^<svg [^>]*viewBox="0 0 24 24"[^>]*><path fill="currentColor" d="[^"]+"\/><\/svg>\n$/,
    );
    expect(svg.match(/<path /g)).toHaveLength(1);
    expect(svg.match(/currentColor/g)).toHaveLength(1);
    expect(svg).not.toMatch(/#[0-9a-fA-F]{3,8}|rgb|hsl|<script|<image|href|style|<text|<use/i);
  });

  it('has every edge on a whole pixel inside the grid', () => {
    const runs = rectangles(drawActivityIcon(THE_BLOCKS));
    expect(runs.length).toBeGreaterThan(0);
    for (const { x, y, w, h } of runs) {
      for (const n of [x, y, w, h]) expect(Number.isInteger(n)).toBe(true);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x + w).toBeLessThanOrEqual(24);
      expect(y + h).toBeLessThanOrEqual(24);
    }
  });

  it('fills the banner M, a cell being 2 by 4 pixels, centred: two pixels of margin on every side', () => {
    const grid = filled(drawActivityIcon(THE_BLOCKS));
    const expected = Array.from({ length: 24 }, (_, y) =>
      Array.from({ length: 24 }, (_, x) => {
        const row = THE_M[Math.floor((y - 2) / 4)];
        const cell = Math.floor((x - 2) / 2);
        return y >= 2 && y < 22 && x >= 2 && x < 22 && row?.[cell] === '#' ? '#' : '.';
      }).join(''),
    );
    expect(grid).toEqual(expected);
  });

  it('joins the cells of a row that touch into one rectangle', () => {
    const runs = rectangles(drawActivityIcon(THE_BLOCKS));
    // The wordmark's M holds 32 cells, and the cells that touch are 12 runs.
    expect(letterCells(THE_BLOCKS)).toHaveLength(32);
    expect(runs).toHaveLength(12);
  });

  it('is drawn from the console wordmark: the first letter changes it, the next ones do not', () => {
    const before = drawActivityIcon(THE_BLOCKS);
    const first = THE_BLOCKS.map((row, i) => (i === 0 ? ` ${row.slice(1)}` : row));
    const second = THE_BLOCKS.map((row, i) =>
      i === 0 ? `${row.slice(0, 11)} ${row.slice(12)}` : row,
    );
    expect(drawActivityIcon(first)).not.toBe(before);
    expect(drawActivityIcon(second)).toBe(before);
  });

  it('left the 128 pixel icon of the stores byte for byte what it was before the geometry was shared', () => {
    const sha = createHash('sha256').update(drawIcon(THE_BLOCKS)).digest('hex');
    expect(sha).toBe('cdced6b6f2e5eee148490f0c1dd6fbb2a2bb25fd10512fac658c8b797332a744');
  });
});
