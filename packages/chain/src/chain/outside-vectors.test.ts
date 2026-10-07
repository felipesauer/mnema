/**
 * THE VECTORS OTHER PEOPLE WROTE, run against both readers of section 1 and section 4.
 *
 * Everything else in this suite that checks the bytes was written by the people who wrote the
 * code it checks. These were not: they are copied, byte for byte, into
 * `packages/chain/conformance/vectors/`, with each source's license and commit in
 * `sources.json` and every file's SHA-256 in `SHA256SUMS`, so no case here needs the network.
 *
 *   - THE FILES ARE THE ONES COPIED. Every file in the directory has its sum, every sum has its
 *     file, and every sum matches.
 *   - THE NUMBER SPELLING (section 1, rule 7) against RFC 8785 Appendix B, read out of the RFC's
 *     own text, and against the first 10,000 lines of cyberphone's `numgen.js`. The generator
 *     runs UNMODIFIED, in a `vm` context whose `fs` stops it at the line wanted; the SHA-256 of
 *     what it wrote is the one its author published, so the expected column is somebody else's,
 *     not this machine's. Both the product's canonicalization and the second reader's must
 *     spell every one of those numbers the same way.
 *   - THE STORED LINE (section 4) against JSONTestSuite: every `n_` file, which a JSON parser
 *     must refuse, is refused by both readers, and on every `i_` file, which a parser may
 *     decide either way, the two readers decide the same — except where named below.
 *
 * The Ed25519 vectors of the same directory are run against the three signature verifiers in
 * `packages/code/tests/every-verifier-gives-one-ed25519-verdict.test.ts`, which needs the page's
 * verifier and so lives with it.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

import { canonicalStringify } from '../events/canonical.js';
import { parseCanonicalLine } from '../events/stored-json.js';
import { publicKeyFromPem, verify as verifySignature } from './keys.js';

const VECTORS = fileURLToPath(new URL('../../conformance/vectors/', import.meta.url));
const VERIFIER = fileURLToPath(new URL('../../verifier/', import.meta.url));

const sha256 = (bytes: Uint8Array | string): string =>
  createHash('sha256').update(bytes).digest('hex');

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [relative(VECTORS, path)];
  });
}

/** Runs a Python program with the second reader importable; JSON in on stdin, JSON out. */
function python(program: readonly string[], input: unknown): unknown {
  const run = spawnSync(
    'python3',
    ['-c', [`import sys; sys.path.insert(0, ${JSON.stringify(VERIFIER)})`, ...program].join('\n')],
    { encoding: 'utf-8', input: JSON.stringify(input), maxBuffer: 64 * 1024 * 1024 },
  );
  if (run.error !== undefined) {
    throw new Error(`python3 could not be run, and this suite requires it: ${run.error.message}`);
  }
  if (run.status !== 0) throw new Error(`the second reader failed: ${run.stderr}`);
  return JSON.parse(run.stdout);
}

describe('the outside vectors are the files that were copied', () => {
  const sums = new Map(
    readFileSync(join(VECTORS, 'SHA256SUMS'), 'utf-8')
      .trim()
      .split('\n')
      .map((line) => {
        const [sum, path] = line.split(/ {2}/) as [string, string];
        return [path, sum] as const;
      }),
  );

  it('has a sum for every file, and a file for every sum', () => {
    const present = filesUnder(VECTORS)
      .filter((path) => path !== 'SHA256SUMS' && path !== 'sources.json')
      .sort();
    expect(present).toEqual([...sums.keys()].sort());
    // Every n_ and i_ file of JSONTestSuite, and nothing it did not publish beside them.
    expect(present.filter((path) => path.startsWith('jsontestsuite/test_parsing/'))).toHaveLength(
      223,
    );
  });

  it('matches every sum', () => {
    const wrong = [...sums].filter(
      ([path, sum]) => sha256(readFileSync(join(VECTORS, path))) !== sum,
    );
    expect(wrong).toEqual([]);
  });

  it('names a source for every file, by the path it was copied to', () => {
    const sources = JSON.parse(readFileSync(join(VECTORS, 'sources.json'), 'utf-8')) as {
      sources: { files: Record<string, string>; license: string }[];
    };
    const named = sources.sources.flatMap((source) => Object.keys(source.files));
    const unnamed = [...sums.keys()].filter(
      (path) =>
        !named.some(
          (prefix) => path === prefix || (prefix.endsWith('/') && path.startsWith(prefix)),
        ),
    );
    expect(unnamed).toEqual([]);
    expect(sources.sources.every((source) => source.license !== '')).toBe(true);
  });
});

// ---- section 6: the strict Ed25519 rule, in the product's own source ------------------------

/**
 * The product's `verify`, from source, on the two sets that tell the strict rule from
 * `node:crypto`'s: CCTV, read by its flags, and speccheck, by its "Dalek strict" row. The case
 * that holds all three verifiers to every vector is
 * `packages/code/tests/every-verifier-gives-one-ed25519-verdict.test.ts`, which reads the BUILT
 * package; this one reads the source, so each refusal of `keys.ts` is reached here too.
 */
describe('the product refuses what the strict rule refuses, on every Node', () => {
  const REFUSED_FLAGS = [
    'low_order_A',
    'low_order_R',
    'non_canonical_A',
    'non_canonical_R',
    'low_order_residue',
  ];
  const pem = (key: string): string =>
    `-----BEGIN PUBLIC KEY-----\n${Buffer.from(`302a300506032b6570032100${key}`, 'hex').toString('base64')}\n-----END PUBLIC KEY-----\n`;
  const verdict = (key: string, sig: string, msg: Buffer): boolean =>
    verifySignature(
      new Uint8Array(msg),
      new Uint8Array(Buffer.from(sig, 'hex')),
      publicKeyFromPem(pem(key)),
    );

  it('on CCTV, accepting only what its flags say a strict verifier accepts', () => {
    const vectors = JSON.parse(
      readFileSync(join(VECTORS, 'cctv/ed25519vectors.json'), 'utf-8'),
    ) as {
      number: number;
      key: string;
      sig: string;
      msg: string;
      flags: string[] | null;
    }[];
    const wrong = vectors
      .filter(
        (v) =>
          verdict(v.key, v.sig, Buffer.from(v.msg, 'utf-8')) !==
          !(v.flags ?? []).some((flag) => REFUSED_FLAGS.includes(flag)),
      )
      .map((v) => v.number);
    expect(wrong).toEqual([]);
  });

  it('on speccheck, accepting case 3 only', () => {
    const cases = JSON.parse(readFileSync(join(VECTORS, 'speccheck/cases.json'), 'utf-8')) as {
      message: string;
      pub_key: string;
      signature: string;
    }[];
    expect(
      cases.map((c) => verdict(c.pub_key, c.signature, Buffer.from(c.message, 'hex'))),
    ).toEqual([false, false, false, true, false, false, false, false, false, false, false, false]);
  });

  it('refuses a signature of the wrong length, and an S at or past L, before node:crypto', () => {
    const cases = JSON.parse(readFileSync(join(VECTORS, 'speccheck/cases.json'), 'utf-8')) as {
      message: string;
      pub_key: string;
      signature: string;
    }[];
    const good = cases[3] as { message: string; pub_key: string; signature: string };
    const msg = Buffer.from(good.message, 'hex');
    expect(verdict(good.pub_key, good.signature, msg)).toBe(true);
    expect(verdict(good.pub_key, good.signature.slice(0, 126), msg)).toBe(false);
    // L itself, little-endian: the smallest S the rule refuses.
    const l = 'edd3f55c1a631258d69cf7a2def9de1400000000000000000000000000000010';
    expect(verdict(good.pub_key, `${good.signature.slice(0, 64)}${l}`, msg)).toBe(false);
  });
});

// ---- section 1, rule 7: the number spelling --------------------------------------------------

/** A double from the 1 to 16 hex digits of its IEEE 754 bits. */
function doubleOf(hex: string): number {
  const view = new DataView(new ArrayBuffer(8));
  view.setBigUint64(0, BigInt(`0x${hex}`));
  return view.getFloat64(0);
}

/**
 * The number as the second reader is handed it: seventeen significant digits, exponential, so it
 * names the same double without being the spelling under test. Negative zero is spelled out,
 * because `toExponential` drops its sign.
 */
const unlike = (x: number): string => (Object.is(x, -0) ? '-0.0' : x.toExponential(16));

/** The second reader's canonical spelling of each number, or null where it refused one. */
function spelledBySecondReader(inputs: readonly string[]): readonly (string | null)[] {
  return python(
    [
      'import json',
      'from mnemaverify.canonical import canonical, strict_loads',
      'from mnemaverify.verdict import Refusal',
      'out = []',
      'for text in json.load(sys.stdin):',
      '    try:',
      '        out.append(canonical(strict_loads(text)))',
      '    except Refusal:',
      '        out.append(None)',
      'print(json.dumps(out))',
    ],
    inputs,
  ) as (string | null)[];
}

function spelledByTheProduct(x: number): string | null {
  try {
    return canonicalStringify(x);
  } catch {
    return null;
  }
}

/** RFC 8785 Appendix B, read out of the RFC: (IEEE 754 hex, the spelling, or null for none). */
function appendixB(): (readonly [string, string | null])[] {
  const text = readFileSync(join(VECTORS, 'rfc8785/rfc8785.txt'), 'utf-8');
  const section = text.slice(
    text.indexOf('\nAppendix B.  Number Serialization Samples'),
    text.indexOf('\nAppendix C.  '),
  );
  return [...section.matchAll(/^ {3}\| ([0-9a-f]{16}) \| (\S*) +\|/gm)].map(
    (row) => [row[1] as string, row[2] === '' ? null : (row[2] as string)] as const,
  );
}

/**
 * cyberphone's `numgen.js`, run as published until it has written `lines` lines. Its `fs` is a
 * stand-in whose stream throws once it has them, which is the only way to stop a program written
 * to produce a hundred million; its `crypto` is Node's, which it uses to draw the random values.
 */
function numgen(lines: number): string[] {
  const source = readFileSync(join(VECTORS, 'cyberphone/numgen.js'), 'utf-8');
  const written: string[] = [];
  const enough = new Error('enough lines');
  const fs = {
    createWriteStream: () => ({
      write(line: string): void {
        written.push(line);
        if (written.length === lines) throw enough;
      },
      close(): void {},
    }),
  };
  const modules: Record<string, unknown> = { crypto: { createHash }, fs };
  try {
    runInNewContext(source, {
      require: (name: string) => modules[name],
      // `new Buffer(arrayBuffer)` is what the program calls; this is that, without the warning
      // the deprecated constructor prints. A `function`, because an arrow cannot be called with
      // `new`.
      Buffer: function wrap(data: ArrayBuffer) {
        return Buffer.from(data);
      },
    });
  } catch (error) {
    if (error !== enough) throw error;
  }
  return written;
}

describe('the number spelling of section 1 against RFC 8785 Appendix B', () => {
  const rows = appendixB();

  it('reads the 26 rows of the RFC table', () => {
    expect(rows).toHaveLength(26);
    expect(rows.filter(([, spelled]) => spelled === null)).toHaveLength(2);
  });

  it('the product spells each row as the RFC does, and refuses NaN and Infinity', () => {
    const wrong = rows.filter(([hex, spelled]) => spelledByTheProduct(doubleOf(hex)) !== spelled);
    expect(wrong).toEqual([]);
  });

  it('the second reader spells each row as the RFC does, and refuses NaN and Infinity', () => {
    const inputs = rows.map(([hex]) => {
      const x = doubleOf(hex);
      return Number.isNaN(x) ? 'NaN' : x === Number.POSITIVE_INFINITY ? 'Infinity' : unlike(x);
    });
    expect(spelledBySecondReader(inputs)).toEqual(rows.map(([, spelled]) => spelled));
  });
});

describe('the number spelling of section 1 against numgen.js, 10,000 lines', () => {
  const lines = numgen(10_000);
  const rows = lines.map((line) => {
    const [hex, expected] = line.trimEnd().split(',') as [string, string];
    return [hex, expected] as const;
  });

  it('is the file its author published the SHA-256 of', () => {
    expect(lines).toHaveLength(10_000);
    expect(sha256(lines.join(''))).toBe(
      'b9f7a8e75ef22a835685a52ccba7f7d6bdc99e34b010992cbc5864cd12be6892',
    );
  });

  it('the product spells every one of them as the file does', () => {
    const wrong = rows.filter(([hex, expected]) => spelledByTheProduct(doubleOf(hex)) !== expected);
    expect(wrong).toEqual([]);
  });

  it('the second reader spells every one of them as the file does', () => {
    const spelled = spelledBySecondReader(rows.map(([hex]) => unlike(doubleOf(hex))));
    const wrong = rows.filter(([, expected], at) => spelled[at] !== expected);
    expect(wrong).toEqual([]);
  });
});

// ---- section 4: the stored line ----------------------------------------------------------------

const SUITE = join(VECTORS, 'jsontestsuite/test_parsing');

/**
 * THE ONE PLACE THE TWO READERS PART, said rather than hidden. The product reads a stored line
 * as UTF-8 the way `readFileSync(file, 'utf-8')` does, which replaces a byte sequence that is not
 * UTF-8 with U+FFFD and reads on, and then finds the line canonical, because the replacement
 * character is. The second reader refuses the line. Section 4's byte identity says the line is
 * not the canonical bytes of what it holds, so the second reader is the one the format agrees
 * with; making the product refuse is a change to what `verify` accepts, and is not made here.
 */
const THE_PRODUCT_READS_PAST_BYTES_THAT_ARE_NOT_UTF8 = [
  'i_string_UTF-8_invalid_sequence.json',
  'i_string_UTF8_surrogate_U+D800.json',
  'i_string_invalid_utf-8.json',
  'i_string_iso_latin_1.json',
  'i_string_lone_utf8_continuation_byte.json',
  'i_string_not_in_unicode_range.json',
  'i_string_overlong_sequence_2_bytes.json',
  'i_string_overlong_sequence_6_bytes.json',
  'i_string_overlong_sequence_6_bytes_null.json',
  'i_string_truncated-utf-8.json',
];

describe('the stored line of section 4 against JSONTestSuite', () => {
  const names = readdirSync(SUITE).sort();
  const product = new Map(
    names.map((name) => {
      try {
        parseCanonicalLine(readFileSync(join(SUITE, name)).toString('utf-8'));
        return [name, 'accepted'] as const;
      } catch {
        return [name, 'refused'] as const;
      }
    }),
  );
  const second = python(
    [
      'import json, os',
      'from mnemaverify.canonical import is_canonical_line',
      'from mnemaverify.verdict import Refusal',
      'out = {}',
      'for path in json.load(sys.stdin):',
      '    with open(path, "rb") as handle:',
      '        raw = handle.read()',
      '    try:',
      '        out[os.path.basename(path)] = "accepted" if is_canonical_line(raw)[0] else "refused"',
      '    except Refusal:',
      '        out[os.path.basename(path)] = "refused"',
      'print(json.dumps(out))',
    ],
    names.map((name) => join(SUITE, name)),
  ) as Record<string, string>;

  it('reads 188 n_ and 35 i_ files', () => {
    expect(names.filter((name) => name.startsWith('n_'))).toHaveLength(188);
    expect(names.filter((name) => name.startsWith('i_'))).toHaveLength(35);
  });

  it('refuses every n_ file, in both readers', () => {
    const accepted = names
      .filter((name) => name.startsWith('n_'))
      .filter((name) => product.get(name) !== 'refused' || second[name] !== 'refused');
    expect(accepted).toEqual([]);
  });

  it('decides every i_ file the same way in both readers, but the bytes that are not UTF-8', () => {
    const parted = names
      .filter((name) => name.startsWith('i_'))
      .filter((name) => product.get(name) !== second[name]);
    expect(parted).toEqual(THE_PRODUCT_READS_PAST_BYTES_THAT_ARE_NOT_UTF8);
    for (const name of parted) {
      expect([name, product.get(name), second[name]]).toEqual([name, 'accepted', 'refused']);
    }
  });

  it('accepts, in both, the two i_ files that are canonical lines', () => {
    // A number past 2**53 that is still the double it spells, and arrays nested 500 deep.
    expect(
      names.filter((name) => product.get(name) === 'accepted' && second[name] === 'accepted'),
    ).toEqual(['i_number_too_big_pos_int.json', 'i_structure_500_nested_arrays.json']);
  });
});
