/**
 * The extension's icon, drawn in code: `drawIcon(blocks)` returns a 128x128 PNG as a Buffer.
 *
 * The mark is the letter M of the repository's banner, and nothing else: the first letter of the
 * console's wordmark (`THE_BLOCKS`, `packages/code/src/presentation/banner.ts`), in the banner's
 * own paint. A full block is a filled cell in the accent (`.github/the-front-page/accent.mjs`),
 * a double-line glyph is its two strokes at 0.55 of the accent, with the geometry `draw.mjs`
 * draws (`doubleLine`, `CELL`, `DOUBLE`), on the banner's dark page (`PAGE.dark`, the manifest's
 * `galleryBanner`), inside a rounded square with a thin border in the accent. `package-vsix.mjs`
 * hands it the rows of the built console, so a letter changed there is a letter changed here.
 * The stores take a PNG and refuse an SVG, and the repository holds no raster tool, so the shapes
 * are filled at 4x4 samples per pixel and written as a PNG with `node:zlib` alone: the same bytes
 * on every run, no binary kept in the tree that has no source. Run by `package-vsix.mjs`, which
 * puts the file in the `.vsix` as `icon.png`.
 */

import { deflateSync } from 'node:zlib';
import { ACCENT } from '../../../.github/the-front-page/accent.mjs';
import { CELL, DOUBLE, doubleLine, inkFoot, PAGE } from '../../../.github/the-front-page/draw.mjs';

const SIZE = 128;
const SAMPLES = 4;
const rgb = (hex) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
const GROUND = rgb(PAGE.dark);
const PAINT = rgb(ACCENT.dark);
/** How much of the accent a double-line stroke keeps, as the banner draws it. */
const LINE_OPACITY = 0.55;
/** The letter's width on the icon, as a share of the icon's. */
const LETTER = 0.66;
const RADIUS = 24;
const BORDER = 3;

/**
 * The first letter of the wordmark: each row up to the column of the last row's second `╝`, which
 * is where the M ends (the next letter starts in the very next column, with no gap).
 * @param {readonly string[]} blocks
 */
const firstLetter = (blocks) => {
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
 * The letter as shapes in the wordmark's own units: filled rectangles and stroked segments.
 * @param {readonly string[]} blocks
 */
const shapesOf = (blocks) => {
  const rows = firstLetter(blocks);
  const rects = [];
  const segments = [];
  rows.forEach((row, r) => {
    row.forEach((glyph, c) => {
      if (glyph === ' ') return;
      const x = c * CELL.w;
      const y = r * CELL.h;
      if (glyph === '█') {
        rects.push([x, y, x + CELL.w, y + CELL.h]);
        return;
      }
      const path = doubleLine(glyph, x, y);
      if (path === undefined) throw new Error(`the icon has a glyph this cannot draw: ${glyph}`);
      for (const stroke of path.split('M').slice(1)) {
        const points = stroke.split('L').map((pt) => pt.split(' ').map(Number));
        for (let i = 1; i < points.length; i++) segments.push([points[i - 1], points[i]]);
      }
    });
  });
  return { rects, segments, width: (rows[0]?.length ?? 0) * CELL.w, height: inkFoot(blocks) };
};

const nearSegment = (x, y, [[ax, ay], [bx, by]]) => {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy)) <= DOUBLE.width / 2;
};
const inRoundedSquare = (x, y, inset) => {
  const half = SIZE / 2 - inset;
  const radius = RADIUS - inset;
  const qx = Math.abs(x - SIZE / 2) - (half - radius);
  const qy = Math.abs(y - SIZE / 2) - (half - radius);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) <= radius;
};

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
};

/**
 * The icon over the rows of the console's wordmark (`THE_BLOCKS`).
 * @param {readonly string[]} blocks
 * @returns {Buffer}
 */
export function drawIcon(blocks) {
  const { rects, segments, width, height } = shapesOf(blocks);
  const scale = (SIZE * LETTER) / width;
  const x0 = (SIZE - width * scale) / 2;
  const y0 = (SIZE - height * scale) / 2;

  /** The colour at a point: [r, g, b, a] with a in 0..1. */
  const sample = (px, py) => {
    if (!inRoundedSquare(px, py, 0)) return [0, 0, 0, 0];
    if (!inRoundedSquare(px, py, BORDER)) return [...PAINT, 1];
    const x = (px - x0) / scale;
    const y = (py - y0) / scale;
    if (rects.some(([l, t, r, b]) => x >= l && x < r && y >= t && y < b)) return [...PAINT, 1];
    const alpha = segments.some((s) => nearSegment(x, y, s)) ? LINE_OPACITY : 0;
    return [...GROUND.map((g, i) => g * (1 - alpha) + PAINT[i] * alpha), 1];
  };

  const rows = [];
  for (let y = 0; y < SIZE; y++) {
    const row = Buffer.alloc(1 + SIZE * 4);
    for (let x = 0; x < SIZE; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const [cr, cg, cb, ca] = sample(x + (sx + 0.5) / SAMPLES, y + (sy + 0.5) / SAMPLES);
          r += cr * ca;
          g += cg * ca;
          b += cb * ca;
          a += ca;
        }
      }
      const o = 1 + x * 4;
      row[o] = a === 0 ? 0 : Math.round(r / a);
      row[o + 1] = a === 0 ? 0 : Math.round(g / a);
      row[o + 2] = a === 0 ? 0 : Math.round(b / a);
      row[o + 3] = Math.round((a / (SAMPLES * SAMPLES)) * 255);
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(SIZE, 0);
  header.writeUInt32BE(SIZE, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
