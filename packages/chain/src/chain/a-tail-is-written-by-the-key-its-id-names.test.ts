/**
 * A TAIL BELONGS TO ONE KEY, AND ONLY THAT KEY WRITES TO IT (FORMAT.md section 6).
 *
 * A tail id begins with the fingerprint of the key that owns it, and its proof (section 6.1)
 * is that key's signature over the id. Nothing used to say who may write INSIDE it: a checkpoint
 * was checked under the key its own `signerFp` names, and an event against its checkpoint, so a
 * second key of the record, enrolled and valid for the anchor, could append its events to
 * another key's tail and sign a checkpoint over them there, and both readers verified it. The
 * one writer of the format derives the tail id and the signing key from one key pair, so no
 * record it writes has this shape; the readers now refuse it, as `tail-signer-mismatch`, on a
 * checkpoint and on every event of the tail, checkpointed or not.
 */

import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { enrollmentMessage, identityFounded, keyEnrolled, taskCreated } from '../events/build.js';
import { canonicalStringify } from '../events/canonical.js';
import type { CatalogEvent } from '../events/catalog.js';
import { verify } from './chain.js';
import { checkpointHash, serializeCheckpoint, signCheckpoint } from './checkpoint.js';
import { entryHash, writtenAsBuilt } from './hash.js';
import { deriveAnchor, generateKeyPair, type KeyPair, publicKeyToPem, sign } from './keys.js';
import { checkpointsPath, publicKeyPath, segmentPath, tailDir, tailProofPath } from './layout.js';
import { serializeTailProof, signTailProof } from './tailproof.js';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnema-tail-signer-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** One run of events and the key that signs a checkpoint over it, or none. */
interface Run {
  readonly events: readonly CatalogEvent[];
  readonly checkpointBy: KeyPair | null;
}

function commit(kp: KeyPair): void {
  mkdirSync(join(root, 'keys'), { recursive: true });
  writeFileSync(publicKeyPath({ root }, kp.fingerprint), publicKeyToPem(kp.publicKey));
}

/** Writes `<owner>-<suffix>` with its proof signed by `owner`, run by run, chained. */
function writeTail(owner: KeyPair, suffix: string, runs: readonly Run[]): string {
  const tail = `${owner.fingerprint}-${suffix}`;
  mkdirSync(tailDir({ root }, tail), { recursive: true });
  writeFileSync(
    tailProofPath({ root }, tail),
    `${serializeTailProof(signTailProof(tail, owner))}\n`,
  );
  const lines: string[] = [];
  let prevHash: string | null = null;
  let prevCheckpoint: string | null = null;
  let seq = 0;
  for (const run of runs) {
    const fromSeq = seq;
    for (const event of run.events) {
      const hash = entryHash({ event: writtenAsBuilt(event), tail, seq, prev: prevHash });
      lines.push(
        canonicalStringify({ event: event as never, link: { tail, seq, prev: prevHash, hash } }),
      );
      prevHash = hash;
      seq += 1;
    }
    if (run.checkpointBy !== null) {
      const cp = signCheckpoint({
        tail,
        fromSeq,
        events: run.events.map(writtenAsBuilt),
        prev: prevCheckpoint,
        keyPair: run.checkpointBy,
      });
      appendFileSync(checkpointsPath({ root }, tail), `${serializeCheckpoint(cp)}\n`);
      prevCheckpoint = checkpointHash(cp);
    }
  }
  writeFileSync(segmentPath({ root }, tail, 1), `${lines.join('\n')}\n`);
  return tail;
}

/**
 * A person founded on key A, who enrolled key B (a second machine): B is a member of the
 * anchor, so every event B signs is one section 6.2 accepts. Only WHERE it writes is in question.
 */
function aPersonWithTwoKeys(): {
  a: KeyPair;
  b: KeyPair;
  anchor: string;
  ownRuns: readonly Run[];
  byB: (subject: string, at: string) => CatalogEvent;
} {
  const a = generateKeyPair();
  const b = generateKeyPair();
  commit(a);
  commit(b);
  const anchor = deriveAnchor(a.fingerprint);
  const founded = identityFounded(
    { at: '2026-10-21T00:00:01.000Z', who: anchor, signerFp: a.fingerprint, subject: anchor },
    { foundingFp: a.fingerprint },
  );
  const reverseSig = Buffer.from(
    sign(enrollmentMessage(anchor, b.fingerprint), b.privateKey),
  ).toString('hex');
  const enrolled = keyEnrolled(
    { at: '2026-10-21T00:00:02.000Z', who: anchor, signerFp: a.fingerprint, subject: anchor },
    { newFp: b.fingerprint, reverseSig },
  );
  const byB = (subject: string, at: string): CatalogEvent =>
    taskCreated({ at, who: anchor, signerFp: b.fingerprint, subject }, { title: subject });
  return { a, b, anchor, ownRuns: [{ events: [founded, enrolled], checkpointBy: a }], byB };
}

const mismatches = (issues: readonly { detail: string }[]): string[] =>
  issues.map((issue) => issue.detail).filter((detail) => detail.includes('tail-signer-mismatch'));

describe('a tail and the key its id begins with', () => {
  it('verifies a second key that writes in its OWN tail, checkpointed or not', () => {
    const { a, b, ownRuns, byB } = aPersonWithTwoKeys();
    writeTail(a, 'i1', ownRuns);
    writeTail(b, 'i2', [
      { events: [byB('t-signed', '2026-10-21T00:00:03.000Z')], checkpointBy: b },
      { events: [byB('t-above', '2026-10-21T00:00:04.000Z')], checkpointBy: null },
    ]);
    const result = verify(root);
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.uncheckpointedEvents).toBe(1);
  });

  it('refuses a checkpoint another key signed in the tail, over events naming that key', () => {
    const { a, b, ownRuns, byB } = aPersonWithTwoKeys();
    const tail = writeTail(a, 'i1', [
      ...ownRuns,
      { events: [byB('t-in-a', '2026-10-21T00:00:03.000Z')], checkpointBy: b },
    ]);
    const result = verify(root);
    expect(result.ok).toBe(false);
    expect(result.level).toBe('broken');
    expect(result.issues.filter((issue) => issue.detail.includes('tail-signer-mismatch'))).toEqual([
      {
        tail,
        layer: 'T2/T4',
        seq: 2,
        detail:
          `checkpoint cp[2..2] is signed by ${b.fingerprint.slice(0, 12)}..., and a tail is ` +
          `written only by the key its id begins with, ${a.fingerprint.slice(0, 12)}... ` +
          '(tail-signer-mismatch)',
      },
      {
        tail,
        layer: 'T2/T4',
        seq: 2,
        detail:
          `seq 2 names ${b.fingerprint.slice(0, 12)}... as its signer, and a tail is written ` +
          `only by the key its id begins with, ${a.fingerprint.slice(0, 12)}... ` +
          '(tail-signer-mismatch)',
      },
    ]);
    // Nothing else is wrong with it: the signature verifies, the range binds to its signer
    // and B is a member of the anchor. The only refusal is the one this rule makes.
    expect(result.issues).toHaveLength(2);
  });

  it('refuses an event above the last checkpoint that names another key, which no checkpoint binds', () => {
    const { a, b, ownRuns, byB } = aPersonWithTwoKeys();
    const tail = writeTail(a, 'i1', [
      ...ownRuns,
      { events: [byB('t-above-a', '2026-10-21T00:00:03.000Z')], checkpointBy: null },
    ]);
    const result = verify(root);
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([
      {
        tail,
        layer: 'T2/T4',
        seq: 2,
        detail:
          `seq 2 names ${b.fingerprint.slice(0, 12)}... as its signer, and a tail is written ` +
          `only by the key its id begins with, ${a.fingerprint.slice(0, 12)}... ` +
          '(tail-signer-mismatch)',
      },
    ]);
  });

  it('names the first event only, once per tail, however many follow it', () => {
    const { a, ownRuns, byB } = aPersonWithTwoKeys();
    writeTail(a, 'i1', [
      ...ownRuns,
      {
        events: [byB('t-1', '2026-10-21T00:00:03.000Z'), byB('t-2', '2026-10-21T00:00:04.000Z')],
        checkpointBy: null,
      },
    ]);
    expect(mismatches(verify(root).issues)).toHaveLength(1);
  });
});
