/**
 * An 80-byte Bitcoin block header, and the two things it can be asked offline.
 *
 * This is the whole of what a witness costs a reader. A timestamp proof folds a
 * digest into a block's MERKLE ROOT; the header is where that root is written,
 * next to the instant the block claims and the difficulty it was mined at. So a
 * record that carries the header carries everything needed to check the
 * attestation with no network, no node, and no service — which is the only reason
 * `verify` can stay offline while gaining a layer that is, by definition, outside
 * this machine.
 *
 * TWO QUESTIONS AND NOT THREE. This module answers whether the header CARRIES WORK
 * ({@link headerCarriesRealWork}) and what it says (merkle root, instant). It does
 * NOT answer whether the header sits on the longest chain — that needs the headers
 * before it, which this record does not carry and this package will not pretend to.
 *
 * SELF-CONSISTENCY IS NOT ENOUGH AND THE FLOOR IS WHY THIS IS NOT A ONE-LINER. A
 * header declares the difficulty it was mined at, so a header checked only against
 * its OWN declaration is free to forge: declare the easiest target there is, find a
 * nonce in milliseconds, and the check passes over a block nobody mined. So the
 * declared target is held to {@link MINIMUM_WORK} as well, and that turns a
 * millisecond into the work of a real block.
 *
 * WHAT IS LEFT, said here rather than in a footnote: the floor bounds the COST of a
 * forgery, it does not prove the block is Bitcoin's. Someone with mining hardware
 * and a reason could produce a header that passes this and is on no chain at all.
 * Closing that needs the chain of headers or somebody else's copy of it — and the
 * `.ots` beside the header is exactly what makes that a five-second job for a
 * stranger, who runs the OpenTimestamps client against a node and gets the answer
 * this module deliberately does not fake.
 *
 * EVERY FIELD IS LITTLE-ENDIAN and the merkle root is in INTERNAL byte order —
 * the order it is serialized in, which is the reverse of the order an explorer
 * prints. That matters exactly once: an OpenTimestamps Bitcoin attestation folds
 * to the root in internal order, so the comparison is against these bytes as they
 * lie, never against a display form.
 */

import { createHash } from 'node:crypto';

/** A header is exactly this many bytes; anything else is not one. */
export const BLOCK_HEADER_BYTES = 80;

/**
 * The weakest block this package will accept as a witness, in the compact form a
 * header declares: `0x1800ffff`, which is 2**40 times the difficulty of the genesis
 * block.
 *
 * WHY A CONSTANT AND NOT THE CURRENT DIFFICULTY. Nothing offline knows what the
 * current difficulty is — that is a fact about a chain this record does not carry —
 * so the choice is between a fixed floor and none. A fixed floor ages in ONE
 * direction that matters: it is a refusal, so it can only ever reject a real block
 * mined below it, never accept a forged one above it.
 *
 * WHY THIS NUMBER. It is roughly 2**72 hashes for one header, which is hours of the
 * entire Bitcoin network or years of a large private one — expensive enough that a
 * forged sidecar is not a thing somebody does casually, which is what the guard is
 * for. Bitcoin passed it in 2019 and would have to fall more than a hundredfold to
 * come back under it; if it ever does, this constant is the one line to revisit, and
 * the refusal it produces is loud rather than silent.
 */
export const MINIMUM_WORK = 0x1800ffff;

const MERKLE_ROOT_AT = 36;
const TIME_AT = 68;
const BITS_AT = 72;

/** Refused bytes: not a block header, or one that does not meet its own claim. */
export class UnreadableHeaderError extends Error {
  constructor(reason: string) {
    super(`block header: ${reason}`);
    this.name = 'UnreadableHeaderError';
  }
}

/** What an 80-byte header says. */
export interface BlockHeader {
  /** The header's own bytes, kept so the record can be re-checked from them. */
  readonly bytes: Buffer;
  /** The merkle root in INTERNAL byte order — what an attestation folds to. */
  readonly merkleRoot: Buffer;
  /** The instant the block claims, in seconds since the epoch. */
  readonly time: number;
  /** The compact difficulty target the block declares. */
  readonly bits: number;
  /** The block's hash, written the way an explorer prints it (reversed). */
  readonly id: string;
}

/** Reads an 80-byte header. */
export function parseBlockHeader(bytes: Buffer): BlockHeader {
  if (bytes.length !== BLOCK_HEADER_BYTES) {
    throw new UnreadableHeaderError(`${bytes.length} bytes, not ${BLOCK_HEADER_BYTES}`);
  }
  const hash = sha256d(bytes);
  return {
    bytes: Buffer.from(bytes),
    merkleRoot: Buffer.from(bytes.subarray(MERKLE_ROOT_AT, TIME_AT)),
    time: bytes.readUInt32LE(TIME_AT),
    bits: bytes.readUInt32LE(BITS_AT),
    id: Buffer.from(hash).reverse().toString('hex'),
  };
}

/**
 * Whether the header carries real work: its own hash under its own declared target,
 * AND that target no weaker than {@link MINIMUM_WORK}.
 *
 * BOTH HALVES OR NEITHER. The first alone accepts a header mined in a millisecond at
 * a declared difficulty of nothing; the second alone accepts a header that declares a
 * hard target and never met it. The mutation that proves each is the other's absence,
 * and they redden different cases (`bitcoin.test.ts`).
 *
 * The target is unpacked from the compact `bits` field exactly as a node unpacks it,
 * and the hash is compared as a 256-bit little-endian number, which is what the hash
 * IS: the leading zeroes an explorer shows are the trailing bytes here.
 *
 * A `bits` field a header could not have carried — the sign bit set, an exponent past
 * the width of the number, a zero mantissa — is FALSE rather than an exception: it is
 * a header that fails its own claim, which is the same answer as a nonce that never
 * found one, and a caller has one thing to do about either.
 */
export function headerCarriesRealWork(header: BlockHeader): boolean {
  const target = targetOf(header.bits);
  const floor = targetOf(MINIMUM_WORK);
  if (target === null || floor === null) return false;
  // A LARGER target is an EASIER block, so the floor is an upper bound on the target.
  if (target.compare(floor) > 0) return false;
  const hash = Buffer.from(sha256d(header.bytes)).reverse();
  return hash.compare(target) <= 0;
}

/** The 256-bit target a compact `bits` field means, or null if it means none. */
function targetOf(bits: number): Buffer | null {
  const exponent = bits >>> 24;
  const mantissa = bits & 0x007fffff;
  // The sign bit of the compact form: a header that set it declares a negative
  // target, which no block can meet.
  if ((bits & 0x00800000) !== 0) return null;
  if (mantissa === 0 || exponent > 32 || exponent < 3) return null;
  const target = Buffer.alloc(32);
  // The mantissa's three bytes sit so that their LAST one is at position `exponent`,
  // counting from the big end — the compact form's definition.
  target.writeUIntBE(mantissa, 32 - exponent, 3);
  return target;
}

/** SHA-256 twice, which is how Bitcoin hashes a header. */
function sha256d(bytes: Buffer): Buffer {
  return createHash('sha256').update(createHash('sha256').update(bytes).digest()).digest();
}
