/**
 * THE PROMISE BETWEEN VERSIONS, held by both readers (`FORMAT.md` §7.1).
 *
 * BACKWARD. `__fixtures__/written-by-an-earlier-binary` is a record this product's own CLI wrote on
 * 15 October 2026, from the trunk at `ac3d1822`, and it is frozen: a person's identity with its
 * backup key, a memory captured and taken back, three decisions moved through every row of their
 * workflow that ends somewhere (accepted, superseded, rejected), a task moved through blocked,
 * review, changes asked, approval, a reopening and completion, and a link that governs a path. It
 * is never written again. Every later binary has to read it the way the binary that wrote it did:
 * every line under the contract its `kind` and `v` select, every move applied, nothing refused.
 *
 * FORWARD. A record holding a line whose `kind` and `v` no row of a reader's table declares is
 * what a newer writer leaves for an older reader. Built here signed, chained and checkpointed, so
 * the only thing wrong with it is that the reader does not hold its contract, and both readers have
 * to refuse it by naming the pair, what they do hold of that kind, and — for this product — the
 * version of mnema that refuses.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { identityFounded, memoryCaptured } from '../events/build.js';
import { canonicalStringify } from '../events/canonical.js';
import type { CatalogEvent } from '../events/catalog.js';
import { catalogUpcasters } from '../events/registry.js';
import { READER_VERSION } from '../version.js';
import { verify } from './chain.js';
import { serializeCheckpoint, signCheckpoint } from './checkpoint.js';
import { entryHash, writtenAsBuilt } from './hash.js';
import { deriveAnchor, generateKeyPair, type KeyPair, publicKeyToPem } from './keys.js';
import { checkpointsPath, publicKeyPath, segmentPath, tailDir, tailProofPath } from './layout.js';
import { serializeTailProof, signTailProof } from './tailproof.js';

const VERIFIER = fileURLToPath(new URL('../../verifier/mnema_verify.py', import.meta.url));
const EARLIER = fileURLToPath(
  new URL('./__fixtures__/written-by-an-earlier-binary', import.meta.url),
);

interface SecondReading {
  readonly verdict: string;
  readonly findings: readonly {
    readonly level: string;
    readonly section: string;
    readonly what: string;
  }[];
}

function secondReading(record: string): SecondReading {
  const run = spawnSync('python3', [VERIFIER, '--json', 'record', record], { encoding: 'utf-8' });
  if (run.stdout === '') {
    throw new Error(`the second reader produced no verdict. stderr: ${run.stderr}`);
  }
  return JSON.parse(run.stdout) as SecondReading;
}

describe('backward: a record an earlier binary wrote is read by this one', () => {
  it('verifies it, every event signed, with nothing refused and no move left unapplied', () => {
    const here = verify(EARLIER, catalogUpcasters());
    expect(here.issues).toEqual([]);
    expect(here.ok).toBe(true);
    expect(here.fullySigned).toBe(true);
    expect(here.tails.map((t) => t.entryCount)).toEqual([27]);
    // The backup key `init` declares is the one census line such a record carries: no move
    // the workflow does not allow, no retraction by a stranger.
    expect(here.census.map((note) => note.kind)).toEqual(['backup-key']);
  });

  it('is verified by the second reader too, with nothing failed and nothing left unchecked', () => {
    const there = secondReading(EARLIER);
    expect(there.verdict).toBe('VERIFIED');
    expect(there.findings.filter((f) => f.level === 'FAIL' || f.level === 'UNCHECKED')).toEqual([]);
  });
});

describe('forward: a contract this reader does not hold is refused by naming it', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mnema-promise-forward-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /** One tail, chained, with its birth proof and a checkpoint over every line of it. */
  function writeRecord(kp: KeyPair, events: readonly CatalogEvent[]): void {
    mkdirSync(join(root, 'keys'), { recursive: true });
    writeFileSync(publicKeyPath({ root }, kp.fingerprint), publicKeyToPem(kp.publicKey));
    const tailId = `${kp.fingerprint}-i1`;
    mkdirSync(tailDir({ root }, tailId), { recursive: true });
    const lines: string[] = [];
    let prev: string | null = null;
    events.forEach((event, seq) => {
      const hash = entryHash({ event: writtenAsBuilt(event), tail: tailId, seq, prev });
      lines.push(
        canonicalStringify({ event: event as never, link: { tail: tailId, seq, prev, hash } }),
      );
      prev = hash;
    });
    writeFileSync(segmentPath({ root }, tailId, 1), `${lines.join('\n')}\n`);
    writeFileSync(
      tailProofPath({ root }, tailId),
      `${serializeTailProof(signTailProof(tailId, kp))}\n`,
    );
    const checkpoint = signCheckpoint({
      tail: tailId,
      fromSeq: 0,
      events: events.map(writtenAsBuilt),
      prev: null,
      keyPair: kp,
    });
    writeFileSync(checkpointsPath({ root }, tailId), `${serializeCheckpoint(checkpoint)}\n`);
  }

  /** A founded identity, one memory, and a third line carrying `kind` and `v` as given. */
  function recordWith(kind: string, v: number): void {
    const kp = generateKeyPair();
    const anchor = deriveAnchor(kp.fingerprint);
    const head = { who: anchor, signerFp: kp.fingerprint };
    const founded = identityFounded(
      { ...head, at: '2026-10-15T00:00:01.000Z', subject: anchor },
      { foundingFp: kp.fingerprint },
    );
    const memory = memoryCaptured(
      { ...head, at: '2026-10-15T00:00:02.000Z', subject: 'm-1' },
      { content: 'The build caches nothing between runs.' },
    );
    const ahead = memoryCaptured(
      { ...head, at: '2026-10-15T00:00:03.000Z', subject: 'm-2' },
      { content: 'Written by a newer writer.' },
    );
    writeRecord(kp, [founded, memory, { ...ahead, kind, v } as unknown as CatalogEvent]);
  }

  function productIssues(): readonly string[] {
    const here = verify(root, catalogUpcasters());
    expect(here.ok).toBe(false);
    return here.issues.map((issue) => issue.detail);
  }

  function secondRefusals(): readonly string[] {
    const there = secondReading(root);
    expect(there.verdict).toBe('REFUSED');
    return there.findings.filter((f) => f.level === 'FAIL').map((f) => `${f.section}: ${f.what}`);
  }

  it('a kind this reader has no version of: refused, naming the pair and this mnema', () => {
    recordWith('memory.foretold', 1);
    expect(productIssues()).toEqual([
      expect.stringContaining(
        `line 3: entry event is invalid: mnema ${READER_VERSION} does not read "memory.foretold" ` +
          'at v1: it reads no version of that kind. If a newer mnema wrote the line, read the ' +
          'record with it.',
      ),
    ]);
    expect(secondRefusals()).toEqual([
      expect.stringContaining(
        '4.1: no published contract declares memory.foretold@1: the table this reader read ' +
          'declares no version of memory.foretold.',
      ),
    ]);
  });

  it('a version ahead of the one this reader holds: refused, naming both versions', () => {
    recordWith('memory.captured', 2);
    expect(productIssues()).toEqual([
      expect.stringContaining(
        `line 3: entry event is invalid: mnema ${READER_VERSION} does not read "memory.captured" ` +
          'at v2: it reads that kind up to v1. If a newer mnema wrote the line, read the record ' +
          'with it.',
      ),
    ]);
    expect(secondRefusals()).toEqual([
      expect.stringContaining(
        '4.1: no published contract declares memory.captured@2: the table this reader read ' +
          'declares memory.captured up to v1.',
      ),
    ]);
  });

  it('the same record with the line at the version this reader holds is verified by both', () => {
    // The control: without it, a record refused for any other reason would satisfy both cases.
    recordWith('memory.captured', 1);
    const here = verify(root, catalogUpcasters());
    expect(here.issues).toEqual([]);
    expect(here.ok).toBe(true);
    expect(secondReading(root).verdict).toBe('VERIFIED');
  });
});
