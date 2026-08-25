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
import {
  readStoredWitness,
  readWitness,
  type WitnessedTail,
  type WitnessReading,
  witnessOfChain,
  witnessOfTail,
  writeWitness,
} from './witness.js';
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
      // The absence is MARKED, because its words are a claim about the whole record
      // rather than a finding about one file — the one sentence here another file in
      // the tree can falsify. `witnessOfTail` is what acts on the mark.
      absent: true,
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

  /** One tail whose only checkpoint is `hash`, covering everything it holds. */
  const wholly = (hash: string): WitnessedTail => ({
    checkpoints: [{ hash, toSeq: 0 }],
    events: 1,
  });

  it('is covered when every tail is', () => {
    stampCovered('a-1');
    stampCovered('b-2');
    const witness = witnessOfChain(
      layout,
      new Map([
        ['a-1', wholly(covered)],
        ['b-2', wholly(covered)],
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
        ['a-1', wholly(covered)],
        ['b-2', wholly(PENDING_PROOF_DIGEST)],
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
        ['a-1', wholly(covered)],
        ['b-2', wholly(PENDING_PROOF_DIGEST)],
      ]),
    );
    expect(witness.status).toBe('pending');
  });

  it('is not-covered for a tail with no verified checkpoint to witness', () => {
    const witness = witnessOfChain(layout, new Map([['a-1', { checkpoints: [], events: 0 }]]));
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
        ['a-1', wholly(covered)],
        ['b-2', { checkpoints: [], events: 0 }],
      ]),
    );
    expect(witness.tails.map((t) => [t.tail, t.checkpoint, t.reading.status])).toEqual([
      ['a-1', covered, 'covered'],
      ['b-2', null, 'not-covered'],
    ]);
  });

  it('never lets the ABSENCE speak for a chain that holds an attestation', () => {
    // The same false sentence this delivery removes, one level up. Two tails, one
    // dated and one never stamped: the weakest is still the undated one and still
    // decides the status, but `nothing outside this machine attests this record` is
    // a claim about EVERYTHING and this chain holds a proof. The words that are
    // untouchable are the ones a record with NO attestation anywhere earns — the
    // case above — and this is not that record.
    stampCovered('a-1');
    const witness = witnessOfChain(
      layout,
      new Map([
        ['a-1', wholly(covered)],
        ['b-2', wholly(PENDING_PROOF_DIGEST)],
      ]),
    );
    expect(witness.status).toBe('not-covered');
    expect(witness.detail).not.toContain('nothing outside this machine attests this record');
    expect(witness.detail).toBe('tail b-2 holds no attestation');
  });

  it('publishes the DATING only when the weakest tail is the one carrying it', () => {
    // A tail dated to a point beside a tail nobody stamped. The dating is true of the
    // first and false of the second, so the chain's sentence must not carry it — the
    // fold keeps the reading that CLAIMS LESS, not merely the one with the weakest
    // status, because at `not-covered` those two stopped being the same thing.
    stampCovered('a-1');
    const witness = witnessOfChain(
      layout,
      new Map([
        ['a-1', { checkpoints: [{ hash: covered, toSeq: 0 }], events: 4 }],
        ['b-2', wholly(PENDING_PROOF_DIGEST)],
      ]),
    );
    expect(witness.detail).not.toContain('dated by Bitcoin block');
    expect(witness.tails[0]?.reading.detail).toContain('dated by Bitcoin block');
  });

  it('publishes the LARGEST remainder when two tails are dated by the same block', () => {
    // FOUND BY A PROBE, NOT BY READING THE CODE. Tied on status, on carrying a dating
    // and on the instant, the fold kept whichever tail came first — so a chain with
    // one tail a single event past its dating and one thirty-eight past published
    // `1 event(s)`, which is a floor thirty-eight events too high. The count the chain
    // says has to be one no tail falls below.
    stampCovered('a-1');
    stampCovered('b-2');
    const witness = witnessOfChain(
      layout,
      new Map([
        ['a-1', { checkpoints: [{ hash: covered, toSeq: 1 }], events: 3 }],
        ['b-2', { checkpoints: [{ hash: covered, toSeq: 1 }], events: 40 }],
      ]),
    );
    expect(witness.detail).toContain('with 38 event(s) written after it');
  });

  it('publishes the dating when EVERY tail carries one', () => {
    stampCovered('a-1');
    stampCovered('b-2');
    const witness = witnessOfChain(
      layout,
      new Map([
        ['a-1', { checkpoints: [{ hash: covered, toSeq: 0 }], events: 3 }],
        ['b-2', { checkpoints: [{ hash: covered, toSeq: 0 }], events: 9 }],
      ]),
    );
    expect(witness.status).toBe('not-covered');
    // The WEAKEST of the two datings: same instant, so the tie falls to the first,
    // and either one is true of a chain where both are dated by the same block.
    expect(witness.detail).toContain(`dated by Bitcoin block ${BLOCK_800000_HEIGHT}`);
    expect(witness.detail).toContain('event(s) written after it');
  });
});

describe('a tail whose attestation is over an OLDER checkpoint', () => {
  const covered = BLOCK_800000_MERKLE_ROOT;
  const AT = new Date(BLOCK_800000_TIME * 1000).toISOString();

  beforeEach(() => {
    writeWitness(layout, TAIL, covered, {
      proof: anchoredProof(covered),
      headers: new Map([[BLOCK_800000_HEIGHT, HEADER]]),
    });
  });

  /** Reads the tail with `covered` at seq 1 and two checkpoints sealed above it. */
  const dated = (events: number): WitnessReading =>
    witnessOfTail(layout, TAIL, {
      checkpoints: [
        { hash: covered, toSeq: 1 },
        { hash: 'a'.repeat(64), toSeq: 2 },
        { hash: 'b'.repeat(64), toSeq: 3 },
      ],
      events,
    }) as WitnessReading;

  it('gives the date and how much of the record it dates — the delivery’s case', () => {
    const reading = dated(4);
    expect(reading.detail).toBe(
      `the last attested checkpoint is dated by Bitcoin block ${BLOCK_800000_HEIGHT} at ${AT}, ` +
        'with 2 event(s) written after it',
    );
  });

  it('does NOT say nothing attests this record, which is the defect itself', () => {
    // Asserted as an ABSENCE of the sentence and not as the presence of another,
    // because the sentence is the defect: a record holding a valid attestation in its
    // own tree answered `nothing outside this machine attests this record` the moment
    // somebody wrote one more event.
    expect(dated(4).detail).not.toContain('nothing outside this machine attests this record');
  });

  it('stays NOT COVERED — a record dated to a point is not a record that is covered', () => {
    // The mirror of what `pending` got wrong: a state that reads as coverage because
    // it sounds like progress. The date arrives with the count of what it does not
    // cover, in the same sentence, under the word `not covered`.
    const reading = dated(4);
    expect(reading.status).toBe('not-covered');
    expect(reading.datedThrough).toEqual({
      at: BLOCK_800000_TIME,
      block: BLOCK_800000_HEIGHT,
      after: 2,
    });
  });

  it('counts every event after the dated checkpoint, sealed or not', () => {
    // Six events over the same three checkpoints: two the later checkpoints cover and
    // two above them, and all four are outside the dating. A count taken from the
    // checkpoints alone would say two and would be a second half-truth.
    expect(dated(6).detail).toContain('with 4 event(s) written after it');
  });

  it('reads COVERED when the attested checkpoint is the last event there is', () => {
    // The frozen record's own state, and the words it has always earned.
    const reading = witnessOfTail(layout, TAIL, {
      checkpoints: [{ hash: covered, toSeq: 1 }],
      events: 2,
    });
    expect(reading?.status).toBe('covered');
    expect(reading?.detail).toBe(`Bitcoin block ${BLOCK_800000_HEIGHT} at ${AT}`);
  });

  it('is NOT covered when the attested checkpoint is the last CHECKPOINT and not the last event', () => {
    // Events above the last checkpoint are outside the dating exactly as they are
    // outside the signature. The clause used to say `covered` flatly here.
    const reading = witnessOfTail(layout, TAIL, {
      checkpoints: [{ hash: covered, toSeq: 1 }],
      events: 5,
    });
    expect(reading?.status).toBe('not-covered');
    expect(reading?.detail).toContain('with 3 event(s) written after it');
  });

  it('keeps a FINDING about the head’s own file beside the dating', () => {
    // A refusal is true about the file it read and stays true beside any dating, so
    // replacing it would turn a fix for an understatement into a hidden forgery
    // signal. Only the ABSENCE is replaced, because only the absence goes false.
    writeWitness(layout, TAIL, 'c'.repeat(64), { proof: Buffer.from('not a proof') });
    const reading = witnessOfTail(layout, TAIL, {
      checkpoints: [
        { hash: covered, toSeq: 1 },
        { hash: 'c'.repeat(64), toSeq: 2 },
      ],
      events: 4,
    });
    expect(reading?.detail).toContain('the stored proof is unreadable');
    expect(reading?.detail).toContain('dated by Bitcoin block');
  });

  it('says PENDING and the dating together when the head is still waiting', () => {
    writeWitness(layout, TAIL, PENDING_PROOF_DIGEST, { proof: PENDING });
    const reading = witnessOfTail(layout, TAIL, {
      checkpoints: [
        { hash: covered, toSeq: 1 },
        { hash: PENDING_PROOF_DIGEST, toSeq: 2 },
      ],
      events: 4,
    });
    expect(reading?.status).toBe('pending');
    expect(reading?.detail).toContain('has not confirmed');
    expect(reading?.detail).toContain('dated by Bitcoin block');
  });

  it('walks PAST a checkpoint whose proof reaches no confirmation', () => {
    // The walk looks for the newest checkpoint that READS covered, not the newest
    // that has a file: a pending proof in between is not a dating and must not stop
    // the search short of the one that is.
    writeWitness(layout, TAIL, PENDING_PROOF_DIGEST, { proof: PENDING });
    const reading = witnessOfTail(layout, TAIL, {
      checkpoints: [
        { hash: covered, toSeq: 1 },
        { hash: PENDING_PROOF_DIGEST, toSeq: 2 },
        { hash: 'd'.repeat(64), toSeq: 3 },
      ],
      events: 4,
    });
    expect(reading?.detail).toContain('dated by Bitcoin block');
    expect(reading?.datedThrough?.after).toBe(2);
  });

  it('ignores an attestation filed under a checkpoint the caller did not offer', () => {
    // The verifier hands over the checkpoints it PROVED. A proof sitting under a
    // digest that is no longer in the chain attests a checkpoint that is gone, and a
    // reading that took it would date a record by a checkpoint nothing proves.
    const reading = witnessOfTail(layout, TAIL, {
      checkpoints: [{ hash: 'e'.repeat(64), toSeq: 3 }],
      events: 4,
    });
    expect(reading).toEqual({
      status: 'not-covered',
      detail: 'nothing outside this machine attests this record',
      absent: true,
    });
  });

  it('answers null when no checkpoint was offered at all', () => {
    expect(witnessOfTail(layout, TAIL, { checkpoints: [], events: 0 })).toBeNull();
  });
});

describe('which checkpoints the walk is willing to open', () => {
  it('agrees with readWitness about a tail with no witness directory at all', () => {
    // The walk lists the directory once instead of asking `existsSync` per checkpoint,
    // and that shortcut may only ever SKIP a checkpoint whose proof is absent. Pinned
    // against the function that owns the question rather than assumed.
    const reading = witnessOfTail(layout, 'empty-1', {
      checkpoints: [{ hash: PENDING_PROOF_DIGEST, toSeq: 0 }],
      events: 1,
    });
    expect(reading).toEqual(readWitness(layout, 'empty-1', PENDING_PROOF_DIGEST));
  });

  it('agrees with readWitness about a checkpoint whose proof is not on the disk', () => {
    writeWitness(layout, TAIL, PENDING_PROOF_DIGEST, { proof: PENDING });
    const absent = 'f'.repeat(64);
    const reading = witnessOfTail(layout, TAIL, {
      checkpoints: [{ hash: absent, toSeq: 0 }],
      events: 1,
    });
    expect(reading).toEqual(readWitness(layout, TAIL, absent));
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
