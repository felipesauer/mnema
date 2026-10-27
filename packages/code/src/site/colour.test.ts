/**
 * THE PAGE'S COLOUR ARITHMETIC IS THE SITE'S.
 *
 * The darker accent small text needs is calculated by one rule on the site (`textAccent` in the
 * site's build) and by a written-again copy of it here, because the site is a tree the product does
 * not ship. A copy is only the same rule while something holds the two to the same answers: this
 * does, over known contrast ratios (computed by hand from the WCAG formula, so neither copy
 * grades itself) and over the real accent and grounds and a spread of other ones.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contrastOf, mix, textAccent } from './colour.js';

interface TheSite {
  contrastOf(one: string, other: string): number;
  mix(from: string, toward: string, share: number): string;
  textAccent(options: {
    ink: string;
    toward: string;
    grounds: readonly string[];
    floor: number;
  }): string;
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const site = (await import(
  pathToFileURL(join(ROOT, 'site', 'build', 'the-pages.mjs')).href
)) as TheSite;

describe('the contrast of two colours', () => {
  it('is the WCAG ratio: 21 for black on white, 1 for a colour on itself, the same either way round', () => {
    expect(contrastOf('#000000', '#ffffff')).toBeCloseTo(21, 10);
    expect(contrastOf('#997dbf', '#997dbf')).toBe(1);
    expect(contrastOf('#ffffff', '#997dbf')).toBe(contrastOf('#997dbf', '#ffffff'));
    // (1 + 0.05) / (0.2126 * ((0.5 + 0.055) / 1.055) ** 2.4 + ... + 0.05), for sRGB mid grey 0x80.
    expect(contrastOf('#808080', '#ffffff')).toBeCloseTo(3.949, 3);
  });
});

describe('the mix of two colours', () => {
  it('goes channel by channel, rounded', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mix('#102030', '#102030', 0.7)).toBe('#102030');
    expect(mix('#ffffff', '#000000', 0)).toBe('#ffffff');
  });
});

describe('the accent as small text', () => {
  it('stays the accent where the accent already reads, and darkens it where it does not', () => {
    expect(
      textAccent({ ink: '#c4a0f5', toward: '#ffffff', grounds: ['#0d1117'], floor: 4.5 }),
    ).toBe('#c4a0f5');
    const darker = textAccent({
      ink: '#997dbf',
      toward: '#0d1117',
      grounds: ['#ffffff'],
      floor: 4.5,
    });
    expect(darker).not.toBe('#997dbf');
    expect(contrastOf(darker, '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });

  it('stops, and says which colours, when no mix reads', () => {
    expect(() =>
      textAccent({ ink: '#ffffff', toward: '#ffffff', grounds: ['#ffffff'], floor: 4.5 }),
    ).toThrow('no mix of #ffffff toward #ffffff reads at 4.5:1 on #ffffff');
  });

  it("gives the site's answers: over the banner's colours and over a spread of grounds and floors", () => {
    const inks = ['#c4a0f5', '#997dbf', '#ff0000', '#00aa55'];
    const grounds = [
      ['#0d1117'],
      ['#ffffff'],
      ['#ffffff', '#f6f8fa'],
      ['#0d1117', '#161b22', '#2a2f37'],
    ];
    let compared = 0;
    for (const ink of inks) {
      for (const toward of ['#ffffff', '#0d1117']) {
        for (const on of grounds) {
          for (const floor of [3, 4.5, 7]) {
            const options = { ink, toward, grounds: on, floor };
            const theirs = (() => {
              try {
                return site.textAccent(options);
              } catch (error) {
                return String(error);
              }
            })();
            const ours = (() => {
              try {
                return textAccent(options);
              } catch (error) {
                return String(error);
              }
            })();
            expect(ours, JSON.stringify(options)).toBe(theirs);
            compared++;
          }
        }
      }
    }
    expect(compared).toBe(4 * 2 * 4 * 3);
    for (const [a, b] of [
      ['#c4a0f5', '#0d1117'],
      ['#997dbf', '#ffffff'],
      ['#123456', '#fedcba'],
    ] as const) {
      expect(contrastOf(a, b)).toBe(site.contrastOf(a, b));
      expect(mix(a, b, 0.37)).toBe(site.mix(a, b, 0.37));
    }
  });
});
