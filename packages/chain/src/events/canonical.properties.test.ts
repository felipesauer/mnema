/**
 * THE CANONICAL FORM, HELD AS A PROPERTY over generated values rather than the handful a
 * person thought of: `FORMAT.md` section 1 says what the bytes of an event are, and this asks the
 * three things a reader of that section relies on.
 *
 *   - P3, the round trip: what `canonicalStringify` writes, `parseCanonicalLine` reads back as
 *     the value it was written from — normalized the way the section says (strings and keys in
 *     NFC, a negative zero as zero) — and writing that again changes no byte;
 *   - the bytes ARE the definition: they equal what a model of the section's sentences writes,
 *     a short recursive encoder that shares nothing with the one in `canonical.ts`;
 *   - a line that is not those bytes is REFUSED, whatever the value: spaced out, or with its
 *     keys in another order.
 *
 * The generator draws what makes a canonicalizer fork: text in both Unicode compositions,
 * astral characters, numbers on the edges of what JSON spells, and keys that collide once
 * normalized — which the section says is a refusal, so the model refuses them too.
 *
 * The seed is fixed so the CI is the same run every time; `FC_SEED` explores another.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CanonicalizationError, type CanonicalValue, canonicalStringify } from './canonical.js';
import { parseCanonicalLine } from './stored-json.js';

const SEED = Number(process.env.FC_SEED ?? 20_261_007);

/** Text as people type it: composed and decomposed, astral, and anything the encoding holds. */
const textArb: fc.Arbitrary<string> = fc.oneof(
  fc.string({ unit: 'binary', maxLength: 12 }).filter((text) => !/\p{Surrogate}/u.test(text)),
  fc
    .array(fc.constantFrom('e', 'é', 'é', 'Å', 'Å', 'Å', 'ﬃ', '😀', 'ß', '"', '\\', '\n'), {
      maxLength: 6,
    })
    .map((parts) => parts.join('')),
);

const numberArb: fc.Arbitrary<number> = fc.oneof(
  fc.integer(),
  fc.double({ noNaN: true, noDefaultInfinity: true }),
  fc.constantFrom(-0, 0, 1e21, 1e-7, 123456789012345680000, Number.MAX_SAFE_INTEGER, -1.5e-300),
);

/** A key that is not `__proto__`: an own property of that name is another property's problem. */
const keyArb = textArb.filter((key) => key !== '__proto__');

const valueArb: fc.Arbitrary<CanonicalValue> = fc.letrec<{ value: CanonicalValue }>((tie) => ({
  value: fc.oneof(
    { maxDepth: 3 },
    fc.constant(null),
    fc.boolean(),
    numberArb,
    textArb,
    fc.array(tie('value'), { maxLength: 4 }),
    fc.dictionary(keyArb, tie('value'), { maxKeys: 4 }),
  ),
})).value;

/**
 * THE MODEL: section 1 in a few lines. Strings and keys in NFC, a key's collision after that is a
 * refusal, members sorted by code unit, `-0` written as `0`, no whitespace. Returns the
 * normalized value alongside the text, so the round trip has something to be compared with that
 * was not read back from the bytes.
 */
function model(value: CanonicalValue): { text: string; normalized: CanonicalValue } {
  if (value === null || typeof value === 'boolean') {
    return { text: JSON.stringify(value), normalized: value };
  }
  if (typeof value === 'number') {
    const same = value === 0 ? 0 : value;
    return { text: JSON.stringify(same), normalized: same };
  }
  if (typeof value === 'string') {
    const nfc = value.normalize('NFC');
    return { text: JSON.stringify(nfc), normalized: nfc };
  }
  if (Array.isArray(value)) {
    const items = (value as readonly CanonicalValue[]).map(model);
    return {
      text: `[${items.map((item) => item.text).join(',')}]`,
      normalized: items.map((item) => item.normalized),
    };
  }
  const entries = Object.entries(value as { readonly [key: string]: CanonicalValue }).map(
    ([key, member]) => ({ key: key.normalize('NFC'), ...model(member) }),
  );
  if (new Set(entries.map((entry) => entry.key)).size !== entries.length) {
    throw new CanonicalizationError('keys collide once normalized');
  }
  entries.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return {
    text: `{${entries.map((entry) => `${JSON.stringify(entry.key)}:${entry.text}`).join(',')}}`,
    normalized: Object.fromEntries(entries.map((entry) => [entry.key, entry.normalized])),
  };
}

/** The model's answer, or the word that it refuses — what a value earns under section 1. */
function expected(value: CanonicalValue): { text: string; normalized: CanonicalValue } | 'refused' {
  try {
    return model(value);
  } catch (error) {
    if (error instanceof CanonicalizationError) return 'refused';
    throw error;
  }
}

function holds<T>(arbitrary: fc.Arbitrary<T>, predicate: (value: T) => void, runs = 300): void {
  fc.assert(fc.property(arbitrary, predicate), { seed: SEED, numRuns: runs });
}

describe('the canonical form, over generated values', () => {
  it('writes the bytes the section defines, and refuses what it says it refuses', () => {
    holds(valueArb, (value) => {
      const said = expected(value);
      if (said === 'refused') {
        expect(() => canonicalStringify(value)).toThrow(CanonicalizationError);
      } else {
        expect(canonicalStringify(value)).toBe(said.text);
      }
    });
  });

  it('P3: what is written is read back as the normalized value, and writing it again changes no byte', () => {
    holds(valueArb, (value) => {
      const said = expected(value);
      fc.pre(said !== 'refused');
      const written = canonicalStringify(value);
      const read = parseCanonicalLine(written);
      expect(read).toEqual((said as { normalized: CanonicalValue }).normalized);
      expect(canonicalStringify(read as CanonicalValue)).toBe(written);
    });
  });

  it('the order the keys are given in is never in the bytes', () => {
    holds(valueArb, (value) => {
      const reordered = (v: CanonicalValue): CanonicalValue =>
        Array.isArray(v)
          ? (v as readonly CanonicalValue[]).map(reordered)
          : v !== null && typeof v === 'object'
            ? Object.fromEntries(
                Object.entries(v as { readonly [key: string]: CanonicalValue })
                  .map(([key, member]): [string, CanonicalValue] => [key, reordered(member)])
                  .reverse(),
              )
            : v;
      fc.pre(expected(value) !== 'refused');
      expect(canonicalStringify(reordered(value))).toBe(canonicalStringify(value));
    });
  });

  it('a stored line that is not exactly those bytes is refused', () => {
    holds(valueArb, (value) => {
      fc.pre(expected(value) !== 'refused');
      const written = canonicalStringify(value);
      const spaced = JSON.stringify(parseCanonicalLine(written), null, 1);
      // A scalar has no whitespace to add; every other value spelled with some is a different line.
      fc.pre(spaced !== written);
      expect(() => parseCanonicalLine(spaced)).toThrow();
    });
  });
});
