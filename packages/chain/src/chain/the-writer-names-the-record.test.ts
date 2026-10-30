/**
 * THE WRITER NAMES THE RECORD IT WRITES IN (ADR-134, FORMAT.md section 6.10).
 *
 * Every tail proof and every checkpoint the writer signs is under the second scheme and names the
 * record: the name its own tail carries, else the one the other tails carry, else the name of the
 * genesis tail. A new record names itself from its own first tail; a record written before is
 * named by the first writer of 0.1.5, and two clones that never saw each other name it the same.
 * Where the tails already name two records, or the writer's own tail names another record than
 * the rest, the write is refused and nothing is written. Each case is read back by both readers.
 */

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { identityFounded, memoryCaptured } from '../events/build.js';
import { catalogUpcasters } from '../events/registry.js';
import { openChainForWriting, verify } from './chain.js';
import { NAMED_SCHEME } from './checkpoint.js';
import { keptHeadPath } from './kept-head.js';
import { checkpointsPath, installationIdPath, publicKeyPath, tailProofPath } from './layout.js';
import { recordName } from './record-name.js';
import { listTails } from './store.js';
import { firstEntries, namesOfTails } from './tail-names.js';
import { NAMED_TAILPROOF_SCHEME } from './tailproof.js';
import { ensureTree } from './tree.js';
import { AnotherRecordError, type ChainWriter } from './writer.js';

const VERIFIER = fileURLToPath(new URL('../../verifier/mnema_verify.py', import.meta.url));
const FIXTURES = fileURLToPath(new URL('./__fixtures__/', import.meta.url));
const OLD = 'written-by-an-earlier-binary';
const OLD_TAIL =
  '2d1f185ce054e3c3b6b31ca880b5a61e58aec11c0c364348db2fcf86a76c9fb5-c6b0f96c68fc4cf2b762e1254ec01f59';

let sandbox: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'mnema-the-writer-names-'));
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** A record directory of its own, empty. */
function aRecord(name: string): string {
  const root = join(sandbox, name);
  ensureTree({ root });
  return root;
}

/** A copy of a frozen fixture, to write into. */
function copyOf(fixture: string, name: string): string {
  const root = join(sandbox, name);
  cpSync(join(FIXTURES, fixture), root, { recursive: true });
  return root;
}

/** The founding a key new to the record writes first, through `w`. */
function found(w: ChainWriter): void {
  w.append(
    identityFounded(
      {
        at: new Date().toISOString(),
        who: w.anchor,
        signerFp: w.signerFingerprint,
        subject: w.anchor,
      },
      { foundingFp: w.signerFingerprint },
    ),
  );
}

/** One act by the person whose keys are at `keys`: founded once, a note, and signed. */
function write(root: string, keys: string, content: string): string {
  const w = openChainForWriting(root, { keyRoot: join(sandbox, keys) });
  if (!w.hasAnchor) {
    found(w);
    w.recordAnchor(w.anchor);
  }
  w.append(
    memoryCaptured(
      {
        at: new Date().toISOString(),
        who: w.anchor,
        signerFp: w.signerFingerprint,
        subject: content,
      },
      { content },
    ),
  );
  w.checkpoint();
  return w.tail;
}

/** What a tail's proof and checkpoints say, scheme and record, line by line. */
function signedBy(root: string, tail: string) {
  const proof = JSON.parse(readFileSync(tailProofPath({ root }, tail), 'utf-8')) as {
    scheme: string;
    record?: string;
  };
  const checkpoints = readFileSync(checkpointsPath({ root }, tail), 'utf-8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { scheme: string; record?: string });
  return { proof: { scheme: proof.scheme, record: proof.record }, checkpoints };
}

/** The second reader's verdict and what it says under section 6.10. */
function secondReading(root: string): { verdict: string; said: string[] } {
  const run = spawnSync('python3', ['-I', VERIFIER, '--json', 'record', root], {
    encoding: 'utf-8',
  });
  if (run.stdout === '') throw new Error(`the second reader produced no verdict: ${run.stderr}`);
  const parsed = JSON.parse(run.stdout) as {
    verdict: string;
    findings: { level: string; section: string; what: string }[];
  };
  return {
    verdict: parsed.verdict,
    said: parsed.findings.filter((f) => f.section === '6.10').map((f) => `${f.level} ${f.what}`),
  };
}

describe('a new record', () => {
  it('names itself from its own first tail, in its proof and every checkpoint, to both readers', () => {
    const root = aRecord('new');
    const tail = write(root, 'alice', 'one');
    write(root, 'alice', 'two');
    const name = recordName(tail);
    const signed = signedBy(root, tail);
    expect(signed.proof).toEqual({ scheme: NAMED_TAILPROOF_SCHEME, record: name });
    expect(signed.checkpoints).toHaveLength(2);
    for (const checkpoint of signed.checkpoints) {
      expect(checkpoint).toMatchObject({ scheme: NAMED_SCHEME, record: name });
    }
    const here = verify(root);
    expect(here.issues).toEqual([]);
    expect(here.level).toBe('fully-signed');
    expect(here.record).toEqual({ state: 'named', name, genesis: tail, unnamed: [] });
    expect(secondReading(root)).toEqual({
      verdict: 'VERIFIED',
      said: [
        `ok every named tail names record ${name.slice(0, 12)}..., the name of genesis tail ${tail}`,
      ],
    });
  });

  it('is adopted by a second person writing in it, not named again by them', () => {
    const root = aRecord('shared');
    const first = write(root, 'alice', 'one');
    const second = write(root, 'bob', 'two');
    expect(second).not.toBe(first);
    expect(signedBy(root, second).proof.record).toBe(recordName(first));
    expect(verify(root).record).toEqual({
      state: 'named',
      name: recordName(first),
      genesis: first,
      unnamed: [],
    });
  });
});

describe('a record written before records were named', () => {
  it('is named after its genesis tail by its first 0.1.5 writer, the old tail said unnamed', () => {
    const root = copyOf(OLD, 'old');
    const tail = write(root, 'carol', 'after the upgrade');
    const name = recordName(OLD_TAIL);
    expect(signedBy(root, tail).proof).toEqual({ scheme: NAMED_TAILPROOF_SCHEME, record: name });
    const here = verify(root);
    expect(here.issues).toEqual([]);
    expect(here.record).toEqual({ state: 'named', name, genesis: OLD_TAIL, unnamed: [OLD_TAIL] });
    expect(here.census.filter((note) => note.kind === 'unnamed-tail').map((n) => n.tail)).toEqual([
      OLD_TAIL,
    ]);
    const there = secondReading(root);
    expect(there.verdict).toBe('VERIFIED');
    expect(there.said[0]).toBe(
      `ok every named tail names record ${name.slice(0, 12)}..., the name of genesis tail ${OLD_TAIL}`,
    );
  });

  it('gets one name in two clones that never saw each other', () => {
    const one = write(copyOf(OLD, 'clone-1'), 'dave', 'here');
    const two = write(copyOf(OLD, 'clone-2'), 'erin', 'there');
    expect(one).not.toBe(two);
    const n1 = signedBy(join(sandbox, 'clone-1'), one).proof.record;
    const n2 = signedBy(join(sandbox, 'clone-2'), two).proof.record;
    expect(n1).toBe(recordName(OLD_TAIL));
    expect(n2).toBe(n1);
  });

  it('reads the first entry of every tail for the genesis rule, and the name each tail carries', () => {
    const root = copyOf(OLD, 'facts');
    expect(firstEntries({ root }, catalogUpcasters())).toEqual([
      { tail: OLD_TAIL, at: '2026-10-15T17:07:08.853Z' },
    ]);
    const tail = write(root, 'carol', 'x');
    expect(namesOfTails({ root })).toEqual(
      new Map([
        [OLD_TAIL, undefined],
        [tail, recordName(OLD_TAIL)],
      ]),
    );
  });
});

describe('a tail that moves on', () => {
  it('names the new tail from the tail it left', () => {
    const root = aRecord('moved');
    const tail = write(root, 'alice', 'one');
    const fingerprint = tail.slice(0, 64);
    // No note of the last entry written: ADR-135's writer opens a new tail.
    rmSync(keptHeadPath({ root }, tail));
    const next = write(root, 'alice', 'two');
    expect(next).not.toBe(tail);
    expect(existsSync(installationIdPath({ root }, fingerprint))).toBe(true);
    expect(signedBy(root, next).proof.record).toBe(recordName(tail));
    expect(verify(root).issues).toEqual([]);
  });
});

describe('a write into tails of two records', () => {
  /** Record `into` with the tail and key of record `from` grafted in, as sonda 3 grafted them. */
  function graft(from: string, tail: string, into: string): void {
    cpSync(join(from, 'tails', tail), join(into, 'tails', tail), { recursive: true });
    const fingerprint = tail.slice(0, 64);
    cpSync(publicKeyPath({ root: from }, fingerprint), publicKeyPath({ root: into }, fingerprint));
  }

  it('is refused where the other tails name two records, and nothing is written', () => {
    const a = aRecord('a');
    write(a, 'alice', 'in a');
    const b = aRecord('b');
    const bTail = write(b, 'bob', 'in b');
    graft(b, bTail, a);
    const before = listTails({ root: a });
    let thrown: unknown;
    try {
      write(a, 'frank', 'in the graft');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AnotherRecordError);
    expect((thrown as AnotherRecordError).code).toBe('ANOTHER_RECORD');
    expect((thrown as AnotherRecordError).message).toContain('name 2 records');
    expect((thrown as AnotherRecordError).message).toContain('This write was not appended.');
    expect(listTails({ root: a })).toEqual(before);
  });

  it('is refused where its own tail names another record than the rest, and nothing is written', () => {
    const a = aRecord('a');
    write(a, 'alice', 'in a');
    const b = aRecord('b');
    const bTail = write(b, 'bob', 'in b');
    graft(b, bTail, a);
    const fingerprint = bTail.slice(0, 64);
    // The graft whole: the installation id and the note of the head, so the writer keeps its tail.
    cpSync(
      installationIdPath({ root: b }, fingerprint),
      installationIdPath({ root: a }, fingerprint),
    );
    cpSync(keptHeadPath({ root: b }, bTail), keptHeadPath({ root: a }, bTail));
    const lines = readFileSync(checkpointsPath({ root: a }, bTail), 'utf-8');
    let thrown: unknown;
    try {
      write(a, 'bob', 'more in the graft');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AnotherRecordError);
    expect((thrown as AnotherRecordError).refusal).toEqual({
      refused: 'foreign',
      own: recordName(bTail),
      record: expect.any(String),
    });
    expect((thrown as AnotherRecordError).message).toContain('belongs to another record');
    expect(readFileSync(checkpointsPath({ root: a }, bTail), 'utf-8')).toBe(lines);
    expect(listTails({ root: a })).toHaveLength(2);
  });
});
