/**
 * THE CANONICAL FORM REFUSES, BY NAME AND AT THE EDGE, WHAT IT CANNOT SPELL TWICE THE SAME WAY.
 *
 * Each case pins one edge a mutation run found unpinned: the exact boundaries of a lone
 * surrogate, the words of the refusals (the censuses and the CLI print them), and the order of
 * many keys (a small array never reaches the comparator's `>` side).
 */

import { describe, expect, it } from 'vitest';
import { CanonicalizationError, type CanonicalValue, canonicalStringify } from './canonical.js';

const refusal = (value: unknown): CanonicalizationError => {
  try {
    canonicalStringify(value as CanonicalValue);
  } catch (error) {
    expect(error).toBeInstanceOf(CanonicalizationError);
    return error as CanonicalizationError;
  }
  throw new Error('the value was spelled, and it should have been refused');
};

describe('a lone surrogate is refused at every edge of the range', () => {
  it('refuses a high surrogate followed by anything that is not a low one', () => {
    for (const next of ['a', '퟿', '', '\ud800']) {
      expect(refusal(`\ud800${next}`).message).toBe(
        'cannot canonicalize a string with a lone surrogate',
      );
    }
  });

  it('spells a pair whose low half is the first or the last of the range', () => {
    expect(canonicalStringify('𐀀')).toBe('"𐀀"');
    expect(canonicalStringify('􏿿')).toBe('"􏿿"');
  });

  it('refuses a low surrogate at the edges of its range, alone', () => {
    expect(refusal('\udc00').message).toContain('lone surrogate');
    expect(refusal('\udfff').message).toContain('lone surrogate');
    expect(canonicalStringify('')).toBe('""');
  });
});

describe('a refusal says what it refused', () => {
  it('names the error and the kind of value that has no form', () => {
    const error = refusal(Number.NaN);
    expect(error.name).toBe('CanonicalizationError');
    expect(error.message).toBe('cannot canonicalize the non-finite number NaN');
    expect(refusal(Number.NEGATIVE_INFINITY).message).toBe(
      'cannot canonicalize the non-finite number -Infinity',
    );
    expect(refusal(undefined).message).toBe('cannot canonicalize a undefined value');
    expect(refusal(() => 1).message).toBe('cannot canonicalize a function value');
    expect(refusal(10n).message).toBe('cannot canonicalize a bigint value');
    expect(refusal(Symbol('s')).message).toBe('cannot canonicalize a symbol value');
  });

  it('names the key whose value is undefined', () => {
    expect(refusal({ a: 1, kept: undefined }).message).toBe(
      'cannot canonicalize an undefined value at key "kept"',
    );
  });
});

describe('many keys are ordered, however they arrive', () => {
  const ascending = Array.from({ length: 64 }, (_, index) => `k${String(index).padStart(2, '0')}`);
  const expected = `{${ascending.map((key) => `"${key}":${ascending.indexOf(key)}`).join(',')}}`;

  it('spells 64 keys inserted descending in ascending order', () => {
    const object: Record<string, number> = {};
    for (const key of [...ascending].reverse()) object[key] = ascending.indexOf(key);
    expect(canonicalStringify(object)).toBe(expected);
  });

  it('spells the same 64 keys inserted in a fixed shuffle the same way', () => {
    const object: Record<string, number> = {};
    for (let step = 0; step < ascending.length; step += 1) {
      const key = ascending[(step * 37) % ascending.length] as string;
      object[key] = ascending.indexOf(key);
    }
    expect(canonicalStringify(object)).toBe(expected);
  });
});
