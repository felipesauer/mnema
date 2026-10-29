/**
 * A SIGNATURE MADE FOR ONE RECORD DOES NOT COUNT IN ANOTHER (ADR-134, FORMAT.md section 6.10).
 *
 * One person signs every record with one key, and public keys travel with the record, so a
 * tail copied from project A with its key verified in project B as that person's acts. The
 * record is named in what is signed (the checkpoint and the tail proof under their second
 * schemes), and both readers refuse a directory whose tails name two records, a tail that names
 * two, and a `/1` checkpoint where the tail had named its record. The refusals are asserted in
 * the two agreement tables (`second-reader-agrees-on-the-record.test.ts`,
 * `both-readers-read-the-same-bytes.test.ts`); this file holds what the tables do not: the name
 * and the genesis both readers derive, and what each says of a tail or a record that names none.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { catalogUpcasters } from '../events/registry.js';
import { verify } from './chain.js';
import { genesisTail, recordName } from './record-name.js';

const VERIFIER_DIR = fileURLToPath(new URL('../../verifier/', import.meta.url));
const VERIFIER = join(VERIFIER_DIR, 'mnema_verify.py');
const MUTATE = join(VERIFIER_DIR, 'mutate.py');
const FIXTURES = fileURLToPath(new URL('./__fixtures__/', import.meta.url));

interface Finding {
  readonly level: string;
  readonly section: string;
  readonly what: string;
  readonly where: string;
}

function python(args: readonly string[]) {
  const run = spawnSync('python3', args, { encoding: 'utf-8' });
  if (run.error !== undefined) throw new Error(`python3 could not be run: ${run.error.message}`);
  return run;
}

/** What the second reader said under section 6.10. */
function secondSaid(record: string): { verdict: string; findings: readonly Finding[] } {
  const run = python([VERIFIER, '--json', 'record', record]);
  const parsed = JSON.parse(run.stdout) as { verdict: string; findings: readonly Finding[] };
  return { verdict: parsed.verdict, findings: parsed.findings.filter((f) => f.section === '6.10') };
}

/** A function of the second reader's record_name module, asked from outside it. */
function secondNames(expression: string): string {
  const run = python([
    '-c',
    `import sys, json; sys.path.insert(0, ${JSON.stringify(VERIFIER_DIR)}); ` +
      `from mnemaverify.record_name import genesis_tail, record_name; print(json.dumps(${expression}))`,
  ]);
  return JSON.parse(run.stdout) as string;
}

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnema-another-record-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function copyOf(fixture: string): string {
  const record = join(root, fixture);
  cpSync(join(FIXTURES, fixture), record, { recursive: true });
  return record;
}

function mutated(name: string): string {
  const record = copyOf('witnessed-record');
  const applied = JSON.parse(python([MUTATE, name, record]).stdout) as { applied: boolean };
  expect(applied.applied, name).toBe(true);
  return record;
}

describe('both readers derive one name and one genesis', () => {
  it('names a record from its genesis tail by the same digest', () => {
    const tail = `${'ab'.repeat(32)}-${'cd'.repeat(16)}`;
    expect(secondNames(`record_name(${JSON.stringify(tail)})`)).toBe(recordName(tail));
  });

  it('takes the genesis tail by the smallest at, a tie to the smaller id, in both', () => {
    const at = '2026-10-29T10:00:00.000Z';
    const cases: readonly (readonly { tail: string; at: string }[])[] = [
      [
        { tail: 'b-1', at },
        { tail: 'a-1', at: '2026-10-29T10:00:00.001Z' },
      ],
      [
        { tail: 'b-1', at },
        { tail: 'a-1', at },
      ],
      // UTF-16 code units, not code points: U+FF5E sorts after U+1F600's high surrogate.
      [
        { tail: '\u{ff5e}', at },
        { tail: '\u{1f600}', at },
      ],
    ];
    for (const firsts of cases) {
      const pairs = JSON.stringify(firsts.map((f) => [f.tail, f.at]));
      expect(secondNames(`genesis_tail(json.loads(${JSON.stringify(pairs)}))`)).toBe(
        genesisTail(firsts),
      );
    }
    expect(genesisTail(cases[2] ?? [])).toBe('\u{1f600}');
  });
});

describe('a record that names itself, to both readers', () => {
  it('is verified, and both name the record and its genesis tail', () => {
    const record = mutated('named-record');
    const here = verify(record, catalogUpcasters());
    expect(here.ok).toBe(true);
    if (here.record.state !== 'named') throw new Error(`named: ${JSON.stringify(here.record)}`);
    expect(here.record.genesis).toBeDefined();
    expect(here.record.name).toBe(recordName(here.record.genesis ?? ''));
    const there = secondSaid(record);
    expect(there.verdict).toBe('VERIFIED');
    expect(there.findings.map((f) => `${f.level} ${f.what}`)).toEqual([
      `ok every named tail names record ${here.record.name.slice(0, 12)}..., the name of genesis tail ${here.record.genesis}`,
    ]);
  });
});

describe('a tail that names no record beside tails that name one', () => {
  it('is a census note in both readers, in the same words, and never a refusal', () => {
    const record = mutated('unnamed-tail-beside-named-ones');
    const here = verify(record, catalogUpcasters());
    expect(here.ok).toBe(true);
    const notes = here.census.filter((note) => note.kind === 'unnamed-tail');
    expect(notes).toHaveLength(1);
    expect(here.summary).toContain(
      '1 tail(s) that name no record, written before 0.1.5 (see census: informational, not a break)',
    );
    const there = secondSaid(record);
    expect(there.verdict).toBe('VERIFIED');
    expect(there.findings.filter((f) => f.level === 'note').map((f) => f.what)).toEqual(
      notes.map((note) => note.detail),
    );
  });
});

describe('a record written before records were named, to both readers', () => {
  it.each(['witnessed-record', 'witnessed-then-written', 'written-by-an-earlier-binary'])(
    'reads %s as unnamed, said and not refused, byte for byte as frozen',
    (fixture) => {
      const record = copyOf(fixture);
      const here = verify(record, catalogUpcasters());
      expect(here.ok).toBe(true);
      expect(here.record).toEqual({ state: 'unnamed' });
      // No census note per tail in a record that names nothing: every tail would carry one.
      expect(here.census.filter((note) => note.kind === 'unnamed-tail')).toEqual([]);
      const there = secondSaid(record);
      expect(there.verdict).toBe('VERIFIED');
      expect(there.findings.map((f) => `${f.level} ${f.what}`)).toEqual([
        "note record: unnamed (written before 0.1.5): a tail of another record could not be told from this record's own",
      ]);
    },
  );
});

/**
 * `__fixtures__/named-by-its-genesis`, written once by the signing code of the second schemes and
 * never again (its private keys were thrown away): a genesis tail born under the first schemes and
 * bound to the record by its owner's first `/2` checkpoint, whose `prev` is the hash of the `/1`
 * one, and a second tail born under the record's name.
 */
describe('a record named by its genesis tail, frozen', () => {
  const GENESIS = `8d6995a429f1ab61489f0b8391e9ae3ced5ff165eac004ee4572d56e1cad0616-${'0a'.repeat(16)}`;
  const NAME = '56eec5ae4b56a9fdf558ae394e62838f4574c424b096e16f1eb59ac91656925e';

  it('is fully signed and named in both readers, the name being its genesis tail', () => {
    const record = copyOf('named-by-its-genesis');
    const here = verify(record, catalogUpcasters());
    expect(here.issues).toEqual([]);
    expect(here.level).toBe('fully-signed');
    expect(here.record).toEqual({ state: 'named', name: NAME, genesis: GENESIS, unnamed: [] });
    expect(recordName(GENESIS)).toBe(NAME);
    const there = secondSaid(record);
    expect(there.verdict).toBe('VERIFIED');
    expect(there.findings.map((f) => f.what)).toEqual([
      `every named tail names record ${NAME.slice(0, 12)}..., the name of genesis tail ${GENESIS}`,
    ]);
  });

  it('links the first /2 checkpoint of a tail born before to its last /1 one', () => {
    const lines = readFileSync(
      join(FIXTURES, 'named-by-its-genesis', 'tails', GENESIS, 'checkpoints.jsonl'),
      'utf-8',
    )
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines.map((line) => line.scheme)).toEqual(['mnema-checkpoint/1', 'mnema-checkpoint/2']);
    const { sig: _sig, ...signed } = lines[0] ?? {};
    const message = JSON.stringify(Object.fromEntries(Object.entries(signed).sort()));
    expect(lines[1]?.prev).toBe(createHash('sha256').update(message).digest('hex'));
  });
});
