/**
 * THE PLUGIN'S ICON IS THE MARK ITS MANIFEST NAMES, AND THE MARK THE EXTENSION HAS: each plugin
 * folder carries `.claude-plugin/icon.png`, its manifest's `icon` points at it, and the file is
 * byte for byte what `.github/the-plugin-icon/make.mjs` draws, a 512 pixel square under the
 * directory's 2 MB, in the same shapes as the extension's 128 pixel icon (`icon.mjs` draws both).
 *
 * WHAT IS HELD HERE AND WHAT IS NOT. That the files are the drawing, that the manifest names them and
 * that the size is the directory's (a square PNG of 512 to 2048 pixels, under 2 MB, per
 * https://code.claude.com/docs/en/plugins-reference "Directory listing fields" and the directory's
 * pre-submission checklist, read on 2 November 2026). NOT HELD: that the directory shows it as
 * wanted; `claude plugin validate <folder> --strict` read it without a finding, and that is a run, not
 * a test, because it needs the host's binary.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { THE_BLOCKS } from '../src/presentation/banner.js';

const ROOT = new URL('../../../', import.meta.url).pathname;
const MAKE = join(ROOT, '.github', 'the-plugin-icon', 'make.mjs');

type Make = {
  SIZE: number;
  PLUGIN_FOLDERS: string[];
  ICON_IN_THE_PLUGIN: string;
  theIcon: () => Buffer;
  theFiles: (root: string) => { path: string; png: Buffer; current: boolean }[];
};
const make = (await import(pathToFileURL(MAKE).href)) as Make;
const { drawIcon } = (await import(
  pathToFileURL(join(ROOT, 'packages', 'vscode', 'build', 'icon.mjs')).href
)) as { drawIcon: (blocks: readonly string[], size?: number) => Buffer };

/** The RGBA of a pixel of a PNG this repository draws (8 bit, RGBA, every row filtered with None). */
function decode(png: Buffer): { size: number; at: (x: number, y: number) => number[] } {
  const size = png.readUInt32BE(16);
  const data = inflateSync(png.subarray(png.indexOf('IDAT') + 4, png.indexOf('IEND') - 4));
  return {
    size,
    at: (x, y) => [...data.subarray(y * (1 + size * 4) + 1 + x * 4).subarray(0, 4)],
  };
}

describe('the plugin icon', () => {
  const icon = make.theIcon();

  it('is a square PNG of 512 pixels, under the 2 MB the directory takes', () => {
    expect([...icon.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(icon.readUInt32BE(16)).toBe(512);
    expect(icon.readUInt32BE(20)).toBe(512);
    expect(make.SIZE).toBe(512);
    expect(icon.length).toBeLessThan(2 * 1024 * 1024);
  }, 60_000);

  it('is the same bytes every time', () => {
    expect(make.theIcon().equals(icon)).toBe(true);
  }, 60_000);

  it('is the extension icon drawn larger: the same shapes, away from the edges the sampling softens', () => {
    const small = decode(drawIcon(THE_BLOCKS));
    const big = decode(icon);
    let compared = 0;
    let differing = 0;
    for (let y = 0; y < small.size; y++) {
      for (let x = 0; x < small.size; x++) {
        const here = small.at(x, y);
        // Only the pixels whose four neighbours are the same colour: the inside of a shape.
        const flat = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ].every(([dx, dy]) => {
          const next = small.at(x + (dx ?? 0), y + (dy ?? 0));
          return next.every((value, i) => value === here[i]);
        });
        if (!flat) continue;
        compared++;
        if (big.at(x * 4 + 2, y * 4 + 2).some((value, i) => value !== here[i])) differing++;
      }
    }
    expect(compared).toBeGreaterThan(8000);
    expect(differing).toBe(0);
  }, 60_000);

  it('is not the extension icon over again: it has 512 pixels where that one has 128', () => {
    expect(drawIcon(THE_BLOCKS).readUInt32BE(16)).toBe(128);
    expect(icon.equals(drawIcon(THE_BLOCKS))).toBe(false);
  }, 60_000);
});

describe('each plugin folder', () => {
  it.each(make.PLUGIN_FOLDERS)(
    '%s carries the icon its manifest names, as the drawing makes it',
    (folder) => {
      const manifest = JSON.parse(
        readFileSync(join(ROOT, folder, '.claude-plugin', 'plugin.json'), 'utf-8'),
      ) as { icon?: string };
      expect(manifest.icon).toBe(`./${make.ICON_IN_THE_PLUGIN}`);
      const file = join(ROOT, folder, manifest.icon ?? '');
      expect(existsSync(file)).toBe(true);
      expect(readFileSync(file).equals(make.theIcon())).toBe(true);
    },
    60_000,
  );

  it('is checked by the script, which exits 0 on the committed files', () => {
    const ran = spawnSync(process.execPath, [MAKE, '--check'], { encoding: 'utf-8' });
    expect({ status: ran.status, stderr: ran.stderr }).toEqual({ status: 0, stderr: '' });
  }, 60_000);

  it('is caught by the script when a file is not what the drawing makes, or is missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'mnema-icon-'));
    try {
      const [first, second] = make.PLUGIN_FOLDERS as [string, string];
      const wrong = join(root, first, make.ICON_IN_THE_PLUGIN);
      mkdirSync(dirname(wrong), { recursive: true });
      writeFileSync(wrong, make.theIcon().subarray(0, 100));
      const found = make.theFiles(root);
      expect(found.map((one) => one.current)).toEqual([false, false]);
      expect(found.map((one) => one.path)).toEqual([
        wrong,
        join(root, second, make.ICON_IN_THE_PLUGIN),
      ]);
      // NON-VACUITY: with both files as drawn, nothing is stale.
      for (const one of found) {
        mkdirSync(dirname(one.path), { recursive: true });
        writeFileSync(one.path, one.png);
      }
      expect(make.theFiles(root).map((one) => one.current)).toEqual([true, true]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});
