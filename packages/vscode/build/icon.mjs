/**
 * The extension's icon, drawn in code: `drawIcon(blocks)` returns a 128x128 PNG as a Buffer.
 *
 * The mark is the letter M of the repository's banner, and nothing else: the first letter of the
 * console's wordmark (`THE_BLOCKS`, `packages/code/src/presentation/banner.ts`), in the banner's
 * own paint. A full block is a filled cell in the accent (`.github/the-front-page/accent.mjs`),
 * on the banner's dark page (`PAGE.dark`, the manifest's `galleryBanner`), inside a rounded
 * square with a thin border in the accent. Behind the letter sits the same letter in blocks, a
 * darker lilac and opaque, shifted down and to the right: the solid shadow that gives the blocks
 * their depth (the banner's own thin double-line strokes are not drawn here, they vanish at 16
 * pixels). The shadow's colour is the accent mixed into the page, never a colour of its own.
 * `package-vsix.mjs`
 * hands it the rows of the built console, so a letter changed there is a letter changed here.
 * The stores take a PNG and refuse an SVG, and the repository holds no raster tool, so the shapes
 * are filled at 4x4 samples per pixel and written as a PNG with `node:zlib` alone: the same bytes
 * on every run, no binary kept in the tree that has no source. Run by `package-vsix.mjs`, which
 * puts the file in the `.vsix` as `icon.png`.
 */

import { deflateSync } from 'node:zlib';
import { ACCENT } from '../../../.github/the-front-page/accent.mjs';
import { CELL, inkFoot, PAGE } from '../../../.github/the-front-page/draw.mjs';
import { firstLetter, letterCells } from './mark.mjs';

const SIZE = 128;
const SAMPLES = 4;
const rgb = (hex) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
const GROUND = rgb(PAGE.dark);
const PAINT = rgb(ACCENT.dark);
/** The share of the accent kept in the shadow: the accent mixed into the page at this share. */
const SHADOW_SHARE = 0.45;
const SHADOW = GROUND.map((g, i) => Math.round(g * (1 - SHADOW_SHARE) + PAINT[i] * SHADOW_SHARE));
/** How far the shadow is shifted down and to the right, in pixels of the 128 icon. */
const SHADOW_OFFSET = 4;
/** The letter's width on the icon, as a share of the icon's. */
const LETTER = 0.66;
const RADIUS = 24;
const BORDER = 3;

/**
 * The letter as filled rectangles in the wordmark's own units (only the full blocks).
 * @param {readonly string[]} blocks
 */
const shapesOf = (blocks) => {
  const rects = letterCells(blocks).map(([c, r]) => [
    c * CELL.w,
    r * CELL.h,
    (c + 1) * CELL.w,
    (r + 1) * CELL.h,
  ]);
  return { rects, width: (firstLetter(blocks)[0]?.length ?? 0) * CELL.w, height: inkFoot(blocks) };
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
  const { rects, width, height } = shapesOf(blocks);
  const scale = (SIZE * LETTER) / width;
  const x0 = (SIZE - width * scale) / 2;
  const y0 = (SIZE - height * scale) / 2;

  /** The colour at a point: [r, g, b, a] with a in 0..1. */
  const sample = (px, py) => {
    if (!inRoundedSquare(px, py, 0)) return [0, 0, 0, 0];
    if (!inRoundedSquare(px, py, BORDER)) return [...PAINT, 1];
    const covers = (qx, qy) => {
      const x = (qx - x0) / scale;
      const y = (qy - y0) / scale;
      return rects.some(([l, t, r, b]) => x >= l && x < r && y >= t && y < b);
    };
    if (covers(px, py)) return [...PAINT, 1];
    if (covers(px - SHADOW_OFFSET, py - SHADOW_OFFSET)) return [...SHADOW, 1];
    return [...GROUND, 1];
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
