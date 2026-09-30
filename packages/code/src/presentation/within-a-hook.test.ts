/**
 * The one rule a text is cut by to stay inside what a hook carries — held here on its own, and
 * in `brief.test.ts`, `recall.test.ts` and `the-record-arrives-unasked.test.ts` over the texts
 * it binds.
 */

import { describe, expect, it } from 'vitest';
import { fitWhole, HOOK_TEXT_CEILING, printedLength, roomBeside } from './within-a-hook.js';

/** A text of `shown` items of ten characters each, and a declaration when it was cut. */
function composing(total: number) {
  const asked: number[] = [];
  const compose = (shown: number): string[] => {
    asked.push(shown);
    return [
      'head',
      ...Array.from({ length: shown }, (_, at) => `item ${String(at).padStart(4, '0')}`),
      ...(shown < total ? [`${total - shown} left out`] : []),
    ];
  };
  return { compose, asked };
}

describe('what a hook carries', () => {
  it('counts what the host counts: the string’s length, a newline after every line', () => {
    expect(printedLength([])).toBe(0);
    expect(printedLength(['ab', ''])).toBe(4);
    // An astral character is two units of the string, and the host measures units.
    expect(printedLength(['\u{1F600}'])).toBe(3);
  });

  it('sets aside what the same run says on its second stream, and the blank line before it', () => {
    expect(roomBeside([])).toBe(HOOK_TEXT_CEILING);
    // Two lines joined by a newline, trimmed, and the two newlines the handler puts before them.
    expect(roomBeside(['issue [T1] x', 'still on the tail'])).toBe(
      HOOK_TEXT_CEILING - ('issue [T1] x\nstill on the tail'.length + 2),
    );
  });
});

describe('the cut', () => {
  it('returns the whole text when it fits, and asks for nothing else', () => {
    const { compose, asked } = composing(3);
    const fitted = fitWhole(3, 1_000, compose);
    expect(asked).toEqual([3]);
    expect(fitted).toEqual(compose(3));
  });

  it('keeps the most whole items that fit with their declaration, in order', () => {
    const { compose } = composing(20);
    // head(5) + n × 10 + "N left out"(12 or 11): 5 items fit in 70, a sixth would not.
    const cut = fitWhole(20, 70, compose);
    expect(printedLength(cut)).toBeLessThanOrEqual(70);
    expect(cut).toEqual(compose(5));
    expect(cut.at(-1)).toBe('15 left out');
  });

  it('stops climbing at the first item that does not fit — the work is bounded by the room', () => {
    const { compose, asked } = composing(100_000);
    fitWhole(100_000, 70, compose);
    // The whole, then 1 to 6: never the hundred thousand in between.
    expect(asked).toEqual([100_000, 0, 1, 2, 3, 4, 5, 6]);
  });

  it('hands back the fixed part and its declaration when not even one item fits', () => {
    const { compose } = composing(4);
    expect(fitWhole(4, 1, compose)).toEqual(['head', '4 left out']);
  });
});
