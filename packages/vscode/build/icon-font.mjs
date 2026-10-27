/**
 * The font that carries the M to the status bar: `drawIconFont(blocks)` returns a TrueType file as
 * a Buffer, written with `node:` alone.
 *
 * The status bar draws text, and the only icons it can draw in text are glyphs of a font: the
 * editor's own codicons, or a font an extension names in `contributes.icons`. The M of the
 * repository's banner is not among the codicons, and a generator of fonts was refused as a
 * dependency, so this writes the one glyph by hand. The glyph is the same letter the side bar's
 * SVG and the store icon draw (`mark.mjs`: the full blocks of the wordmark's first letter, the
 * touching cells fused), so a letter changed in the wordmark is a letter changed here.
 *
 * The file is built for the sanitizer the editor runs every web font through (OTS, in
 * Chromium), which throws away a font that lacks a table it asks for, and a thrown-away font
 * draws nothing: `OS/2`, `cmap` (format 4, U+E000 to glyph 1), `glyf`, `head`, `hhea`, `hmtx`,
 * `loca`, `maxp` (1.0), `name` and `post` (3.0), each with its checksum and the checksum of the
 * whole file in `head`. Glyph 0 is empty, glyph 1 is the M. The em is 320 units, 20 for each pixel
 * of the 16 pixel line the bar draws icons on, so a cell of the wordmark (12 by 24, here 1 by 2
 * pixels) has every edge on a whole pixel and the M is 10 by 10 pixels, centred in the em with the
 * same ascent and descent (all above the baseline) the codicons use. Outlines run clockwise, the
 * way TrueType fills; cells that touch are one rectangle where they share a whole side. There is
 * no timestamp, so the bytes are the same on every run. `package-vsix.mjs` puts the file in the
 * `.vsix` as `media/mnema-icons.ttf`, and the manifest names it in `contributes.icons`.
 */

import { letterRuns } from './mark.mjs';

/** The line the status bar draws icons on, in pixels, and the units of the em for each pixel of it. */
const LINE = 16;
const PIXEL = 20;
const EM = LINE * PIXEL;
/** One cell of the wordmark is a pixel wide and two tall at this size. */
const CELL_W = PIXEL;
const CELL_H = 2 * PIXEL;
const FAMILY = 'mnema-icons';
/** The private-use code point the manifest maps to the M: `\E000`. */
export const M_CODE_POINT = 0xe000;

/** The rectangles of the letter in font units, y up, the cells that touch fused in both directions. */
function rectangles(blocks) {
  const runs = letterRuns(blocks);
  if (runs.length === 0) throw new Error('the wordmark has no full block to draw');
  const left = Math.min(...runs.map((r) => r.column));
  const right = Math.max(...runs.map((r) => r.column + r.columns));
  const top = Math.min(...runs.map((r) => r.row));
  const bottom = Math.max(...runs.map((r) => r.row)) + 1;
  const width = (right - left) * CELL_W;
  const height = (bottom - top) * CELL_H;
  if (width > EM || height > EM) throw new Error(`the letter does not fit the ${LINE} pixel line`);
  // Centred on whole pixels: when the margin is odd the extra pixel goes right and above.
  const x0 = Math.floor((EM - width) / 2 / PIXEL) * PIXEL;
  const y0 = Math.floor((EM - height) / 2 / PIXEL) * PIXEL;
  // A run that stands on a run of the same columns in the row above is one rectangle with it.
  const open = new Map();
  const done = [];
  for (const run of runs) {
    const key = `${run.column}:${run.columns}`;
    const above = open.get(key);
    if (above !== undefined && above.lastRow === run.row - 1) {
      above.lastRow = run.row;
    } else {
      const made = { column: run.column, columns: run.columns, firstRow: run.row, lastRow: run.row };
      open.set(key, made);
      done.push(made);
    }
  }
  return done.map((r) => ({
    x0: x0 + (r.column - left) * CELL_W,
    x1: x0 + (r.column - left + r.columns) * CELL_W,
    // The font's y grows upward; the wordmark's rows grow downward.
    y0: y0 + (bottom - 1 - r.lastRow) * CELL_H,
    y1: y0 + (bottom - r.firstRow) * CELL_H,
  }));
}

const u16 = (n) => {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n & 0xffff);
  return b;
};
const i16 = (n) => {
  const b = Buffer.alloc(2);
  b.writeInt16BE(n);
  return b;
};
const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0);
  return b;
};
const pad4 = (b) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);
const checksum = (b) => {
  const padded = pad4(b);
  let total = 0;
  for (let i = 0; i < padded.length; i += 4) total = (total + padded.readUInt32BE(i)) >>> 0;
  return total;
};

/** The simple glyph of the rectangles: one clockwise four-point contour each, every point on the curve. */
function glyphOf(rects) {
  const xs = rects.flatMap((r) => [r.x0, r.x1]);
  const ys = rects.flatMap((r) => [r.y0, r.y1]);
  const points = rects.flatMap((r) => [
    [r.x0, r.y0],
    [r.x0, r.y1],
    [r.x1, r.y1],
    [r.x1, r.y0],
  ]);
  const box = { xMin: Math.min(...xs), yMin: Math.min(...ys), xMax: Math.max(...xs), yMax: Math.max(...ys) };
  const parts = [
    i16(rects.length),
    i16(box.xMin),
    i16(box.yMin),
    i16(box.xMax),
    i16(box.yMax),
    ...rects.map((_, i) => u16(4 * i + 3)),
    u16(0), // no instructions
    Buffer.alloc(points.length, 0x01), // on the curve, a full 16 bit delta on each axis
  ];
  let previous = [0, 0];
  for (const axis of [0, 1]) {
    previous = [0, 0];
    for (const point of points) {
      parts.push(i16((point[axis] ?? 0) - (previous[axis] ?? 0)));
      previous = point;
    }
  }
  return { data: pad4(Buffer.concat(parts)), box, points: points.length, contours: rects.length };
}

/** `name` records are Windows, Unicode BMP, US English, sorted by id as the format asks. */
function nameTable() {
  const entries = [
    [1, FAMILY],
    [2, 'Regular'],
    [3, `${FAMILY} Regular`],
    [4, FAMILY],
    [5, 'Version 1.000'],
    [6, FAMILY],
  ];
  const strings = entries.map(([, text]) => Buffer.from(text, 'utf16le').swap16());
  let offset = 0;
  const records = entries.map(([id], i) => {
    const length = strings[i]?.length ?? 0;
    const record = Buffer.concat([u16(3), u16(1), u16(0x409), u16(id), u16(length), u16(offset)]);
    offset += length;
    return record;
  });
  return Buffer.concat([u16(0), u16(entries.length), u16(6 + 12 * entries.length), ...records, ...strings]);
}

/** cmap: one format 4 subtable, Windows Unicode BMP: the private-use code point to glyph 1. */
function cmapTable() {
  const subtable = Buffer.concat([
    u16(4),
    u16(32),
    u16(0),
    u16(4), // two segments, doubled
    u16(4),
    u16(1),
    u16(0),
    u16(M_CODE_POINT), // end codes
    u16(0xffff),
    u16(0), // reserved pad
    u16(M_CODE_POINT), // start codes
    u16(0xffff),
    u16(1 - M_CODE_POINT), // deltas: the code point plus the delta is the glyph
    u16(1),
    u16(0), // no range offsets
    u16(0),
  ]);
  return Buffer.concat([u16(0), u16(1), u16(3), u16(1), u32(12), subtable]);
}

/**
 * The font over the rows of the console's wordmark (`THE_BLOCKS`).
 * @param {readonly string[]} blocks
 * @returns {Buffer}
 */
export function drawIconFont(blocks) {
  const m = glyphOf(rectangles(blocks));
  const os2 = Buffer.alloc(96);
  os2.writeUInt16BE(4, 0); // version
  os2.writeInt16BE(EM, 2); // xAvgCharWidth
  os2.writeUInt16BE(400, 4); // regular weight
  os2.writeUInt16BE(5, 6); // normal width
  os2.writeInt16BE(PIXEL * 10, 10); // subscript size and offsets, and superscript: unused, plausible
  os2.writeInt16BE(PIXEL * 10, 12);
  os2.writeInt16BE(PIXEL * 2, 16);
  os2.writeInt16BE(PIXEL * 10, 18);
  os2.writeInt16BE(PIXEL * 10, 20);
  os2.writeInt16BE(PIXEL * 6, 24);
  os2.writeInt16BE(PIXEL, 26); // strikeout size
  os2.writeInt16BE(PIXEL * 6, 28); // strikeout position
  os2.writeUInt32BE(0x10000000, 46); // ulUnicodeRange2: bit 60, the private use area
  os2.write('NONE', 58, 'latin1'); // achVendID
  os2.writeUInt16BE(0x40, 62); // fsSelection: regular
  os2.writeUInt16BE(M_CODE_POINT, 64);
  os2.writeUInt16BE(M_CODE_POINT, 66);
  os2.writeInt16BE(EM, 68); // typo ascender: the line, all above the baseline
  os2.writeInt16BE(0, 70);
  os2.writeInt16BE(0, 72);
  os2.writeUInt16BE(EM, 74); // win ascent
  os2.writeUInt16BE(0, 76);
  os2.writeUInt32BE(1, 78); // code page range: Latin 1
  os2.writeInt16BE(m.box.yMax, 86); // xHeight
  os2.writeInt16BE(m.box.yMax, 88); // capHeight

  const head = Buffer.concat([
    u32(0x00010000), // version 1.0
    u32(0x00010000), // font revision 1.0
    u32(0), // checkSumAdjustment, set below
    u32(0x5f0f3cf5),
    u16(0x000b),
    u16(EM),
    Buffer.alloc(16), // created and modified: none, so the bytes never change
    i16(m.box.xMin),
    i16(m.box.yMin),
    i16(m.box.xMax),
    i16(m.box.yMax),
    u16(0), // macStyle
    u16(8), // lowest readable size in pixels
    i16(2),
    i16(0), // short offsets in `loca`
    i16(0),
  ]);

  const hhea = Buffer.concat([
    u32(0x00010000),
    i16(EM),
    i16(0),
    i16(0),
    u16(EM),
    i16(0), // min left side bearing: glyph 0 is empty and sits at 0
    i16(EM - m.box.xMax), // min right side bearing
    i16(m.box.xMax), // max extent
    i16(1), // caret slope: upright
    i16(0),
    i16(0),
    Buffer.alloc(8),
    i16(0),
    u16(2),
  ]);

  const hmtx = Buffer.concat([u16(EM), i16(0), u16(EM), i16(m.box.xMin)]);
  const loca = Buffer.concat([u16(0), u16(0), u16(m.data.length / 2)]);
  const maxp = Buffer.concat([
    u32(0x00010000),
    u16(2),
    u16(m.points),
    u16(m.contours),
    u16(0),
    u16(0),
    u16(1),
    Buffer.alloc(16),
  ]);
  const post = Buffer.concat([u32(0x00030000), u32(0), i16(-PIXEL), i16(PIXEL), Buffer.alloc(20)]);

  const tables = [
    ['OS/2', os2],
    ['cmap', cmapTable()],
    ['glyf', m.data],
    ['head', head],
    ['hhea', hhea],
    ['hmtx', hmtx],
    ['loca', loca],
    ['maxp', maxp],
    ['name', nameTable()],
    ['post', post],
  ];

  const directory = 12 + 16 * tables.length;
  let offset = directory;
  const entries = tables.map(([tag, table]) => {
    const entry = Buffer.concat([Buffer.from(tag, 'latin1'), u32(checksum(table)), u32(offset), u32(table.length)]);
    offset += pad4(table).length;
    return entry;
  });
  // For ten tables: the largest power of two not above the count is 8.
  const search = 16 * 2 ** Math.floor(Math.log2(tables.length));
  const file = Buffer.concat([
    Buffer.from([0, 1, 0, 0]),
    u16(tables.length),
    u16(search),
    u16(Math.floor(Math.log2(tables.length))),
    u16(16 * tables.length - search),
    ...entries,
    ...tables.map(([, table]) => pad4(table)),
  ]);
  // The adjustment makes the whole file sum to a constant; `head` is summed with it as zero.
  const headAt = 12 + 16 * tables.findIndex(([tag]) => tag === 'head');
  const at = file.readUInt32BE(headAt + 8) + 8;
  file.writeUInt32BE((0xb1b0afba - checksum(file)) >>> 0, at);
  return file;
}
