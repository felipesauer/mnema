/**
 * THE TWO READERS, OVER INPUT NOBODY CHOSE.
 *
 * `second-reader-agrees-on-the-record.test.ts` and `second-reader-agrees-on-the-bytes.test.ts`
 * run the Python reader beside the product's over inputs somebody THOUGHT OF, which is how
 * both readers get to agree on every case a person imagined and still part company on the one
 * nobody did. This file draws the input instead, under the seed the other property files use,
 * and holds the two to the same answer on each draw:
 *
 *   - the canonical bytes of a generated value, or the refusal of it, are the same in both;
 *   - a generated record, written by the product's own writer with checkpoints where the draw
 *     put them, is accepted by both;
 *   - and the same record with one line altered, dropped or swapped is refused by BOTH or by
 *     neither: a reader that accepts what the other refuses is a hole in one of them.
 *
 * The expected value is never computed here: every case compares one reader with the other.
 * That is the property. A case that recomputed the answer would be a third opinion.
 *
 * It needs `python3` and fails rather than skips without it, as its siblings do.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { decisionBirth, identityFounded, taskCreated } from '../events/build.js';
import {
  CanonicalizationError,
  type CanonicalValue,
  canonicalStringify,
} from '../events/canonical.js';
import { catalogUpcasters } from '../events/registry.js';
import { openChainForWriting, verify } from './chain.js';

const VERIFIER = fileURLToPath(new URL('../../verifier/mnema_verify.py', import.meta.url));
const SEED = Number(process.env.FC_SEED ?? 20_261_007);
const CASE_TIMEOUT = 120_000;

function python(args: readonly string[], input?: string) {
  const run = spawnSync('python3', args, { encoding: 'utf-8', input });
  if (run.error !== undefined) {
    throw new Error(
      `python3 could not be run, and this suite requires it: ${run.error.message}. The second ` +
        'reader is standard library only; there is nothing to install.',
    );
  }
  return run;
}

// ---------------------------------------------------------------------------------------------
// What is drawn
// ---------------------------------------------------------------------------------------------

/** Text as people type it: composed and decomposed, astral, and anything the encoding holds. */
const textArb: fc.Arbitrary<string> = fc.oneof(
  fc.string({ unit: 'binary', maxLength: 12 }).filter((text) => !/\p{Surrogate}/u.test(text)),
  fc
    .array(
      fc.constantFrom(
        'e',
        '\u00e9',
        'e\u0301',
        '\u00c5',
        'A\u030a',
        '\ufb03',
        '😀',
        'ß',
        '"',
        '\\',
        '\n',
        '/',
        '<',
      ),
      {
        maxLength: 6,
      },
    )
    .map((parts) => parts.join('')),
);

const numberArb: fc.Arbitrary<number> = fc.oneof(
  fc.integer(),
  fc.double({ noNaN: true, noDefaultInfinity: true }),
  fc.constantFrom(-0, 0, 1e21, 1e-7, 123456789012345680000, Number.MAX_SAFE_INTEGER, -1.5e-300),
);

const valueArb: fc.Arbitrary<CanonicalValue> = fc.letrec<{ value: CanonicalValue }>((tie) => ({
  value: fc.oneof(
    { maxDepth: 3 },
    fc.constant(null),
    fc.boolean(),
    numberArb,
    textArb,
    fc.array(tie('value'), { maxLength: 4 }),
    fc.dictionary(
      textArb.filter((key) => key !== '__proto__'),
      tie('value'),
      { maxKeys: 4 },
    ),
  ),
})).value;

type Step =
  | { readonly step: 'task'; readonly title: string }
  | { readonly step: 'decision'; readonly title: string; readonly rationale: string }
  | { readonly step: 'checkpoint' };

const stepArb: fc.Arbitrary<Step> = fc.oneof(
  fc.record({ step: fc.constant('task' as const), title: textArb }),
  fc.record({
    step: fc.constant('decision' as const),
    title: textArb,
    rationale: textArb,
  }),
  fc.record({ step: fc.constant('checkpoint' as const) }),
);

type Tamper =
  | { readonly how: 'none' }
  | { readonly how: 'flip'; readonly line: number; readonly at: number; readonly to: string }
  | { readonly how: 'drop'; readonly line: number }
  | { readonly how: 'swap'; readonly line: number };

const tamperArb: fc.Arbitrary<Tamper> = fc.oneof(
  fc.constant<Tamper>({ how: 'none' }),
  fc.record({
    how: fc.constant('flip' as const),
    line: fc.nat(),
    at: fc.nat(),
    to: fc.constantFrom('0', 'a', 'z', ' ', 'é'),
  }),
  fc.record({ how: fc.constant('drop' as const), line: fc.nat() }),
  fc.record({ how: fc.constant('swap' as const), line: fc.nat() }),
);

// ---------------------------------------------------------------------------------------------
// The cases
// ---------------------------------------------------------------------------------------------

describe('the canonical bytes, over generated values, in both readers', () => {
  it(
    'are the same bytes, or the same refusal',
    () => {
      fc.assert(
        fc.property(fc.array(valueArb, { minLength: 12, maxLength: 12 }), (values) => {
          const run = python(
            [VERIFIER, 'canonicalize'],
            `${values.map((value) => JSON.stringify(value)).join('\n')}\n`,
          );
          expect(run.status, run.stderr).toBe(0);
          const there = JSON.parse(run.stdout) as readonly {
            canonical?: string;
            refused?: string;
          }[];
          expect(there).toHaveLength(values.length);
          values.forEach((value, index) => {
            const second = there[index] as { canonical?: string; refused?: string };
            let here: string | 'refused';
            try {
              here = canonicalStringify(value);
            } catch (error) {
              if (!(error instanceof CanonicalizationError)) throw error;
              here = 'refused';
            }
            const label = `${JSON.stringify(value)} -> ${JSON.stringify(second)}`;
            if (here === 'refused') expect(second.refused, label).toBeDefined();
            else {
              expect(second.refused, label).toBeUndefined();
              expect(Buffer.from(second.canonical as string, 'hex').toString('utf-8'), label).toBe(
                here,
              );
            }
          });
        }),
        { seed: SEED, numRuns: 25 },
      );
    },
    CASE_TIMEOUT,
  );
});

describe('a generated record, in both readers', () => {
  let keyRoot: string;
  const scratch: string[] = [];

  beforeAll(() => {
    keyRoot = mkdtempSync(join(tmpdir(), 'mnema-generated-key-'));
  });

  afterAll(() => {
    rmSync(keyRoot, { recursive: true, force: true });
    for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
  });

  /** Writes the drawn steps with the product's writer; returns the record and its one segment. */
  function written(steps: readonly Step[]): { record: string; segment: string } {
    const record = mkdtempSync(join(tmpdir(), 'mnema-generated-record-'));
    scratch.push(record);
    const writer = openChainForWriting(record, { keyRoot, maxUnsignedEvents: 10_000 });
    writer.append(
      identityFounded(
        {
          at: new Date(Date.UTC(2026, 6, 20)).toISOString(),
          who: writer.anchor,
          signerFp: writer.signerFingerprint,
          subject: writer.anchor,
        },
        { foundingFp: writer.signerFingerprint },
      ),
    );
    let index = 0;
    for (const step of steps) {
      index += 1;
      const env = (subject: string) => ({
        at: new Date(Date.UTC(2026, 6, 21, 0, 0, index)).toISOString(),
        who: writer.anchor,
        signerFp: writer.signerFingerprint,
        subject,
      });
      if (step.step === 'task') {
        writer.append(taskCreated(env(`task-${index}`), { title: `t${step.title}` }));
      } else if (step.step === 'decision') {
        for (const event of decisionBirth(env(`dec-${index}`), {
          title: `t${step.title}`,
          rationale: `r${step.rationale}`,
          adr: `ADR-${index}`,
          initial: 'proposed',
        })) {
          writer.append(event);
        }
      } else {
        writer.checkpoint();
      }
    }
    const tails = join(record, 'tails');
    const tail = readdirSync(tails)[0] as string;
    const segment = readdirSync(join(tails, tail)).find((name) => /^\d{6}\.jsonl$/.test(name));
    if (segment === undefined) throw new Error('the writer left no segment');
    return { record, segment: join(tails, tail, segment) };
  }

  function alter(segment: string, tamper: Tamper): void {
    const lines = readFileSync(segment, 'utf-8')
      .split('\n')
      .filter((line) => line !== '');
    const at = tamper.how === 'none' ? 0 : tamper.line % lines.length;
    if (tamper.how === 'flip') {
      const line = [...(lines[at] as string)];
      const position = tamper.at % line.length;
      line[position] = line[position] === tamper.to ? '#' : tamper.to;
      lines[at] = line.join('');
    } else if (tamper.how === 'drop') {
      lines.splice(at, 1);
    } else if (tamper.how === 'swap' && lines.length > 1) {
      const next = (at + 1) % lines.length;
      [lines[at], lines[next]] = [lines[next] as string, lines[at] as string];
    }
    writeFileSync(segment, `${lines.join('\n')}\n`);
  }

  const stepsArb = fc
    .array(stepArb, { minLength: 1, maxLength: 8 })
    .filter((steps) => steps.some((one) => one.step !== 'checkpoint'));

  it(
    'is accepted by both when nothing was touched',
    () => {
      fc.assert(
        fc.property(stepsArb, (steps) => {
          const { record } = written(steps);
          const here = verify(record, catalogUpcasters());
          const run = python([VERIFIER, '--json', 'record', record]);
          const there = JSON.parse(run.stdout) as {
            verdict: string;
            findings: { level: string; what: string }[];
          };
          expect(here.issues, 'the product over a record its own writer made').toEqual([]);
          expect(there.findings.filter((one) => one.level === 'FAIL')).toEqual([]);
          expect(there.verdict).toBe('VERIFIED');
          expect(run.status).toBe(0);
        }),
        { seed: SEED, numRuns: 20 },
      );
    },
    CASE_TIMEOUT,
  );

  it(
    'with one line altered, dropped or swapped, is refused by both or by neither',
    () => {
      fc.assert(
        fc.property(stepsArb, tamperArb, (steps, tamper) => {
          const { record, segment } = written(steps);
          alter(segment, tamper);
          const here = verify(record, catalogUpcasters());
          const run = python([VERIFIER, '--json', 'record', record]);
          const there = JSON.parse(run.stdout) as { verdict: string };
          const productRefuses = !here.ok;
          const secondRefuses = there.verdict === 'REFUSED';
          expect(
            secondRefuses,
            `${JSON.stringify(tamper)}: product ${productRefuses ? 'refused' : 'accepted'}, ` +
              `second reader ${there.verdict}`,
          ).toBe(productRefuses);
        }),
        { seed: SEED, numRuns: 40 },
      );
    },
    CASE_TIMEOUT,
  );
});
