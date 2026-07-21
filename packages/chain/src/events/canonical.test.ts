import { describe, expect, it } from 'vitest';

import {
  CanonicalizationError,
  type CanonicalValue,
  canonicalBytes,
  canonicalStringify,
} from './canonical.js';

describe('canonicalStringify', () => {
  it('sorts object keys so insertion order cannot change the bytes', () => {
    const a = canonicalStringify({ b: 1, a: 2, c: 3 });
    const b = canonicalStringify({ c: 3, a: 2, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":2,"b":1,"c":3}');
  });

  it('sorts keys recursively', () => {
    const value: CanonicalValue = { outer: { z: 1, a: 2 }, first: [{ y: 1, x: 2 }] };
    expect(canonicalStringify(value)).toBe('{"first":[{"x":2,"y":1}],"outer":{"a":2,"z":1}}');
  });

  it('preserves array order (order is semantic)', () => {
    expect(canonicalStringify([3, 1, 2])).toBe('[3,1,2]');
    expect(canonicalStringify([1, 2, 3])).not.toBe(canonicalStringify([3, 2, 1]));
  });

  it('round-trips: parse(canonical) re-canonicalizes to the same bytes', () => {
    const value: CanonicalValue = { kind: 'task.created', v: 1, payload: { title: 'x' }, at: 't' };
    const once = canonicalStringify(value);
    const twice = canonicalStringify(JSON.parse(once) as CanonicalValue);
    expect(twice).toBe(once);
  });

  it("is stable across a key-reordered re-parse (the alpha's failure mode)", () => {
    // An object whose keys arrive in a different order after a merge/reformat
    // must still canonicalize identically.
    const original = { at: '2026-01-01', kind: 'run.ended', v: 1, subject: 'r1', who: 'h' };
    const reordered = { who: 'h', v: 1, subject: 'r1', kind: 'run.ended', at: '2026-01-01' };
    expect(canonicalStringify(original)).toBe(canonicalStringify(reordered));
  });

  it('escapes strings via JSON semantics', () => {
    expect(canonicalStringify('a"b\\c')).toBe('"a\\"b\\\\c"');
    expect(canonicalStringify('\n')).toBe('"\\n"');
  });

  it('normalizes -0 to 0 so they cannot fork the bytes', () => {
    expect(canonicalStringify(-0)).toBe('0');
    expect(canonicalStringify(0)).toBe('0');
  });

  it('rejects non-finite numbers rather than silently coercing to null', () => {
    expect(() => canonicalStringify(Number.NaN as unknown as CanonicalValue)).toThrow(
      CanonicalizationError,
    );
    expect(() => canonicalStringify(Number.POSITIVE_INFINITY as unknown as CanonicalValue)).toThrow(
      CanonicalizationError,
    );
  });

  it('rejects an explicit undefined property rather than dropping it ambiguously', () => {
    const value = { a: 1, b: undefined } as unknown as CanonicalValue;
    expect(() => canonicalStringify(value)).toThrow(CanonicalizationError);
  });

  it('handles null and booleans', () => {
    expect(canonicalStringify(null)).toBe('null');
    expect(canonicalStringify(true)).toBe('true');
    expect(canonicalStringify(false)).toBe('false');
    expect(canonicalStringify({ a: null })).toBe('{"a":null}');
  });
});

describe('canonicalStringify — Unicode determinism', () => {
  // A composed (NFC) and decomposed (NFD) "é" render identically but are
  // byte-distinct; a renormalizing reformat would otherwise fork the bytes.
  const nfc = 'café'; // café with U+00E9
  const nfd = 'café'; // café with e + combining acute

  it('NFC-normalizes string values so equal text yields equal bytes', () => {
    expect(nfc).not.toBe(nfd);
    expect(canonicalStringify(nfc)).toBe(canonicalStringify(nfd));
  });

  it('NFC-normalizes object keys too', () => {
    expect(canonicalStringify({ [nfc]: 1 })).toBe(canonicalStringify({ [nfd]: 1 }));
  });

  it('rejects a lone surrogate (not valid Unicode text)', () => {
    expect(() => canonicalStringify('\ud800')).toThrow(CanonicalizationError);
    expect(() => canonicalStringify('\udc00x')).toThrow(CanonicalizationError);
  });

  it('accepts a valid surrogate pair (emoji)', () => {
    expect(canonicalStringify('👍')).toBe('"👍"');
  });

  it('refuses keys that collide after normalization', () => {
    // Build an object whose two keys normalize to the same string.
    const value = { [nfc]: 1, [nfd]: 2 } as unknown as CanonicalValue;
    // If the runtime already merged them (same NFC), there is one key and no
    // collision to detect; force distinct raw keys via a constructed object.
    const forced = Object.create(null) as Record<string, number>;
    forced[nfc] = 1;
    forced[nfd] = 2;
    // Both keys are distinct own properties only when they differ as raw
    // strings; assert the collision guard fires when they do.
    if (Object.keys(forced).length === 2) {
      expect(() => canonicalStringify(forced as unknown as CanonicalValue)).toThrow(
        /colliding keys/,
      );
    } else {
      // Environment merged the keys; the single-key object still canonicalizes.
      expect(() => canonicalStringify(value)).not.toThrow();
    }
  });
});

describe('canonicalBytes', () => {
  it('is the UTF-8 encoding of the canonical string', () => {
    const value: CanonicalValue = { m: 'café' };
    const bytes = canonicalBytes(value);
    expect(new TextDecoder().decode(bytes)).toBe(canonicalStringify(value));
    // 'é' is two UTF-8 bytes, proving encoding is byte-level not char-level.
    expect(bytes).toEqual(new TextEncoder().encode('{"m":"café"}'));
  });
});
