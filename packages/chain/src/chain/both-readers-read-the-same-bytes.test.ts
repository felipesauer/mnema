/**
 * THE TWO READERS READ THE SAME BYTES, and say the same thing about them.
 *
 * A stored line is read by the product (`JSON.parse`, then a recanonicalization of what it
 * returned) and by the second reader (a strict parse that refuses a duplicate key). They
 * disagreed on one input: a false `"title"` placed BEFORE the true one on a line that was
 * already signed. `JSON.parse` keeps the last value, which is the signed one, so the
 * recomputed bytes equalled the signed bytes and every hash and signature closed while a
 * reader that keeps the first of two keys read the false title. The product said signed and
 * exit 0; the second reader said REFUSED.
 *
 * This file holds the cases that keep them together:
 *   - the product refuses a duplicate key at EVERY place a stored line is read, at any
 *     depth, and names the line and the key;
 *   - for every mutation `mutate.py` builds that bears on the bytes (a duplicate, a cut that
 *     leaves a consistent record, reordered lines, a refounded record), the two readers
 *     reach the same verdict AND name the same cause, so a second reader that refuses for a
 *     different reason than the first cannot pass as agreement;
 *   - the rule is applied by ONE function: no code under `src` reads a stored line with
 *     `JSON.parse` directly.
 *
 * What is NOT here is a decision. The product forgives whitespace, key order and Unicode
 * composition on a stored line (`writtenAsStored`); the second reader refuses them. That is
 * left as it was, and nothing below asserts either side of it.
 */

import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { catalogUpcasters } from '../events/registry.js';
import { verify } from './chain.js';
import { parseCheckpoint } from './checkpoint.js';
import { parseEntry } from './entry.js';
import { parseTailProof } from './tailproof.js';
import { readStoredWitness } from './witness.js';

const VERIFIER = fileURLToPath(new URL('../../verifier/mnema_verify.py', import.meta.url));
const MUTATE = fileURLToPath(new URL('../../verifier/mutate.py', import.meta.url));
const FIXTURES = fileURLToPath(new URL('./__fixtures__/', import.meta.url));
const SRC = fileURLToPath(new URL('../', import.meta.url));

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

/** The second reader's refusals, in the order it raised them, and its verdict. */
function secondReading(record: string): { verdict: string; refusals: readonly Finding[] } {
  const run = python([VERIFIER, '--json', 'record', record]);
  if (run.stdout === '') throw new Error(`the second reader produced no verdict: ${run.stderr}`);
  const parsed = JSON.parse(run.stdout) as { verdict: string; findings: readonly Finding[] };
  return {
    verdict: parsed.verdict,
    refusals: parsed.findings.filter((finding) => finding.level === 'FAIL'),
  };
}

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnema-same-bytes-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function copyOf(fixture: string): string {
  const record = join(root, fixture);
  cpSync(join(FIXTURES, fixture), record, { recursive: true });
  return record;
}

function mutated(name: string, fixture = 'witnessed-record'): string {
  const record = copyOf(fixture);
  const run = python([MUTATE, name, record]);
  const applied = JSON.parse(run.stdout) as { applied: boolean; detail: string };
  // The mutation is proven applied before any verdict is read: one that missed leaves an
  // honest record, and both readers would "agree" on it.
  expect(applied.applied, `${name} did not change the record: ${applied.detail}`).toBe(true);
  return record;
}

function tailOf(record: string): string {
  return join(record, 'tails', readdirSync(join(record, 'tails'))[0] as string);
}

function lineOf(file: string, number: number): string {
  return (readFileSync(file, 'utf-8').split('\n')[number - 1] as string) ?? '';
}

describe('a duplicate key on a stored line is refused wherever a stored line is read', () => {
  it('refuses it in an entry, at the top of the event, one level down and in the link', () => {
    const record = copyOf('witnessed-record');
    const line = lineOf(join(tailOf(record), '000001.jsonl'), 3);
    // The honest line reads: this is the control, or every refusal below could be a line
    // the fixture never had.
    expect(() => parseEntry(line, catalogUpcasters())).not.toThrow();

    const inPayload = line.replace('"payload":{', '"payload":{"content":"false first",');
    const inEvent = line.replace('{"event":{', '{"event":{"v":2,');
    const inLink = line.replace('"link":{', '"link":{"seq":99,');
    const inEntry = line.replace('{"event":', '{"link":null,"event":');
    for (const [where, text] of [
      ['payload', inPayload],
      ['event', inEvent],
      ['link', inLink],
      ['the entry', inEntry],
    ] as const) {
      expect(text, `${where}: the mutation of the line did not apply`).not.toBe(line);
      expect(() => parseEntry(text, catalogUpcasters()), where).toThrow(
        /a duplicate object key on the line: "/,
      );
    }
    expect(() => parseEntry(inPayload, catalogUpcasters())).toThrow('"content"');
  });

  it('refuses it in a checkpoint', () => {
    const record = copyOf('witnessed-record');
    const line = lineOf(join(tailOf(record), 'checkpoints.jsonl'), 1);
    expect(() => parseCheckpoint(line)).not.toThrow();
    const doubled = line.replace('{"contentRoot"', '{"toSeq":99,"contentRoot"');
    expect(doubled).not.toBe(line);
    expect(() => parseCheckpoint(doubled)).toThrow('a duplicate object key on the line: "toSeq"');
  });

  it('refuses it in a tail proof', () => {
    const record = copyOf('witnessed-record');
    const line = readFileSync(join(tailOf(record), 'tailproof.json'), 'utf-8').trim();
    expect(() => parseTailProof(line)).not.toThrow();
    const doubled = line.replace('{"scheme"', '{"signerFp":"f","scheme"');
    expect(doubled).not.toBe(line);
    expect(() => parseTailProof(doubled)).toThrow('a duplicate object key on the line: "signerFp"');
  });

  it('drops it from a stored block header, as it drops any header it cannot read', () => {
    const record = copyOf('witnessed-record');
    const witness = join(tailOf(record), 'witness');
    const blocks = readdirSync(witness).find((name) => name.endsWith('.blocks')) as string;
    const digest = blocks.replace(/\.blocks$/, '');
    const tail = readdirSync(join(record, 'tails'))[0] as string;
    const layout = { root: record };
    const before = readStoredWitness(layout, tail, digest)?.headers.size;
    expect(before).toBe(2);

    const file = join(witness, blocks);
    const lines = readFileSync(file, 'utf-8').split('\n');
    lines[0] = (lines[0] as string).replace('{"header"', '{"height":1,"header"');
    writeFileSync(file, lines.join('\n'));
    expect(readStoredWitness(layout, tail, digest)?.headers.size).toBe(1);
  });

  it('says so in the verdict: unreadable, at the line, naming the key, exit-code material', () => {
    const record = mutated('duplicate-key-in-a-signed-line');
    const here = verify(record, catalogUpcasters());
    expect(here.ok).toBe(false);
    expect(here.level).toBe('unreadable');
    const detail = here.issues.map((issue) => issue.detail).join('\n');
    expect(detail).toContain('UNREADABLE');
    expect(detail).toContain('000001.jsonl line 3');
    expect(detail).toContain('a duplicate object key on the line: "content"');
  });

  it('reads every honest record the suite holds exactly as it did', () => {
    for (const fixture of readdirSync(FIXTURES).filter((name) =>
      statSync(join(FIXTURES, name)).isDirectory(),
    )) {
      const record = copyOf(fixture);
      expect(verify(record, catalogUpcasters()).ok, fixture).toBe(true);
      expect(secondReading(record).verdict, fixture).toBe('VERIFIED');
    }
  });
});

/**
 * THE CAUSE, NOT ONLY THE VERDICT. Two readers that both say REFUSED for different reasons
 * agree on nothing a person can act on, and the second reader used to be exactly that for a
 * line it refused: it dropped the line, then counted entries by POSITION, so the hole read as
 * a gap in the sequence, a `prev` that does not chain, and a content root that does not
 * fold — three findings naming a cut and an edit the record does not contain, over what was
 * one duplicate key.
 */
const AGREEMENTS = [
  {
    name: 'duplicate-key-in-a-signed-line',
    verdict: 'refused',
    product: { layer: 'T1', says: 'line 3: a duplicate object key on the line: "content"' },
    second: {
      section: '1',
      says: "a duplicate object key on the line: 'content'",
      where: '000001.jsonl:3',
      refusals: 1,
    },
  },
  {
    name: 'reordered-lines',
    verdict: 'refused',
    product: { layer: 'T1', says: 'seq gap: expected 2, found 3' },
    second: {
      section: '3',
      says: 'a gap in the sequence: seq 3 where 2 was due',
      where: '000001.jsonl:3',
      refusals: 6,
    },
  },
  { name: 'aligned-cut', verdict: 'accepted' },
  { name: 'refounded-record', verdict: 'accepted' },
] as const;

describe('the two readers reach the same verdict on the same bytes, and name the same cause', () => {
  it('covers exactly the mutations the table in the record test marks as agreed or byte-level', () => {
    const offered = JSON.parse(python([MUTATE, 'list']).stdout) as string[];
    for (const row of AGREEMENTS) expect(offered, row.name).toContain(row.name);
  });

  it.each(AGREEMENTS)('agrees on $name', (row) => {
    const record = mutated(row.name);
    const here = verify(record, catalogUpcasters());
    const there = secondReading(record);

    if (row.verdict === 'accepted') {
      expect(here.ok, `${row.name}: the product refused`).toBe(true);
      expect(here.issues).toEqual([]);
      expect(there.verdict, `${row.name}: the second reader refused`).toBe('VERIFIED');
      expect(there.refusals).toEqual([]);
      return;
    }

    expect(here.ok, `${row.name}: the product accepted`).toBe(false);
    expect(there.verdict, `${row.name}: the second reader accepted`).toBe('REFUSED');

    // The FIRST cause each reader names is the one compared: a later finding is a
    // consequence, and the second reader's consequences are counted below.
    const first = here.issues[0];
    expect(first?.layer).toBe(row.product.layer);
    expect(first?.detail).toContain(row.product.says);
    const named = there.refusals[0];
    expect(named?.section).toBe(row.second.section);
    expect(named?.what).toContain(row.second.says);
    expect(named?.where).toBe(row.second.where);
    expect(there.refusals).toHaveLength(row.second.refusals);
  });

  it('names a duplicate once, and not again as a gap, a broken prev or an unfolded root', () => {
    const there = secondReading(mutated('duplicate-key-in-a-signed-line'));
    expect(there.refusals.map((finding) => finding.section)).toEqual(['1']);
    const run = python([VERIFIER, '--json', 'record', join(root, 'witnessed-record')]);
    const notes = (JSON.parse(run.stdout) as { findings: Finding[] }).findings
      .filter((finding) => finding.level === 'UNCHECKED')
      .map((finding) => finding.what)
      .join('\n');
    // What it could not check because of the refused line is SAID, not dropped.
    expect(notes).toContain('was refused above');
  });

  it('refuses a tail with no tail proof in BOTH readers, which only the product used to', () => {
    const record = mutated('tail-proof-removed');
    const here = verify(record, catalogUpcasters());
    expect(here.ok).toBe(false);
    expect(here.issues.map((issue) => issue.detail).join('\n')).toContain('no ownership proof');
    const there = secondReading(record);
    expect(there.verdict).toBe('REFUSED');
    expect(there.refusals.map((finding) => finding.what).join('\n')).toContain('no tailproof.json');
  });
});

describe('the rule has one place', () => {
  /** Every non-test TypeScript file under `src`. */
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return name === '__fixtures__' ? [] : sources(path);
      return name.endsWith('.ts') && !name.endsWith('.test.ts') ? [path] : [];
    });
  }

  it('reads no stored line with JSON.parse except through parseStoredJson', () => {
    const found = sources(SRC).flatMap((path) => {
      if (path.endsWith(join('events', 'stored-json.ts'))) return [];
      return readFileSync(path, 'utf-8')
        .split('\n')
        .map((text, index) => ({ path: relative(SRC, path), line: index + 1, text }))
        .filter(({ text }) => /JSON\.parse\(/.test(text) && !/^\s*(\*|\/\/)/.test(text));
    });
    expect(found).toEqual([]);
  });

  it('sees a JSON.parse when one is planted, or the scan above proves nothing', () => {
    const planted = ['const a = 1;', '  const raw = JSON.parse(line);', ' * JSON.parse(line)'];
    const hits = planted.filter(
      (text) => /JSON\.parse\(/.test(text) && !/^\s*(\*|\/\/)/.test(text),
    );
    expect(hits).toEqual(['  const raw = JSON.parse(line);']);
  });
});
