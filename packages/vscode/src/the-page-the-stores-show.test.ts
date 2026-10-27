import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { THE_BLOCKS } from '../../code/src/presentation/banner.js';
import { drawIcon } from '../build/icon.mjs';

interface Manifest {
  publisher: string;
  description: string;
  icon: string;
  categories: string[];
  keywords: string[];
  preview: boolean;
  galleryBanner: { color: string; theme: string };
}

const manifest = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as Manifest;

// The Marketplace's own list; the packer does not check it, the store refuses what is not on it.
const STORE_CATEGORIES = [
  'Programming Languages',
  'Snippets',
  'Linters',
  'Themes',
  'Debuggers',
  'Formatters',
  'Keymaps',
  'SCM Providers',
  'Other',
  'Extension Packs',
  'Language Packs',
  'Data Science',
  'Machine Learning',
  'Visualization',
  'Notebooks',
  'Education',
  'Testing',
];

describe('what the stores show of the extension', () => {
  it('is published as mnema.mnema, as a preview, with an icon, a category, keywords and a banner', () => {
    expect(manifest.publisher).toBe('mnema');
    expect(manifest.preview).toBe(true);
    expect(manifest.icon).toBe('icon.png');
    expect(manifest.categories.length).toBeGreaterThan(0);
    for (const category of manifest.categories) expect(STORE_CATEGORIES).toContain(category);
    expect(manifest.keywords.length).toBeGreaterThan(0);
    expect(manifest.keywords.length).toBeLessThanOrEqual(30);
    expect(manifest.galleryBanner.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(['dark', 'light']).toContain(manifest.galleryBanner.theme);
  });

  it('describes itself in one line that says what it shows and promises nothing it does not do', () => {
    expect(manifest.description).not.toMatch(/\n/);
    expect(manifest.description.length).toBeLessThanOrEqual(200);
    const shown = [manifest.description, ...manifest.keywords, ...manifest.categories].join(' ');
    expect(shown).not.toMatch(/not published|verified|secure|tamper|trusted|safe/i);
    expect(manifest.description).toContain('mnema command line');
  });

  it('draws the icon as a 128 by 128 PNG, the same bytes every time', () => {
    const png = drawIcon(THE_BLOCKS);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.subarray(12, 16).toString('latin1')).toBe('IHDR');
    expect(png.readUInt32BE(16)).toBe(128);
    expect(png.readUInt32BE(20)).toBe(128);
    expect(png.equals(drawIcon(THE_BLOCKS))).toBe(true);
  });

  it('paints the banner M, cell by cell, in the banner accent on the banner page, in a rounded square with a lilac border', () => {
    const at = pixels(drawIcon(THE_BLOCKS));
    const accent = [0xc4, 0xa0, 0xf5, 255];
    const page = [0x0d, 0x11, 0x17, 255];
    // The M is the wordmark's first letter, 11 columns of 12 by 24 units, drawn at 0.64 and centred.
    const scale = (128 * 0.66) / 132;
    const x0 = (128 - 132 * scale) / 2;
    const y0 = (128 - 135.5 * scale) / 2;
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 11; c++) {
        const glyph = [...(THE_BLOCKS[r] ?? '')][c];
        if (glyph !== '█' && glyph !== ' ') continue;
        const x = Math.round(x0 + (c + 0.5) * 12 * scale);
        const y = Math.round(y0 + (r + 0.5) * 24 * scale);
        expect(at(x, y), `row ${r}, column ${c}, ${JSON.stringify(glyph)}`).toEqual(
          glyph === '█' ? accent : page,
        );
      }
    }
    expect(at(0, 0)[3]).toBe(0);
    expect(at(64, 1)).toEqual(accent);
    expect(at(64, 5)).toEqual(page);
  });

  it('is drawn from the console wordmark: the first letter changes the icon, the next ones do not', () => {
    const before = drawIcon(THE_BLOCKS);
    const first = THE_BLOCKS.map((row, i) => (i === 0 ? ` ${row.slice(1)}` : row));
    const second = THE_BLOCKS.map((row, i) =>
      i === 0 ? `${row.slice(0, 11)} ${row.slice(12)}` : row,
    );
    expect(first[0]).not.toBe(THE_BLOCKS[0]);
    expect(drawIcon(first).equals(before)).toBe(false);
    expect(second[0]).not.toBe(THE_BLOCKS[0]);
    expect(drawIcon(second).equals(before)).toBe(true);
  });
});

/** The colour at (x, y) of a PNG this icon's writer made: 8-bit RGBA, every row unfiltered. */
function pixels(png: Buffer): (x: number, y: number) => number[] {
  const data = inflateSync(png.subarray(png.indexOf('IDAT') + 4, png.indexOf('IEND') - 8));
  return (x, y) => [...data.subarray(y * (1 + 128 * 4) + 1 + x * 4, y * (1 + 128 * 4) + 5 + x * 4)];
}
