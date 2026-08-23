/**
 * What the record can conclude, offline, from what it stored.
 *
 * THE THREE STATES ARE THE SUBJECT and the middle one is where the cases cluster.
 * `not-covered` and `covered` are the easy ends; `pending` is the one a design can
 * get wrong in a way that reads as success, because a request that succeeded is
 * exactly what a person has in front of them when they are most inclined to believe
 * they are done.
 *
 * THE COVERED CASES REST ON REAL BYTES. Block 800000's header is the vector
 * (witness-vectors.ts) — a header this test could fabricate would meet whatever rule
 * this package happened to implement — and the proof over it is built here with a
 * path of no steps, so the digest the proof commits to IS the merkle root the block
 * carries. That shape is legal, it is not the shape a calendar produces, and it is
 * the only one a test can construct: reaching a real merkle root through a real path
 * means finding a preimage, which is the thing the whole scheme rests on being
 * impossible.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BLOCK_HEADER_BYTES } from './bitcoin.js';
import type { ChainLayout } from './layout.js';
import { witnessBlocksPath, witnessProofPath } from './layout.js';
import { serializeOtsProof } from './ots.js';
import { readStoredWitness, readWitness, witnessOfChain, writeWitness } from './witness.js';
import {
  BLOCK_800000_HEADER,
  BLOCK_800000_HEIGHT,
  BLOCK_800000_MERKLE_ROOT,
  BLOCK_800000_TIME,
  PENDING_PROOF_BASE64,
  PENDING_PROOF_DIGEST,
} from './witness-vectors.js';

const TAIL = 'ffff-0001';
const PENDING = Buffer.from(PENDING_PROOF_BASE64, 'base64');
const HEADER = Buffer.from(BLOCK_800000_HEADER, 'hex');

/** A proof that a block carries the digest itself — see this file's header. */
function anchoredProof(digestHex: string, height = BLOCK_800000_HEIGHT): Buffer {
  return serializeOtsProof(Buffer.from(digestHex, 'hex'), {
    attestations: [{ kind: 'bitcoin', height }],
    steps: [],
  });
}

let root: string;
let layout: ChainLayout;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mnema-witness-read-'));
  layout = { root };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('a record nobody stamped', () => {
  it('reads not-covered, which is what it always read', () => {
    expect(readWitness(layout, TAIL, PENDING_PROOF_DIGEST)).toEqual({
      status: 'not-covered',
      detail: 'nothing outside this machine attests this record',
    });
  });

  it('holds no stored witness to read', () => {
    expect(readStoredWitness(layout, TAIL, PENDING_PROOF_DIGEST)).toBeNull();
  });
});

describe('a request that has not confirmed', () => {
  beforeEach(() => {
    writeWitness(layout, TAIL, PENDING_PROOF_DIGEST, { proof: PENDING });
  });

  it('reads PENDING and names the calendar it is waiting on', () => {
    const reading = readWitness(layout, TAIL, PENDING_PROOF_DIGEST);
    expect(reading.status).toBe('pending');
    expect(reading.detail).toContain('alice.btc.calendar.opentimestamps.org');
    expect(reading.detail).toContain('has not confirmed');
  });

  it('carries no instant and no block, because none has been attested', () => {
    const reading = readWitness(layout, TAIL, PENDING_PROOF_DIGEST);
    expect(reading.at).toBeUndefined();
    expect(reading.block).toBeUndefined();
  });

  it('leaves no headers sidecar behind for a reader to wonder about', () => {
    const stored = readStoredWitness(layout, TAIL, PENDING_PROOF_DIGEST);
    expect(stored?.headers.size).toBe(0);
    expect(stored?.proof.equals(PENDING)).toBe(true);
  });
});

describe('an attestation that reached a block', () => {
  const digest = BLOCK_800000_MERKLE_ROOT;

  it('reads COVERED, and says which block and when', () => {
    writeWitness(layout, TAIL, digest, {
      proof: anchoredProof(digest),
      headers: new Map([[BLOCK_800000_HEIGHT, HEADER]]),
    });
    expect(readWitness(layout, TAIL, digest)).toEqual({
      status: 'covered',
      detail: `Bitcoin block ${BLOCK_800000_HEIGHT} at ${new Date(BLOCK_800000_TIME * 1000).toISOString()}`,
      at: BLOCK_800000_TIME,
      block: BLOCK_800000_HEIGHT,
    });
  });

  it('reads PENDING while the record does not carry the block header', () => {
    writeWitness(layout, TAIL, digest, { proof: anchoredProof(digest) });
    const reading = readWitness(layout, TAIL, digest);
    expect(reading.status).toBe('pending');
    expect(reading.detail).toContain(`block ${BLOCK_800000_HEIGHT}`);
    expect(reading.detail).toContain('does not carry');
  });
});

describe('a stored witness that does not say what it claims', () => {
  const digest = BLOCK_800000_MERKLE_ROOT;

  it('refuses a proof filed under a checkpoint it is not about', () => {
    writeWitness(layout, TAIL, PENDING_PROOF_DIGEST, { proof: anchoredProof(digest) });
    expect(readWitness(layout, TAIL, PENDING_PROOF_DIGEST)).toEqual({
      status: 'not-covered',
      detail: 'the stored proof is over another digest, so it attests nothing here',
    });
  });

  it('refuses a header that carries another merkle root', () => {
    // The real header, attached to a proof about something else: the attestation is
    // impeccable, the block is real, and it says nothing about this digest.
    const other = 'a'.repeat(64);
    writeWitness(layout, TAIL, other, {
      proof: anchoredProof(other),
      headers: new Map([[BLOCK_800000_HEIGHT, HEADER]]),
    });
    const reading = readWitness(layout, TAIL, other);
    expect(reading.status).toBe('not-covered');
    expect(reading.detail).toContain('another merkle root');
  });

  it('refuses a header nobody mined, however consistent it is with itself', () => {
    // A header whose merkle root IS the digest and whose declared difficulty is the
    // easiest the format can express: the sidecar a forger writes in a millisecond.
    const forged = Buffer.alloc(BLOCK_HEADER_BYTES);
    Buffer.from(digest, 'hex').copy(forged, 36);
    forged.writeUInt32LE(0x207fffff, 72);
    writeWitness(layout, TAIL, digest, {
      proof: anchoredProof(digest),
      headers: new Map([[BLOCK_800000_HEIGHT, forged]]),
    });
    const reading = readWitness(layout, TAIL, digest);
    expect(reading.status).toBe('not-covered');
    expect(reading.detail).toContain('no proof of work');
  });

  it('refuses a proof deep enough to take the stack down, as a READING', () => {
    // The verdict is about a CHAIN; the proof is a file beside it that a hostile clone
    // wrote. A throw out of the reader here would take the whole verdict with it, which
    // is why the parse and the WALK are under one guard.
    const hostile = Buffer.concat([
      Buffer.from('004f70656e54696d657374616d7073000050726f6f6600bf89e2e884e89294', 'hex'),
      Buffer.from([1, 0x08]),
      Buffer.from(digest, 'hex'),
      Buffer.alloc(30_000, 0x08),
      Buffer.from('0083dfe30d2ef90c8e020178', 'hex'),
    ]);
    writeWitness(layout, TAIL, digest, { proof: hostile });
    const reading = readWitness(layout, TAIL, digest);
    expect(reading.status).toBe('not-covered');
    expect(reading.detail).toContain('deeper than 1000 steps');
    // And it says so in the format's words, not the runtime's.
    expect(reading.detail).not.toContain('call stack');
  });

  it('refuses a proof too big to read WITHOUT reading it', () => {
    // The order is what this case is about. `parseOtsProof` refuses a proof past its
    // limit — the right refusal at the wrong moment, since by then the bytes are in
    // memory. A clone can commit a file of any size, so the size is asked first.
    const huge = Buffer.alloc((1 << 20) + 1);
    writeWitness(layout, TAIL, digest, { proof: huge });
    const reading = readWitness(layout, TAIL, digest);
    expect(reading.status).toBe('not-covered');
    // Read back as the stand-in rather than as the file: the bytes never entered.
    const stored = readStoredWitness(layout, TAIL, digest);
    expect(stored?.proof.length).toBeLessThan(100);
  });

  it('ignores a headers sidecar past the size any capped proof can ask for', () => {
    writeWitness(layout, TAIL, digest, { proof: anchoredProof(digest) });
    writeFileSync(witnessBlocksPath(layout, TAIL, digest), 'x'.repeat(1 << 17), 'utf-8');
    // The anchor is still reached; what is gone is the header that would cover it.
    const reading = readWitness(layout, TAIL, digest);
    expect(reading.status).toBe('pending');
    expect(reading.detail).toContain('does not carry');
  });

  it('refuses bytes that are not a proof, without taking the verdict down with them', () => {
    writeWitness(layout, TAIL, digest, { proof: Buffer.from('this is not a proof') });
    const reading = readWitness(layout, TAIL, digest);
    expect(reading.status).toBe('not-covered');
    expect(reading.detail).toContain('unreadable');
  });

  it('ignores a headers line it cannot read rather than throwing over a sidecar', () => {
    writeWitness(layout, TAIL, digest, { proof: anchoredProof(digest) });
    writeFileSync(witnessBlocksPath(layout, TAIL, digest), 'not json\n{"height":1}\n', 'utf-8');
    expect(readWitness(layout, TAIL, digest).status).toBe('pending');
  });
});

describe('the chain-wide reading', () => {
  const covered = BLOCK_800000_MERKLE_ROOT;

  /** Stamps `tail` so that it reads covered. */
  const stampCovered = (tail: string): void => {
    writeWitness(layout, tail, covered, {
      proof: anchoredProof(covered),
      headers: new Map([[BLOCK_800000_HEIGHT, HEADER]]),
    });
  };

  it('is covered when every tail is', () => {
    stampCovered('a-1');
    stampCovered('b-2');
    const witness = witnessOfChain(
      layout,
      new Map([
        ['a-1', covered],
        ['b-2', covered],
      ]),
    );
    expect(witness.status).toBe('covered');
    expect(witness.tails.map((t) => t.reading.status)).toEqual(['covered', 'covered']);
  });

  it('is the WEAKEST tail, so one witnessed machine never speaks for the one beside it', () => {
    stampCovered('a-1');
    const witness = witnessOfChain(
      layout,
      new Map([
        ['a-1', covered],
        ['b-2', PENDING_PROOF_DIGEST],
      ]),
    );
    expect(witness.status).toBe('not-covered');
  });

  it('is pending when the weakest tail is waiting', () => {
    stampCovered('a-1');
    writeWitness(layout, 'b-2', PENDING_PROOF_DIGEST, { proof: PENDING });
    const witness = witnessOfChain(
      layout,
      new Map([
        ['a-1', covered],
        ['b-2', PENDING_PROOF_DIGEST],
      ]),
    );
    expect(witness.status).toBe('pending');
  });

  it('is not-covered for a tail with no verified checkpoint to witness', () => {
    const witness = witnessOfChain(layout, new Map([['a-1', null]]));
    expect(witness.status).toBe('not-covered');
    expect(witness.detail).toContain('passed its signature check');
  });

  it('is not-covered for a chain with no tail at all', () => {
    expect(witnessOfChain(layout, new Map()).status).toBe('not-covered');
  });

  it('reports every tail it was asked about, including the ones that answer nothing', () => {
    stampCovered('a-1');
    const witness = witnessOfChain(
      layout,
      new Map([
        ['a-1', covered],
        ['b-2', null],
      ]),
    );
    expect(witness.tails.map((t) => [t.tail, t.checkpoint, t.reading.status])).toEqual([
      ['a-1', covered, 'covered'],
      ['b-2', null, 'not-covered'],
    ]);
  });
});

describe('what the store puts on disk', () => {
  it('names the proof by the checkpoint it is about, so a second stamp replaces it', () => {
    writeWitness(layout, TAIL, PENDING_PROOF_DIGEST, { proof: PENDING });
    const path = witnessProofPath(layout, TAIL, PENDING_PROOF_DIGEST);
    expect(path.endsWith(`${PENDING_PROOF_DIGEST}.ots`)).toBe(true);
    writeWitness(layout, TAIL, PENDING_PROOF_DIGEST, {
      proof: anchoredProof(PENDING_PROOF_DIGEST),
      headers: new Map([[BLOCK_800000_HEIGHT, HEADER]]),
    });
    const stored = readStoredWitness(layout, TAIL, PENDING_PROOF_DIGEST);
    expect(stored?.proof.equals(PENDING)).toBe(false);
    expect(stored?.headers.get(BLOCK_800000_HEIGHT)?.equals(HEADER)).toBe(true);
  });
});
