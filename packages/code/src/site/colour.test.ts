/**
 * THE PAGE'S COLOUR ARITHMETIC IS THE WCAG'S.
 *
 * The darker accent small text needs is calculated by one rule here (`textAccent`), over known contrast ratios
 * (computed by hand from the WCAG formula, so the code does not grade itself). The site, which is built in its own
 * repository, keeps its own copy of the rule and its own cases.
 */

import { describe, expect, it } from 'vitest';
import { contrastOf, mix, textAccent } from './colour.js';

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
});
