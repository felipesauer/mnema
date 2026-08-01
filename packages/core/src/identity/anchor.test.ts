/**
 * The short anchor: that it is a PREFIX, that it grows only when it must, and that
 * the two halves of the contract agree.
 *
 * The property under test is not "it is shorter". A hashed label would be shorter
 * too, and would pass every length check — and it would be uncheckable by hand and
 * impossible to type back. So the first test asserts what the value IS, against the
 * anchor's own characters, and the round trip asserts that what one half produces
 * the other half accepts.
 */

import { describe, expect, it } from 'vitest';
import { isAnchorId, resolveAnchorPrefix, SHORT_ANCHOR_HEX, shortenAnchors } from './anchor.js';

/** An anchor whose hex is `hex` padded out to the full 64 characters. */
const anchorOf = (hex: string) => `mnid:${hex.padEnd(64, '0')}`;

const A = anchorOf('a1b2c3d4e5f6');
const B = anchorOf('b0000000');
const C = anchorOf('c0000000');

describe('shortenAnchors', () => {
  it('gives a PREFIX of the anchor, not a label derived from it', () => {
    const short = shortenAnchors([A]).get(A) as string;
    expect(A.startsWith(short)).toBe(true);
    // …and specifically the anchor's own leading hex, which is what makes it
    // checkable by eye against the whole value with no lookup.
    expect(short).toBe(`mnid:${'a1b2c3d4e5f6'.slice(0, SHORT_ANCHOR_HEX)}`);
  });

  it('is the same length for everyone when nothing clashes', () => {
    const forms = shortenAnchors([A, B, C]);
    for (const anchor of [A, B, C]) {
      expect(forms.get(anchor)).toHaveLength('mnid:'.length + SHORT_ANCHOR_HEX);
    }
  });

  it('grows both sides of a clash, and both stay prefixes', () => {
    const one = anchorOf('abcdef0011');
    const two = anchorOf('abcdef0022');
    const forms = shortenAnchors([one, two, C]);
    const first = forms.get(one) as string;
    const second = forms.get(two) as string;
    expect(first).not.toBe(second);
    expect(one.startsWith(first)).toBe(true);
    expect(two.startsWith(second)).toBe(true);
    // Grown to exactly where they part — the ninth hex — and no further.
    expect(first).toHaveLength('mnid:'.length + 9);
    expect(second).toHaveLength('mnid:'.length + 9);
    // And the clash moves nobody else: only the two that clashed grew.
    expect(forms.get(C)).toHaveLength('mnid:'.length + SHORT_ANCHOR_HEX);
  });

  it('skips a value that is not shaped like an anchor', () => {
    expect(shortenAnchors(['not-an-anchor', A]).has('not-an-anchor')).toBe(false);
  });
});

describe('resolveAnchorPrefix', () => {
  it('takes back every form it hands out — the round trip, by construction', () => {
    const anchors = [A, B, C, anchorOf('a1b2c3d4ff')];
    for (const [anchor, short] of shortenAnchors(anchors)) {
      expect(resolveAnchorPrefix(short, anchors)).toEqual({ ok: true, anchor });
    }
  });

  it('takes a whole anchor the record has never seen', () => {
    // The joining machine's case: a fresh clone knows nobody, and the value it was
    // handed has to work anyway.
    expect(resolveAnchorPrefix(A, [])).toEqual({ ok: true, anchor: A });
  });

  it('takes a prefix with or without the `mnid:`', () => {
    expect(resolveAnchorPrefix('mnid:a1b2', [A, B])).toEqual({ ok: true, anchor: A });
    expect(resolveAnchorPrefix('a1b2', [A, B])).toEqual({ ok: true, anchor: A });
  });

  it('refuses an ambiguous prefix, naming what it could have meant', () => {
    const one = anchorOf('abcdef0011');
    const two = anchorOf('abcdef0022');
    expect(resolveAnchorPrefix('abcdef', [one, two, C])).toEqual({
      ok: false,
      reason: 'AMBIGUOUS_ANCHOR',
      candidates: [one, two],
    });
  });

  it('refuses a prefix nobody answers to, and says so as its own reason', () => {
    // Distinct from ambiguous on purpose: one value is real and under-specified,
    // the other names nothing, and the remedies are different.
    expect(resolveAnchorPrefix('zzzz', [A])).toEqual({
      ok: false,
      reason: 'UNKNOWN_ANCHOR',
      candidates: [],
    });
  });

  it('refuses an empty value even when there is only ONE identity to pick', () => {
    // The case the matching would get wrong on its own: an empty prefix matches
    // everyone, so a record with one identity would resolve it — and an empty value
    // is a variable that expanded to nothing, not a person naming themselves.
    expect(resolveAnchorPrefix('', [A])).toEqual({
      ok: false,
      reason: 'UNKNOWN_ANCHOR',
      candidates: [],
    });
    expect(resolveAnchorPrefix('   ', [A]).ok).toBe(false);
    expect(resolveAnchorPrefix('mnid:', [A]).ok).toBe(false);
    expect(resolveAnchorPrefix('', []).ok).toBe(false);
  });
});

describe('isAnchorId', () => {
  it('is the whole shape and nothing near it', () => {
    expect(isAnchorId(A)).toBe(true);
    expect(isAnchorId(A.slice(0, 20))).toBe(false);
    expect(isAnchorId(`${A}0`)).toBe(false);
    expect(isAnchorId(A.replace('mnid:', ''))).toBe(false);
    expect(isAnchorId(A.toUpperCase())).toBe(false);
  });
});
