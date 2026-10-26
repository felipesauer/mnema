import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
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
    const png = drawIcon();
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.subarray(12, 16).toString('latin1')).toBe('IHDR');
    expect(png.readUInt32BE(16)).toBe(128);
    expect(png.readUInt32BE(20)).toBe(128);
    expect(png.equals(drawIcon())).toBe(true);
  });
});
