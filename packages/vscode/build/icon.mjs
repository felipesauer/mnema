/**
 * The extension's icon, drawn in code: `drawIcon()` returns a 128x128 PNG as a Buffer.
 *
 * The mark is the cube of the repository's banner (a hexagon with its three faces, in the accent
 * #c4a0f5, outlined) on the banner's dark ground, as a rounded square. The stores take a PNG and
 * refuse an SVG, and the repository holds no raster tool, so the shapes are polygons filled at 4x4
 * samples per pixel and written as a PNG with `node:zlib` alone: the same bytes on every run, no
 * binary kept in the tree that has no source. Run by `package-vsix.mjs`, which puts the file in the
 * `.vsix` as `icon.png`.
 */

import { deflateSync } from 'node:zlib';

const SIZE = 128;
const SAMPLES = 4;
const GROUND = [13, 17, 23];
const ACCENT = [196, 160, 245];

// The banner's cube (a 52 by 60 hexagon) scaled by 1.55 and centred in the square.
const SCALE = 1.55;
const CX = SIZE / 2;
const CY = SIZE / 2;
const p = (x, y) => [CX + (x - 25.98) * SCALE, CY + (y - 68) * SCALE];
const TOP = [p(25.98, 38), p(51.96, 53), p(25.98, 68), p(0, 53)];
const LEFT = [p(0, 53), p(25.98, 68), p(25.98, 98), p(0, 83)];
const RIGHT = [p(25.98, 68), p(51.96, 53), p(51.96, 83), p(25.98, 98)];
const OUTLINE = [
  [p(25.98, 38), p(51.96, 53)],
  [p(51.96, 53), p(51.96, 83)],
  [p(51.96, 83), p(25.98, 98)],
  [p(25.98, 98), p(0, 83)],
  [p(0, 83), p(0, 53)],
  [p(0, 53), p(25.98, 38)],
  [p(0, 53), p(25.98, 68)],
  [p(25.98, 68), p(51.96, 53)],
  [p(25.98, 68), p(25.98, 98)],
];
const STROKE = 3.2;
const RADIUS = 24;

const inPolygon = (x, y, poly) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const nearSegment = (x, y, [[ax, ay], [bx, by]]) => {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy)) <= STROKE / 2;
};
const inRoundedSquare = (x, y) => {
  const qx = Math.abs(x - SIZE / 2) - (SIZE / 2 - RADIUS);
  const qy = Math.abs(y - SIZE / 2) - (SIZE / 2 - RADIUS);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) <= RADIUS;
};

/** The colour at a point: [r, g, b, a] with a in 0..1. */
const sample = (x, y) => {
  if (!inRoundedSquare(x, y)) return [0, 0, 0, 0];
  if (OUTLINE.some((s) => nearSegment(x, y, s))) return [...ACCENT, 1];
  let alpha = 0;
  if (inPolygon(x, y, TOP)) alpha = 0.34;
  else if (inPolygon(x, y, LEFT)) alpha = 0.2;
  else if (inPolygon(x, y, RIGHT)) alpha = 0.1;
  return [...GROUND.map((g, i) => g * (1 - alpha) + ACCENT[i] * alpha), 1];
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

export function drawIcon() {
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
