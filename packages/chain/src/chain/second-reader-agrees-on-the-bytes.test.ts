/**
 * SECTION 1.4 ANCHORS THE BYTES TO A JAVASCRIPT IMPLEMENTATION — so here is the JavaScript.
 *
 * Rule 4 of section 1 reads: *Strings are escaped by JSON semantics (the shortest form
 * `JSON.stringify` produces).* That is not a rule an implementer outside JavaScript can
 * check; it is a pointer at a runtime they do not have. And section 1 says nothing at all
 * about how a NUMBER is spelled beyond `-0` (gap G04), which is where the languages
 * actually part company:
 *
 *              JavaScript      Python default      Go encoding/json
 *   1.0        1               1.0                 1
 *   1e-7       1e-7            1e-07               1e-07
 *   1e20       100000000000…   1e+20               1e+20
 *   "<>&"      "<>&"           "<>&"               "<>&"
 *
 * A Go implementer can obey rules 1 through 6 exactly and still produce different bytes,
 * because `encoding/json` escapes `<`, `>` and `&` by default. That is not a hypothetical:
 * it is three characters that appear in any task title.
 *
 * SO THIS FILE DOES NOT ARGUE, IT RUNS BOTH. The corpus is built to hit every place two
 * serializers could differ, `JSON.stringify` here is the anchor rule 4 names, and the
 * second reader's canonicalizer is asked for the same bytes through a pipe that carries
 * them as hex — hex because half the corpus is control bytes and lone surrogates, and a
 * comparison whose transport mangles the input compares nothing.
 *
 * WHERE THE TWO MUST *NOT* AGREE, THAT IS ASSERTED TOO. `JSON.stringify` of a lone
 * surrogate is `"\ud800"` — valid output. Section 1 refuses lone surrogates two paragraphs
 * below rule 4, so a faithful implementation must refuse where the anchor produces. The
 * two halves of section 1 only agree by cross-reference and the document never makes it
 * (gap G05), so the refusal is asserted rather than assumed.
 *
 * The rule as it should have been written is now IN section 1.4, and `verifier/mnemaverify/gaps.py`
 * carries the entry that says why it was not there before (G05).
 */

import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import { canonicalStringify } from '../events/canonical.js';

const VERIFIER = new URL('../../verifier/mnema_verify.py', import.meta.url).pathname;

/** One code point, spelled so that no byte of this file is a character nobody can see. */
const cp = (...codes: readonly number[]): string => String.fromCodePoint(...codes);

interface Canonicalized {
  readonly canonical?: string;
  readonly refused?: string;
  readonly section?: string;
}

/**
 * Hand the second reader a list of values and get back what it made of each one.
 *
 * Each value travels as its own line of `JSON.stringify`, so a lone surrogate arrives as
 * the `\ud800` escape the anchor itself produces — which is exactly the input whose
 * treatment is in question. One per line because the second reader refuses at PARSE time,
 * and a refusal inside an array would refuse the array.
 */
function canonicalizedBySecondReader(values: readonly unknown[]): readonly Canonicalized[] {
  return sendLines(values.map((value) => JSON.stringify(value)));
}

/** The same pipe, for inputs no JavaScript value can express — a duplicate key. */
function sendLines(lines: readonly string[]): readonly Canonicalized[] {
  const run = spawnSync('python3', [VERIFIER, 'canonicalize'], {
    encoding: 'utf-8',
    input: `${lines.join('\n')}\n`,
  });
  if (run.error !== undefined) {
    throw new Error(`python3 could not be run, and this suite requires it: ${run.error.message}`);
  }
  if (run.status !== 0 || run.stdout === '') {
    throw new Error(`the second reader could not canonicalize: ${run.stderr}`);
  }
  return JSON.parse(run.stdout) as readonly Canonicalized[];
}

/** The bytes the second reader produced, decoded — or a thrown reason if it refused. */
function bytesOf(result: Canonicalized, what: string): string {
  if (result.canonical === undefined) {
    throw new Error(`the second reader refused ${what}: ${result.refused}`);
  }
  return Buffer.from(result.canonical, 'hex').toString('utf-8');
}

/**
 * STRINGS: every place two serializers could disagree about an escape.
 *
 * Each row is (what it is, the string). The expected bytes are not typed out here — they
 * are `JSON.stringify` of the NFC form, because that is what rule 4 and rule 3 say
 * together, and typing them out would be a third opinion nobody asked for.
 */
const STRINGS: readonly (readonly [string, string])[] = [
  ['a solidus, which JSON allows escaping and this format does not', '/'],
  ['a solidus inside a path, which is what actually appears', 'packages/chain/FORMAT.md'],
  ['U+2028, the line separator JavaScript source cares about and JSON does not', cp(0x2028)],
  ['U+2029, its paragraph twin', cp(0x2029)],
  ['U+007F, delete: a control character that is NOT escaped', cp(0x7f)],
  ['U+0085, next line: above U+007F, so not escaped either', cp(0x85)],
  ['U+009F, the top of the C1 block', cp(0x9f)],
  ['U+00A0, a non-breaking space, which survives verbatim', cp(0xa0)],
  ['the three characters Go escapes by default', '<>&'],
  ['an HTML-shaped title, which is where those three turn up', 'fix <Editor> && bump'],
  ['U+0000, which has no short form', cp(0x00)],
  ['U+001F, the last one below the space', cp(0x1f)],
  ['U+000B, vertical tab: a control with no short form in JSON', cp(0x0b)],
  ['the five controls that DO have a short form', '\b\t\n\f\r'],
  ['a quote and a backslash', 'a"b\\c'],
  ['a decomposed e-acute, which rule 3 normalizes', cp(0x65, 0x301)],
  ['a composed e-acute, which is what it normalizes to', cp(0xe9)],
  ['a decomposed Hangul syllable', cp(0x1100, 0x1161)],
  ['a string that NFC leaves alone but NFD would not', cp(0x212b)],
  ['an emoji, which is a surrogate pair in UTF-16 and four bytes in UTF-8', cp(0x1f3af)],
  ['a plane-2 code point', cp(0x2f800)],
  ['U+FFFD, the replacement character', cp(0xfffd)],
  ['U+200B, a zero-width space, which is a character and not nothing', cp(0x200b)],
  ['the empty string', ''],
  ['a zero-width joiner sequence', cp(0x1f468, 0x200d, 0x1f4bb)],
];

/**
 * NUMBERS: gap G04, which section 1 leaves entirely open.
 *
 * The exponent thresholds are ECMA-262's — exponential below 1e-6 and at or above 1e21 —
 * and they are the two boundaries every other language's default gets wrong.
 */
const NUMBERS: readonly (readonly [string, number])[] = [
  ['zero', 0],
  ['negative zero, which rule 5 names', -0],
  ['a small integer', 42],
  ['a negative integer', -7],
  ['an integral float, which JavaScript spells without a point', 1.0],
  ['a hundred as a float', 100.0],
  ['a half', 1.5],
  ['a tenth, whose shortest round-trip is not its exact value', 0.1],
  ['the sum that is famously not 0.3', 0.1 + 0.2],
  ['1e-6, the last one written out in full', 1e-6],
  ['1e-7, the first one written exponentially', 1e-7],
  ['1.5e-7, exponential with a mantissa', 1.5e-7],
  ['1e20, the last one written out in full', 1e20],
  ['1e21, the first one written exponentially', 1e21],
  ['the largest finite double', 1.7976931348623157e308],
  ['the smallest subnormal', 5e-324],
  ['a value needing seventeen digits', 1.2345678901234567],
  // Written as the double it is rather than as the integer it looks like: a literal past
  // 2**53 is silently a different number, which the linter is right to refuse and which is
  // itself the reason section 1 needs a spelling rule at all.
  [
    'a magnitude past 2**53, where a double is no longer the integer it prints',
    1.2345678901234567e19,
  ],
  ['a negative exponential', -1e-7],
];

describe('the second reader escapes a string the way section 1.4 says', () => {
  it.each(STRINGS)('agrees on %s', (_what, value) => {
    const [result] = canonicalizedBySecondReader([value]);
    // Rule 3 then rule 4: NFC first, then the escaping the anchor produces.
    expect(bytesOf(result as Canonicalized, _what)).toBe(JSON.stringify(value.normalize('NFC')));
  });

  it('agrees on all of them at once, so no row is passing on another row s bytes', () => {
    const values = STRINGS.map(([, value]) => value);
    const produced = canonicalizedBySecondReader(values);
    expect(produced).toHaveLength(values.length);
    expect(produced.map((result, at) => bytesOf(result, String(at)))).toEqual(
      values.map((value) => JSON.stringify(value.normalize('NFC'))),
    );
  });
});

describe('the second reader spells a number the way section 1 does not say', () => {
  it.each(NUMBERS)('agrees on %s', (_what, value) => {
    const [result] = canonicalizedBySecondReader([value]);
    expect(bytesOf(result as Canonicalized, _what)).toBe(JSON.stringify(value));
  });

  it('agrees on the three spellings that separate JavaScript from every default', () => {
    // Named separately because these are the rows a reimplementation gets wrong, and a
    // parameterized case that stopped covering them would still be green.
    const [one, tiny, big] = canonicalizedBySecondReader([1.0, 1e-7, 1e20]);
    expect(bytesOf(one as Canonicalized, '1.0')).toBe('1');
    expect(bytesOf(tiny as Canonicalized, '1e-7')).toBe('1e-7');
    expect(bytesOf(big as Canonicalized, '1e20')).toBe('100000000000000000000');
  });
});

describe('the second reader refuses where the anchor would have produced', () => {
  const LONE = [
    ['a lone high surrogate', cp(0xd800)],
    ['a lone low surrogate', cp(0xdfff)],
    ['a lone surrogate inside a longer string', `before${cp(0xd83c)}after`],
  ] as const;

  it.each(LONE)('refuses %s, which JSON.stringify happily emits', (_what, value) => {
    // The anchor produces bytes for this. Rule 4 read alone therefore says to emit them,
    // and the refusal list two paragraphs down says not to (gap G05).
    expect(JSON.stringify(value)).toMatch(/\\ud[89a-f][0-9a-f]{2}/i);
    const [result] = canonicalizedBySecondReader([value]);
    expect(result?.canonical, `${_what} was accepted`).toBeUndefined();
    expect(result?.refused).toContain('lone surrogate');
    expect(result?.section).toBe('1');
  });

  it('refuses a key that a duplicate normalizes onto, which no parser reports by itself', () => {
    // Sent as raw text rather than through JSON.stringify of an object, because an object
    // literal in JavaScript cannot hold two keys that are the same string — the collision
    // only exists on the wire.
    const [result] = sendLines([`{"${cp(0xe9)}":1,"${cp(0x65, 0x301)}":2}`]);
    expect(result?.canonical).toBeUndefined();
    expect(result?.refused).toContain('normalize to the same string');
  });

  it('refuses a literal duplicate key, which every library parser keeps the last of', () => {
    const [result] = sendLines(['{"a":1,"a":2}']);
    expect(result?.canonical).toBeUndefined();
    expect(result?.refused).toContain('duplicate object key');
  });
});

/**
 * KEY ORDER: rule 1 says UTF-16 code unit, and that is not code point order.
 *
 * Above U+FFFF a code point is a surrogate pair starting at 0xD800, so U+10000 sorts
 * BEFORE U+E000 and U+FFFD by code unit and after them by code point. Any implementation
 * that sorts by code point — which is what Python, Rust and Go all do naturally — gets
 * this wrong, and section 1 is one of the few places the document is precise enough to
 * catch it.
 *
 * The expected string is built here from `Array.prototype.sort`, which sorts by code unit
 * because that is what JavaScript string comparison is.
 */
describe('the second reader sorts keys by UTF-16 code unit', () => {
  const KEYS = [
    cp(0xfffd),
    cp(0x10000),
    cp(0xe000),
    cp(0xd7ff),
    'a',
    'A',
    cp(0xe9),
    cp(0x1f3af),
    '',
    'zzz',
  ];

  it('puts U+10000 before U+E000 and U+FFFD, which code point order would not', () => {
    const byCodeUnit = [...KEYS].sort();
    const byCodePoint = [...KEYS].sort(
      (left, right) => (left.codePointAt(0) ?? -1) - (right.codePointAt(0) ?? -1),
    );
    // NON-VACUITY: if the two orders were the same, this whole case would prove nothing.
    expect(byCodeUnit).not.toEqual(byCodePoint);

    const object = Object.fromEntries(KEYS.map((key, at) => [key, at]));
    const [result] = canonicalizedBySecondReader([object]);
    const expected = `{${byCodeUnit
      .map((key) => `${JSON.stringify(key)}:${KEYS.indexOf(key)}`)
      .join(',')}}`;
    expect(bytesOf(result as Canonicalized, 'the key set')).toBe(expected);
  });

  it('sorts recursively, and leaves array order alone', () => {
    const value = { b: [3, 1, 2], a: { d: 1, c: [{ f: 1, e: 2 }] } };
    const [result] = canonicalizedBySecondReader([value]);
    expect(bytesOf(result as Canonicalized, 'a nested value')).toBe(
      '{"a":{"c":[{"e":2,"f":1}],"d":1},"b":[3,1,2]}',
    );
  });
});

/**
 * AND THE PRODUCT'S OWN CANONICALIZER, over the same corpus.
 *
 * The two cases above compare the second reader against `JSON.stringify`, which is the
 * anchor the document names. This one compares it against THE PRODUCT — the third reading,
 * and the one that would catch the case where the document's anchor and the product's
 * implementation of it have drifted apart. That is a thing that can happen: the anchor is
 * prose, and prose stays green.
 */
describe('the second reader and the product produce the same bytes', () => {
  it('over every string in the corpus', () => {
    const values = STRINGS.map(([, value]) => value);
    const produced = canonicalizedBySecondReader(values);
    expect(produced.map((result, at) => bytesOf(result, String(at)))).toEqual(
      values.map((value) => canonicalStringify(value)),
    );
  });

  it('over every number in the corpus', () => {
    const values = NUMBERS.map(([, value]) => value);
    const produced = canonicalizedBySecondReader(values);
    expect(produced.map((result, at) => bytesOf(result, String(at)))).toEqual(
      values.map((value) => canonicalStringify(value)),
    );
  });

  it('over an object whose keys straddle U+FFFF', () => {
    const value = Object.fromEntries(
      [cp(0xfffd), cp(0x10000), cp(0xe000), 'a'].map((key, at) => [key, at]),
    );
    const [result] = canonicalizedBySecondReader([value]);
    expect(bytesOf(result as Canonicalized, 'the straddling object')).toBe(
      canonicalStringify(value),
    );
  });
});
