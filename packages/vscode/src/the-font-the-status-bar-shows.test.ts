import { describe, expect, it } from 'vitest';
import { THE_BLOCKS } from '../../code/src/presentation/banner.js';
import { drawIconFont } from '../build/icon-font.mjs';

/**
 * The reader below is this file's own, and it shares blind spots with the writer in
 * `build/icon-font.mjs`: both were written by the same hand from the same reading of the format.
 * What does NOT share them is FreeType (`fc-scan` on the packed file, in the pull request) and the
 * editor itself (the captures; `install-check` loads the font, but nothing there verifies that Chromium
 * accepted it). These cases pin the bytes and the geometry; they do not prove the editor takes it.
 */

/** The M as the wordmark's full blocks draw it, ten columns by five rows, written out by hand. */
const THE_M = ['###....###', '####..####', '##.####.##', '##..##..##', '##......##'];

const u16 = (b: Buffer, at: number) => b.readUInt16BE(at);
const i16 = (b: Buffer, at: number) => b.readInt16BE(at);

interface Table {
  offset: number;
  length: number;
  checksum: number;
}

function tables(font: Buffer): Map<string, Table> {
  const count = u16(font, 4);
  const found = new Map<string, Table>();
  for (let i = 0; i < count; i++) {
    const at = 12 + 16 * i;
    found.set(font.toString('latin1', at, at + 4), {
      checksum: font.readUInt32BE(at + 4),
      offset: font.readUInt32BE(at + 8),
      length: font.readUInt32BE(at + 12),
    });
  }
  return found;
}

const sum = (bytes: Buffer): number => {
  const padded = Buffer.concat([bytes, Buffer.alloc((4 - (bytes.length % 4)) % 4)]);
  let total = 0;
  for (let i = 0; i < padded.length; i += 4) total = (total + padded.readUInt32BE(i)) >>> 0;
  return total;
};

const body = (font: Buffer, name: string): Buffer => {
  const t = tables(font).get(name);
  if (t === undefined) throw new Error(`no ${name} table`);
  return font.subarray(t.offset, t.offset + t.length);
};

/** The glyph's contours, each as its points in font units, read from `loca` and `glyf`. */
function contours(font: Buffer, glyph: number): { x: number; y: number }[][] {
  const loca = body(font, 'loca');
  const long = i16(body(font, 'head'), 50) === 1;
  const at = (n: number) => (long ? loca.readUInt32BE(4 * n) : 2 * u16(loca, 2 * n));
  const data = body(font, 'glyf').subarray(at(glyph), at(glyph + 1));
  if (data.length === 0) return [];
  const count = i16(data, 0);
  expect(count, 'a simple glyph').toBeGreaterThanOrEqual(0);
  const ends = Array.from({ length: count }, (_, i) => u16(data, 10 + 2 * i));
  const points = (ends.at(-1) ?? -1) + 1;
  let p = 10 + 2 * count;
  p += 2 + u16(data, p); // the instructions, none here
  const flags: number[] = [];
  while (flags.length < points) {
    const flag = data[p++] ?? 0;
    flags.push(flag);
    if (flag & 8) for (let n = data[p++] ?? 0; n > 0; n--) flags.push(flag);
  }
  const read = (short: number, same: number) => {
    const out: number[] = [];
    let value = 0;
    for (const flag of flags) {
      if (flag & short) {
        const d = data[p++] ?? 0;
        value += flag & same ? d : -d;
      } else if (!(flag & same)) {
        value += i16(data, p);
        p += 2;
      }
      out.push(value);
    }
    return out;
  };
  const xs = read(2, 16);
  const ys = read(4, 32);
  let start = 0;
  return ends.map((end) => {
    const ring = Array.from({ length: end - start + 1 }, (_, i) => ({
      x: xs[start + i] ?? 0,
      y: ys[start + i] ?? 0,
    }));
    start = end + 1;
    return ring;
  });
}

/** The glyph on the pixel grid of an `em`-pixel line: '#' where it has ink, row 0 at the top. */
function pixels(font: Buffer, glyph: number, em: number): string[] {
  const upem = u16(body(font, 'head'), 18);
  const grid = Array.from({ length: em }, () => Array<string>(em).fill('.'));
  for (const ring of contours(font, glyph)) {
    const xs = ring.map((q) => (q.x * em) / upem);
    const ys = ring.map((q) => (q.y * em) / upem);
    for (const n of [...xs, ...ys]) expect(Number.isInteger(n), `edge at ${n} px`).toBe(true);
    for (let y = Math.min(...ys); y < Math.max(...ys); y++)
      for (let x = Math.min(...xs); x < Math.max(...xs); x++) grid[em - 1 - y]?.splice(x, 1, '#');
  }
  return grid.map((row) => row.join(''));
}

/** The signed area of a ring in y-up coordinates: negative when it runs clockwise. */
const area = (ring: { x: number; y: number }[]): number =>
  ring.reduce((total, q, i) => {
    const next = ring[(i + 1) % ring.length] ?? q;
    return total + (q.x * next.y - next.x * q.y);
  }, 0) / 2;

describe('the font the status bar shows (icon-font.mjs, media/mnema-icons.ttf)', () => {
  const font = drawIconFont(THE_BLOCKS);

  it('is the same bytes on every run', () => {
    expect(drawIconFont(THE_BLOCKS).equals(font)).toBe(true);
  });

  it('is a TrueType file with the ten tables a browser sanitizer asks of a web font, in order', () => {
    expect(font.subarray(0, 4)).toEqual(Buffer.from([0, 1, 0, 0]));
    expect([...tables(font).keys()]).toEqual([
      'OS/2',
      'cmap',
      'glyf',
      'head',
      'hhea',
      'hmtx',
      'loca',
      'maxp',
      'name',
      'post',
    ]);
    // The directory's search fields for ten tables: 8 is the largest power of two not above 10.
    expect([u16(font, 6), u16(font, 8), u16(font, 10)]).toEqual([128, 3, 32]);
  });

  it('carries a checksum for every table, and the one in `head` makes the whole file sum to the constant', () => {
    for (const [name, t] of tables(font)) {
      const bytes = body(font, name);
      const own =
        name === 'head'
          ? Buffer.concat([bytes.subarray(0, 8), Buffer.alloc(4), bytes.subarray(12)])
          : bytes;
      expect(t.checksum, name).toBe(sum(own));
      expect(t.offset % 4, `${name} is aligned`).toBe(0);
    }
    expect(sum(font)).toBe(0xb1b0afba);
  });

  it('takes U+E000 to the glyph that draws the M, and nothing else to anything', () => {
    const cmap = body(font, 'cmap');
    expect([u16(cmap, 0), u16(cmap, 2)]).toEqual([0, 1]);
    expect([u16(cmap, 4), u16(cmap, 6)]).toEqual([3, 1]);
    const sub = cmap.subarray(cmap.readUInt32BE(8));
    expect(u16(sub, 0)).toBe(4);
    const segments = u16(sub, 6) / 2;
    const end = (i: number) => u16(sub, 14 + 2 * i);
    const start = (i: number) => u16(sub, 16 + 2 * segments + 2 * i);
    const delta = (i: number) => u16(sub, 16 + 4 * segments + 2 * i);
    const range = (i: number) => u16(sub, 16 + 6 * segments + 2 * i);
    expect(end(segments - 1)).toBe(0xffff);
    const lookup = (code: number) => {
      for (let i = 0; i < segments; i++) {
        if (code <= end(i)) {
          if (code < start(i)) return 0;
          expect(range(i), 'no range offsets: the glyph comes from the delta').toBe(0);
          return (code + delta(i)) & 0xffff;
        }
      }
      return 0;
    };
    expect(lookup(0xe000)).toBe(1);
    for (const code of [0x4d, 0x6d, 0xdfff, 0xe001, 0xf8ff])
      expect(lookup(code), code.toString(16)).toBe(0);
    expect(u16(body(font, 'maxp'), 4)).toBe(2);
  });

  it('draws the banner M on the 16 pixel grid of a status bar icon, every edge on a whole pixel', () => {
    const grid = pixels(font, 1, 16);
    const expected = Array.from({ length: 16 }, (_, y) =>
      Array.from({ length: 16 }, (_, x) => {
        const row = THE_M[Math.floor((y - 3) / 2)];
        return y >= 3 && y < 13 && x >= 3 && x < 13 && row?.[x - 3] === '#' ? '#' : '.';
      }).join(''),
    );
    expect(grid).toEqual(expected);
    expect(pixels(font, 0, 16).join('')).not.toContain('#');
  });

  it('wraps every outline clockwise, which is the way TrueType fills', () => {
    const rings = contours(font, 1);
    expect(rings.length).toBeGreaterThan(0);
    for (const ring of rings) expect(area(ring)).toBeLessThan(0);
  });

  it('measures itself: the box in `head` is the glyph box, and `hmtx` and `hhea` agree on the advance', () => {
    const head = body(font, 'head');
    const rings = contours(font, 1).flat();
    expect([i16(head, 36), i16(head, 38), i16(head, 40), i16(head, 42)]).toEqual([
      Math.min(...rings.map((q) => q.x)),
      Math.min(...rings.map((q) => q.y)),
      Math.max(...rings.map((q) => q.x)),
      Math.max(...rings.map((q) => q.y)),
    ]);
    expect(head.readUInt32BE(12)).toBe(0x5f0f3cf5);
    const upem = u16(head, 18);
    expect(upem).toBe(320);
    const hhea = body(font, 'hhea');
    expect([i16(hhea, 4), i16(hhea, 6), u16(hhea, 34)]).toEqual([upem, 0, 2]);
    const hmtx = body(font, 'hmtx');
    expect(hmtx.length).toBe(8);
    expect([u16(hmtx, 0), u16(hmtx, 4)]).toEqual([upem, upem]);
    expect(i16(hmtx, 6)).toBe(i16(head, 36));
  });

  it('names the family and the glyph in the Windows names a sanitizer reads', () => {
    const name = body(font, 'name');
    const count = u16(name, 2);
    const strings = new Map<number, string>();
    for (let i = 0; i < count; i++) {
      const at = 6 + 12 * i;
      expect([u16(name, at), u16(name, at + 2), u16(name, at + 4)]).toEqual([3, 1, 0x409]);
      const from = u16(name, 4) + u16(name, at + 10);
      strings.set(
        u16(name, at + 6),
        Buffer.from(name.subarray(from, from + u16(name, at + 8)))
          .swap16()
          .toString('utf16le'),
      );
    }
    expect(strings.get(1)).toBe('mnema-icons');
    expect(strings.get(6)).toBe('mnema-icons');
  });

  it('is the font of the first letter: changing it changes the font, changing the next ones does not', () => {
    const [first = ''] = THE_BLOCKS;
    const other = [...THE_BLOCKS];
    // The first letter, the M, is ten columns of ink; the thinnest edit is its first block.
    other[0] = `${first.replace('█', ' ')}`;
    expect(drawIconFont(other).equals(font)).toBe(false);
    const later = THE_BLOCKS.map((row) => row.replace(/(?<=.{11})[█]/g, ' '));
    expect(later).not.toEqual([...THE_BLOCKS]);
    expect(drawIconFont(later).equals(font)).toBe(true);
  });

  it('refuses a wordmark with no full block to draw', () => {
    expect(() => drawIconFont(['', ''])).toThrow(/no full block/);
  });
});
