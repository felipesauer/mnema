/**
 * EVERY READER OF THE RECORD REFUSES BYTES THAT ARE NOT UTF-8, and the second reader says the
 * same thing about them.
 *
 * Section 1, rule 6: the bytes are UTF-8. The product used to read each file of the record
 * with `readFileSync(file, 'utf-8')`, which turns a sequence that is not UTF-8 into U+FFFD and
 * reads on; U+FFFD is canonical, so the line passed the byte-identity check of section 4 over
 * bytes no writer of the format produces, while the second reader refused the line or stopped
 * on an exception. Each place that reads a file of the record is taken here in turn — a line of
 * a segment, a checkpoint, the tail proof, a stored block header, a committed public key — and
 * one byte in the MIDDLE of it is made 0xff. Both readers refuse it and name the same byte.
 *
 * What is not refused: the torn final fragment a crash leaves, even when the crash cut it
 * inside a multi-byte character. That fragment is dropped as any torn write is.
 */

import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  cpSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { catalogUpcasters } from '../events/registry.js';
import { verify } from './chain.js';
import { committedPublicKey } from './keystore.js';
import { lastTailCheckpoint, readTailTip } from './store.js';
import { readStoredWitness } from './witness.js';

const VERIFIER = fileURLToPath(new URL('../../verifier/mnema_verify.py', import.meta.url));
const FIXTURES = fileURLToPath(new URL('./__fixtures__/', import.meta.url));
const KEY = '7e5a72fd0ea237237651690087e4a87133dab8b78847efadde778f633214cca4';
const BLOCKS = 'f84396462713a5fd1fefd3a043cddb2eed81c00f5fead86f0474bfaa551c42e2';

interface Finding {
  readonly level: string;
  readonly section: string;
  readonly what: string;
  readonly where: string;
}

/** The second reader's verdict and findings. It has to give one: an exception is no verdict. */
function secondReading(record: string): { verdict: string; findings: readonly Finding[] } {
  const run = spawnSync('python3', [VERIFIER, '--json', 'record', record], { encoding: 'utf-8' });
  if (run.error !== undefined) throw new Error(`python3 could not be run: ${run.error.message}`);
  if (run.stdout === '') throw new Error(`the second reader gave no verdict: ${run.stderr}`);
  return JSON.parse(run.stdout) as { verdict: string; findings: readonly Finding[] };
}

let root: string;
let record: string;
let tail: string;
let tailDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnema-not-utf8-'));
  record = join(root, 'witnessed-record');
  cpSync(join(FIXTURES, 'witnessed-record'), record, { recursive: true });
  tail = readdirSync(join(record, 'tails'))[0] as string;
  tailDir = join(record, 'tails', tail);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/**
 * Makes 0xff the first byte of the value after `after` on line `number` of `file`, and returns
 * that byte's offset WITHIN THE LINE — the offset both readers have to name.
 */
function spoil(file: string, number: number, after: string): number {
  const lines = readFileSync(file).toString('latin1').split('\n');
  const line = lines[number - 1] as string;
  const at = line.indexOf(after);
  expect(at, `${after} is not on line ${number} of ${file}`).toBeGreaterThanOrEqual(0);
  const offset = at + after.length;
  lines[number - 1] = `${line.slice(0, offset)}ÿ${line.slice(offset + 1)}`;
  writeFileSync(file, Buffer.from(lines.join('\n'), 'latin1'));
  return offset;
}

describe('the honest record', () => {
  it('reads as verified in both, which is what every refusal below is measured against', () => {
    expect(verify(record, catalogUpcasters()).ok).toBe(true);
    expect(secondReading(record).verdict).toBe('VERIFIED');
  });
});

describe('one byte that is not UTF-8, in the middle of a file of the record', () => {
  it('in a line of a segment: refused by the forward and the backward reading, and by the second reader', () => {
    const segment = join(tailDir, '000001.jsonl');
    const byte = spoil(segment, 3, '"at":"');
    const cause = `not UTF-8 at byte ${byte}`;

    const here = verify(record, catalogUpcasters());
    expect(here.level).toBe('unreadable');
    expect(here.issues[0]?.layer).toBe('T1');
    expect(here.issues[0]?.detail).toContain(`000001.jsonl line 3: ${cause}`);
    expect(() => readTailTip({ root: record }, tail, catalogUpcasters(), -1)).toThrow(cause);

    const there = secondReading(record);
    expect(there.verdict).toBe('REFUSED');
    expect(there.findings.filter((f) => f.level === 'FAIL')[0]).toMatchObject({
      section: '1',
      what: cause,
      where: '000001.jsonl:3',
    });
  });

  it('in a checkpoint line: refused by the forward reading, and by the second reader', () => {
    const byte = spoil(join(tailDir, 'checkpoints.jsonl'), 2, '"sig":"');
    const cause = `not UTF-8 at byte ${byte}`;

    const here = verify(record, catalogUpcasters());
    expect(here.ok).toBe(false);
    expect(here.issues.map((issue) => issue.detail).join('\n')).toContain(
      `checkpoints.jsonl line 2: ${cause}`,
    );

    const there = secondReading(record);
    expect(there.verdict).toBe('REFUSED');
    expect(there.findings.filter((f) => f.level === 'FAIL')[0]).toMatchObject({
      section: '1',
      what: cause,
      where: 'checkpoints.jsonl:2',
    });
  });

  it('in the last checkpoint line, which ends in its newline: refused by the backward reading', () => {
    const byte = spoil(join(tailDir, 'checkpoints.jsonl'), 3, '"sig":"');
    expect(() => lastTailCheckpoint({ root: record }, tail)).toThrow(`not UTF-8 at byte ${byte}`);
  });

  it('in the tail proof: a malformed proof here, a refusal there, for the same byte', () => {
    const byte = spoil(join(tailDir, 'tailproof.json'), 1, '"sig":"');
    const cause = `not UTF-8 at byte ${byte}`;

    const here = verify(record, catalogUpcasters());
    expect(here.ok).toBe(false);
    expect(here.issues.map((issue) => issue.detail)).toContainEqual(
      expect.stringContaining(`has a malformed ownership proof: ${cause}`),
    );

    const there = secondReading(record);
    expect(there.verdict).toBe('REFUSED');
    expect(there.findings.filter((f) => f.level === 'FAIL')[0]).toMatchObject({
      section: '1',
      what: cause,
      where: `${tail}/tailproof.json`,
    });
  });

  it('in a stored block header: the line is not read, and the second reader leaves the sidecar unchecked', () => {
    const honest = readStoredWitness({ root: record }, tail, BLOCKS);
    expect(honest?.headers.size).toBe(2);
    const byte = spoil(join(tailDir, 'witness', `${BLOCKS}.blocks`), 2, '"header":"');

    // As a header that is not canonical is not read: the attestation it would check is
    // left uncheckable, which is not a refusal of the record. The product needs no strict
    // decode for that — a header line is ASCII by construction, and U+FFFD in place of a bad
    // byte fails the 160-hex check all the same, so the decode there was left as it was.
    expect(readStoredWitness({ root: record }, tail, BLOCKS)?.headers.size).toBe(1);

    const there = secondReading(record);
    expect(there.findings).toContainEqual(
      expect.objectContaining({
        level: 'UNCHECKED',
        what: expect.stringContaining(`sidecar was refused (not UTF-8 at byte ${byte})`),
      }),
    );
  });

  it('in a committed public key: no key is read out of it, where the same file in ASCII still is one', () => {
    const file = join(record, 'keys', `${KEY}.pub`);
    const pem = readFileSync(file);

    // THE CONTROL: text outside the PEM armour is no reason to refuse a key, in either reader.
    writeFileSync(file, Buffer.concat([pem, Buffer.from('a note after the key\n')]));
    expect(committedPublicKey({ root: record }, KEY)).not.toBeNull();
    expect(verify(record, catalogUpcasters()).ok).toBe(true);
    expect(secondReading(record).verdict).toBe('VERIFIED');

    // The same note with one byte that is not UTF-8.
    writeFileSync(file, Buffer.concat([pem, Buffer.from([0x61, 0xff, 0x0a])]));
    expect(committedPublicKey({ root: record }, KEY)).toBeNull();
    expect(verify(record, catalogUpcasters()).ok).toBe(false);

    const there = secondReading(record);
    expect(there.verdict).toBe('REFUSED');
    expect(there.findings.filter((f) => f.level === 'FAIL')[0]).toMatchObject({
      section: '1',
      what: `not UTF-8 at byte ${pem.length + 1}`,
      where: `keys/${KEY}.pub`,
    });
  });
});

describe('the torn final fragment, cut inside a multi-byte character', () => {
  /** An append that stopped between the two bytes of `é`: no newline, and half a character. */
  const torn = Buffer.concat([Buffer.from('{"event":{"kind":"memory.captured","title":"caf'), Buffer.from([0xc3])]);

  it('is dropped from the end of the last segment, as any torn write is', () => {
    appendFileSync(join(tailDir, '000001.jsonl'), torn);
    const here = verify(record, catalogUpcasters());
    expect(here.ok).toBe(true);
    expect(here.census.map((note) => note.kind)).toContain('partial-final-line');
    expect(readTailTip({ root: record }, tail, catalogUpcasters(), -1)).toHaveLength(4);
  });

  it('is dropped from the end of the checkpoints, as any torn write is', () => {
    appendFileSync(join(tailDir, 'checkpoints.jsonl'), torn);
    expect(verify(record, catalogUpcasters()).ok).toBe(true);
    expect(lastTailCheckpoint({ root: record }, tail)).toBeDefined();
  });
});
