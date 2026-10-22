/**
 * A LINE THAT IS REFUSED HIDES NOTHING ELSE IN ITS TAIL, in either reader.
 *
 * When the product could not read a line of a tail (not JSON, not canonical, a key it does not
 * declare) it said so, marked the tail unreadable, and said nothing more about that tail: a
 * second line it could not read, a checkpoint whose signature fails, a tail proof that does not
 * hold were all left out of the verdict, while the second reader named each of them beside the
 * refused line. Now the product reads on as the second reader does. Every line it cannot read is
 * named, and so is every cause the hole leaves checkable: the tail's ownership proof, whose key
 * signed its checkpoints and events, and each checkpoint's own signature. What a hole makes
 * uncheckable is left unchecked in both readers, and no consequence of it is said as a cause:
 * the hash chain is not walked across it and no content root is folded over it. The level is
 * still `unreadable`, the strongest thing there is to say.
 */

import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { catalogUpcasters } from '../events/registry.js';
import { verify } from './chain.js';

const VERIFIER = fileURLToPath(new URL('../../verifier/mnema_verify.py', import.meta.url));
const MUTATE = fileURLToPath(new URL('../../verifier/mutate.py', import.meta.url));
const FIXTURES = fileURLToPath(new URL('./__fixtures__/', import.meta.url));

interface Finding {
  readonly level: string;
  readonly section: string;
  readonly what: string;
  readonly where: string;
}

function python(args: readonly string[]): string {
  const run = spawnSync('python3', args, { encoding: 'utf-8' });
  if (run.error !== undefined) throw new Error(`python3 could not be run: ${run.error.message}`);
  if (run.stdout === '') throw new Error(`python3 printed nothing: ${run.stderr}`);
  return run.stdout;
}

/** The refusals of the second reader, each as `<where>: <what>`. */
function refusedThere(record: string): string[] {
  const reading = JSON.parse(python([VERIFIER, '--json', 'record', record])) as {
    verdict: string;
    findings: readonly Finding[];
  };
  expect(reading.verdict).toBe('REFUSED');
  return reading.findings.filter((f) => f.level === 'FAIL').map((f) => `${f.where}: ${f.what}`);
}

let root: string;
let record: string;
let tailDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnema-a-refused-line-'));
  record = join(root, 'witnessed-record');
  cpSync(join(FIXTURES, 'witnessed-record'), record, { recursive: true });
  const tail = readdirSync(join(record, 'tails'))[0] as string;
  tailDir = join(record, 'tails', tail);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Makes line `number` (from 1) of a file of the tail a line that is not JSON. */
function spoil(file: string, number: number): void {
  const path = join(tailDir, file);
  const lines = readFileSync(path, 'utf-8').split('\n');
  lines[number - 1] = 'this line is not JSON';
  writeFileSync(path, lines.join('\n'));
}

describe('a tail with a line no reader can read', () => {
  it('says the line, and the checkpoint whose signature fails beside it, in both readers', () => {
    const applied = JSON.parse(
      python([MUTATE, 'refused-line-beside-a-forged-signature', record]),
    ) as { applied: boolean };
    expect(applied.applied).toBe(true);

    const here = verify(record, catalogUpcasters());
    expect(here.level).toBe('unreadable');
    expect(here.issues.map((issue) => `${issue.layer} ${issue.detail}`)).toEqual([
      expect.stringMatching(/^T1 UNREADABLE: tails\/[^ ]+\/000001\.jsonl line 4: not valid JSON/),
      'T2/T4 checkpoint failed: bad-signature',
    ]);

    expect(refusedThere(record)).toEqual([
      expect.stringMatching(/^000001\.jsonl:4: not JSON/),
      expect.stringMatching(
        /^checkpoints\.jsonl:3 cp\[3\.\.3\]: the Ed25519 signature does not verify/,
      ),
    ]);
  });

  it('says every line it cannot read, in the segment and in the checkpoints, in both readers', () => {
    spoil('000001.jsonl', 2);
    spoil('000001.jsonl', 4);
    // The LAST checkpoint, so no later one links to it: a link to a refused checkpoint fails in
    // both readers, and is a case of its own.
    spoil('checkpoints.jsonl', 3);

    const here = verify(record, catalogUpcasters());
    expect(here.level).toBe('unreadable');
    expect(
      here.issues.map((issue) => issue.detail.replace(/^UNREADABLE: tails\/[^/]+\//, '')),
    ).toEqual([
      expect.stringMatching(/^000001\.jsonl line 2: not valid JSON/),
      expect.stringMatching(/^000001\.jsonl line 4: not valid JSON/),
      expect.stringMatching(/^checkpoints\.jsonl line 3: not valid JSON/),
    ]);

    expect(refusedThere(record)).toEqual([
      expect.stringMatching(/^000001\.jsonl:2: not JSON/),
      expect.stringMatching(/^000001\.jsonl:4: not JSON/),
      expect.stringMatching(/^checkpoints\.jsonl:3: not JSON/),
    ]);
  });

  it('says the ownership proof is gone beside the line, in both readers', () => {
    spoil('000001.jsonl', 3);
    rmSync(join(tailDir, 'tailproof.json'));

    const here = verify(record, catalogUpcasters());
    expect(here.issues.map((issue) => issue.detail)).toEqual([
      expect.stringMatching(/^UNREADABLE: .*000001\.jsonl line 3: not valid JSON/),
      expect.stringMatching(/has no ownership proof/),
    ]);
    expect(refusedThere(record)).toHaveLength(2);
  });

  it('says the line ALONE when nothing else is wrong: the hole is not read as a cut or an edit', () => {
    spoil('000001.jsonl', 2);

    const here = verify(record, catalogUpcasters());
    expect(here.level).toBe('unreadable');
    expect(here.issues.map((issue) => issue.detail)).toEqual([
      expect.stringMatching(/^UNREADABLE: .*000001\.jsonl line 2: not valid JSON/),
    ]);
    expect(refusedThere(record)).toEqual([expect.stringMatching(/^000001\.jsonl:2: not JSON/)]);
  });
});
