/**
 * The 80 bytes a witness rests on, checked against a real block and against the
 * cheapest forgery there is.
 *
 * THE FORGERY IS THE INTERESTING CASE and it is why this file is longer than the
 * function it covers. A block header declares the difficulty it was mined at, so a
 * check that asks only "did it meet its own claim" is satisfied in a millisecond by
 * a header that claims nothing — mine one here, at the easiest target the format can
 * express, and watch it be refused. Without the floor that refusal does not happen,
 * and the whole sidecar becomes forgeable at the cost of a loop.
 */

import { describe, expect, it } from 'vitest';

import {
  BLOCK_HEADER_BYTES,
  headerCarriesRealWork,
  MINIMUM_WORK,
  parseBlockHeader,
  UnreadableHeaderError,
} from './bitcoin.js';
import {
  BLOCK_800000_HEADER,
  BLOCK_800000_ID,
  BLOCK_800000_MERKLE_ROOT,
  BLOCK_800000_TIME,
} from './witness-vectors.js';

const REAL = Buffer.from(BLOCK_800000_HEADER, 'hex');

/**
 * A header this test mines, at whatever difficulty it is told to claim.
 *
 * `0x207fffff` is the easiest target the compact form can express and the one a
 * regtest chain uses; a nonce that meets it is found in microseconds, which is
 * precisely the point being made.
 */
function mined(bits: number, merkleRoot: Buffer): Buffer {
  const header = Buffer.alloc(BLOCK_HEADER_BYTES);
  header.writeUInt32LE(1, 0);
  merkleRoot.copy(header, 36);
  header.writeUInt32LE(1690000000, 68);
  header.writeUInt32LE(bits, 72);
  for (let nonce = 0; nonce < 5_000_000; nonce += 1) {
    header.writeUInt32LE(nonce, 76);
    if (headerCarriesItsOwnClaim(header)) return header;
  }
  throw new Error('no nonce met even the easiest target — the mining loop is wrong');
}

/** The half of the rule that is NOT the floor, so the mining loop can aim at it. */
function headerCarriesItsOwnClaim(header: Buffer): boolean {
  const parsed = parseBlockHeader(header);
  // Re-implemented here on purpose and only here: the loop needs a target to aim at
  // while the product's own answer is the thing under test.
  const exponent = parsed.bits >>> 24;
  const mantissa = parsed.bits & 0x007fffff;
  const target = Buffer.alloc(32);
  target.writeUIntBE(mantissa, 32 - exponent, 3);
  const hash = Buffer.from(parsed.id, 'hex').reverse();
  return hash.compare(target) <= 0;
}

describe('a real block header', () => {
  it('says what the block says: its id, its merkle root, its instant', () => {
    const header = parseBlockHeader(REAL);
    expect(header.id).toBe(BLOCK_800000_ID);
    expect(header.merkleRoot.toString('hex')).toBe(BLOCK_800000_MERKLE_ROOT);
    expect(header.time).toBe(BLOCK_800000_TIME);
  });

  it('carries real work', () => {
    expect(headerCarriesRealWork(parseBlockHeader(REAL))).toBe(true);
  });

  it('is refused at any length but eighty bytes', () => {
    expect(() => parseBlockHeader(REAL.subarray(0, 79))).toThrow(UnreadableHeaderError);
    expect(() => parseBlockHeader(Buffer.concat([REAL, Buffer.from([0])]))).toThrow(
      UnreadableHeaderError,
    );
  });
});

describe('a header that met its own claim and nothing more', () => {
  const merkleRoot = Buffer.alloc(32, 7);

  it('is mined here in microseconds — which is the whole problem', () => {
    const easy = mined(0x207fffff, merkleRoot);
    expect(headerCarriesItsOwnClaim(easy)).toBe(true);
  });

  it('is REFUSED, because its declared target is below the floor', () => {
    expect(headerCarriesRealWork(parseBlockHeader(mined(0x207fffff, merkleRoot)))).toBe(false);
  });

  it('is refused at every difficulty a millisecond can reach, not merely at the easiest', () => {
    // Only the top of the compact range can be mined in a test — which is exactly
    // the range a forger works in too, and the reason the floor sits far below
    // anything reachable that way.
    for (const bits of [0x207fffff, 0x1f00ffff, 0x1e7fffff]) {
      const easy = mined(bits, merkleRoot);
      expect(headerCarriesItsOwnClaim(easy)).toBe(true);
      expect(headerCarriesRealWork(parseBlockHeader(easy))).toBe(false);
    }
  });
});

describe('a header that claims more than it did', () => {
  it('is refused when its hash does not meet the target it declares', () => {
    // The real header with its nonce bent: still claims block 800000's difficulty,
    // no longer meets it.
    const bent = Buffer.from(REAL);
    bent.writeUInt32LE(0, 76);
    expect(headerCarriesRealWork(parseBlockHeader(bent))).toBe(false);
  });

  it('is refused when its declared target is not a target at all', () => {
    for (const bits of [0x00000000, 0x1d800000, 0x02008000, 0xff00ffff]) {
      const bent = Buffer.from(REAL);
      bent.writeUInt32LE(bits, 72);
      expect(headerCarriesRealWork(parseBlockHeader(bent))).toBe(false);
    }
  });
});

describe('the floor itself', () => {
  it('sits strictly between the two families of case above, so neither is vacuous', () => {
    // A bound tested only from one side can be satisfied by a rule that refuses
    // everything. Both sides are exercised — the mined headers are refused, the real
    // one is accepted — and this says WHY that is possible: the floor is harder than
    // anything this test can mine and easier than the block the vector came from, so
    // an inverted comparison reddens the accepting case and a removed one reddens
    // the refusing cases.
    const floorExponent = MINIMUM_WORK >>> 24;
    expect(floorExponent).toBeLessThan(0x1e);
    expect(floorExponent).toBeGreaterThan(parseBlockHeader(REAL).bits >>> 24);
  });
});
