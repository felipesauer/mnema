/**
 * THE RELINK OF A TAIL, READ BY BOTH READERS AND BY THE NAMER OF THE SURFACES (FORMAT.md section
 * 6.11, ADR-155, ADR-157).
 *
 * Each record here is built by `mutate.py` over a copy of a frozen record, every signature real
 * (RFC 8032's published keys): a record Y, a tail T of another record X by the second key, and
 * that key's relink of T from a tail of its own that names Y. The refusals by token are held row by
 * row in `second-reader-agrees-on-the-record.test.ts` and `both-readers-read-the-same-bytes.test.ts`;
 * this file holds what a row cannot: the census line each reader says of a relink that counts, of
 * one above its host's checkpoint and of one whose tail is not here, word for word in both, and
 * that the namer the surfaces ask (`tailsReadAt`) names a directory as `verify` does.
 */

import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { catalogUpcasters } from '../events/registry.js';
import { verify } from './chain.js';
import { arrivalsSince, tailsReadAt } from './tail-names.js';

const VERIFIER_DIR = fileURLToPath(new URL('../../verifier/', import.meta.url));
const VERIFIER = join(VERIFIER_DIR, 'mnema_verify.py');
const MUTATE = join(VERIFIER_DIR, 'mutate.py');
const FIXTURES = fileURLToPath(new URL('./__fixtures__/', import.meta.url));

interface Finding {
  readonly level: string;
  readonly section: string;
  readonly what: string;
}

function python(args: readonly string[]) {
  const run = spawnSync('python3', args, { encoding: 'utf-8' });
  if (run.error !== undefined) throw new Error(`python3 could not be run: ${run.error.message}`);
  return run;
}

/** The second reader's verdict, and what it said under section 6.11. */
function second(record: string): { verdict: string; said: readonly Finding[] } {
  const parsed = JSON.parse(python([VERIFIER, '--json', 'record', record]).stdout) as {
    verdict: string;
    findings: readonly Finding[];
  };
  return { verdict: parsed.verdict, said: parsed.findings.filter((f) => f.section === '6.11') };
}

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnema-relink-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function mutated(name: string): string {
  const record = join(root, name);
  cpSync(join(FIXTURES, 'witnessed-record'), record, { recursive: true });
  const applied = JSON.parse(python([MUTATE, name, record]).stdout) as { applied: boolean };
  expect(applied.applied, name).toBe(true);
  return record;
}

/** The relinked tail of the records `mutate.py` builds: the second key's, installation `cd`. */
function relinkedTailOf(record: string): string {
  const tail = readdirSync(join(record, 'tails')).find((id) => id.endsWith('cd'.repeat(16)));
  if (tail === undefined) throw new Error('no relinked tail');
  return tail;
}

describe('a relink that counts', () => {
  it('verifies in both readers, and both say the same census line of it', () => {
    const record = mutated('relinked-tail');
    const here = verify(record, catalogUpcasters());
    expect(here.ok).toBe(true);
    expect(here.record.state).toBe('named');
    const notes = here.census.filter((note) => note.kind === 'relinked-tail');
    expect(notes.map((note) => note.tail)).toEqual([relinkedTailOf(record)]);
    const there = second(record);
    expect(there.verdict).toBe('VERIFIED');
    expect(there.said.map((f) => [f.level, f.what])).toEqual([['note', notes[0]?.detail]]);
    expect(notes[0]?.detail).toMatch(/relinked into this record by its own key at tail .* 2 event/);
  });

  it('gives the verdict a clause', () => {
    const here = verify(mutated('relinked-tail'), catalogUpcasters());
    expect(here.summary).toContain('1 tail(s) relinked into this record by their own key');
  });
});

describe('a relink that counts for nothing, said in both', () => {
  it('above its host’s last checkpoint: relink-uncovered, and the directory stays two records', () => {
    const record = mutated('relink-uncovered');
    const here = verify(record, catalogUpcasters());
    const notes = here.census.filter((note) => note.kind === 'relink-uncovered');
    expect(notes).toHaveLength(1);
    expect(here.record.state).toBe('several');
    const there = second(record);
    expect(there.said.map((f) => [f.level, f.what])).toEqual([['note', notes[0]?.detail]]);
  });

  it('of a tail that is not here: named nothing, and the record is the one the host names', () => {
    const record = mutated('relinked-tail');
    rmSync(join(record, 'tails', relinkedTailOf(record)), { recursive: true });
    const here = verify(record, catalogUpcasters());
    const notes = here.census.filter((note) => note.kind === 'relinked-tail-absent');
    expect(notes).toHaveLength(1);
    expect(here.record.state).toBe('named');
    const there = second(record);
    expect(there.said.map((f) => [f.level, f.what])).toEqual([['note', notes[0]?.detail]]);
  });
});

describe('a host tail with a line no reader reads', () => {
  it('holds no relink in either reader, so both name the same causes', () => {
    // The product reads nothing of a tail holding such a line; the second reader used to keep the
    // entries before it, count the relink and name no second record. Both now read no relink of it.
    const record = mutated('relink-host-with-an-unreadable-line');
    const here = verify(record, catalogUpcasters());
    expect(here.census.filter((note) => note.kind === 'relinked-tail')).toEqual([]);
    expect(here.issues.map((issue) => issue.detail).join('\n')).toContain('(another-record)');
    const parsed = JSON.parse(python([VERIFIER, '--json', 'record', record]).stdout) as {
      findings: readonly Finding[];
    };
    const failed = parsed.findings.filter((f) => f.level === 'FAIL');
    expect(failed.map((f) => f.section).sort()).toEqual(['1', '6.10']);
    expect(failed.find((f) => f.section === '6.10')?.what).toContain('(another-record)');
    expect(parsed.findings.filter((f) => f.section === '6.11')).toEqual([]);
  });
});

describe('the namer of the surfaces names a directory as verify does', () => {
  const EVERY = [
    'relinked-tail',
    'relinked-by-the-genesis-founder',
    'relink-uncovered',
    'relink-by-another-key',
    'relinked-tail-grew',
    'relink-conflict',
    'relink-into-its-own-record',
    'relink-host-with-an-unreadable-line',
    'relink-hosted-by-a-relinked-tail',
    'relinked-by-a-key-that-founded-itself-here',
    'relinked-by-a-key-a-stranger-enrolled',
    'tail-of-another-record',
  ];

  it.each(EVERY)('%s', (name) => {
    const record = mutated(name);
    const reading = tailsReadAt({ root: record });
    const here = verify(record, catalogUpcasters());
    if (here.record.state === 'several') {
      expect(reading.read).toEqual([]);
      expect(reading.several).toEqual(here.record.groups);
    } else {
      expect(reading.several).toEqual([]);
      expect([...reading.read].sort()).toEqual(readdirSync(join(record, 'tails')).sort());
    }
  });

  it('reads the directory again once a file of it changes, rather than keep an answer it took', () => {
    const record = mutated('relinked-tail');
    expect(tailsReadAt({ root: record }).read).toHaveLength(3);
    // The relink's host loses the checkpoint that covered it: the relink counts for nothing now.
    const host = readdirSync(join(record, 'tails')).find((id) => id.endsWith('ef'.repeat(16)));
    if (host === undefined) throw new Error('no host tail');
    rmSync(join(record, 'tails', host, 'checkpoints.jsonl'));
    expect(tailsReadAt({ root: record }).read).toEqual([]);
    expect(verify(record, catalogUpcasters()).record.state).toBe('several');
  });

  it('takes no covering checkpoint whose signature fails, as verify takes none', () => {
    // The namer checks the last checkpoint's signature alone and binds the earlier ones through
    // `prev`; a last signature that fails is not a cover, and the relink above it counts nothing.
    const record = mutated('relinked-tail');
    const host = readdirSync(join(record, 'tails')).find((id) => id.endsWith('ef'.repeat(16)));
    if (host === undefined) throw new Error('no host tail');
    const file = join(record, 'tails', host, 'checkpoints.jsonl');
    const line = JSON.parse(readFileSync(file, 'utf-8').trim()) as { sig: string };
    const flipped = `${line.sig.startsWith('0') ? '1' : '0'}${line.sig.slice(1)}`;
    writeFileSync(file, readFileSync(file, 'utf-8').replace(line.sig, flipped));
    expect(verify(record, catalogUpcasters()).record.state).toBe('several');
    expect(tailsReadAt({ root: record }).read).toEqual([]);
  });

  it('reads a relinked directory whole, where before it read nothing of it', () => {
    const record = mutated('relinked-tail');
    expect(tailsReadAt({ root: record }).read).toHaveLength(3);
  });
});

describe('what arrived since a base (arrivalsSince), under the names a relink gives', () => {
  /** The record `name` builds, and a base that held only its tail `ab`, the genesis of Y. */
  function baseAndHere(name: string): { base: string; here: string } {
    const here = mutated(name);
    const base = join(root, `${name}-base`);
    cpSync(here, base, { recursive: true });
    for (const tail of readdirSync(join(base, 'tails'))) {
      if (!tail.endsWith('ab'.repeat(16))) rmSync(join(base, 'tails', tail), { recursive: true });
    }
    return { base, here };
  }

  it('holds no tail of another record where the relink counts, and says the relinked tail', () => {
    const { base, here } = baseAndHere('relinked-by-the-genesis-founder');
    const arrived = arrivalsSince({ root: base }, { root: here }, catalogUpcasters());
    expect(arrived.foreign).toEqual([]);
    expect(arrived.relinked).toEqual([
      {
        tail: relinkedTailOf(here),
        from: expect.stringMatching(/^[0-9a-f]{64}$/),
        events: 2,
        firstAt: expect.stringMatching(/^\d{4}-/),
        held: false,
      },
    ]);
    expect(arrived.relinked[0]?.from).not.toBe(arrived.records[0]);
  });

  it.each([
    'relink-uncovered',
    'relinked-by-a-key-that-founded-itself-here',
  ])('still names the tail as another record where the relink does not count: %s', (name) => {
    const { base, here } = baseAndHere(name);
    const arrived = arrivalsSince({ root: base }, { root: here }, catalogUpcasters());
    expect(arrived.foreign.flatMap((group) => group.tails)).toEqual([relinkedTailOf(here)]);
    expect(arrived.relinked).toEqual([]);
  });

  it('reads the base whole: a relink that counted there is not said again', () => {
    const record = mutated('relinked-by-the-genesis-founder');
    const arrived = arrivalsSince({ root: record }, { root: record }, catalogUpcasters());
    expect(arrived.foreign).toEqual([]);
    expect(arrived.relinked).toEqual([]);
    expect(arrived.records).toHaveLength(1);
  });
});
