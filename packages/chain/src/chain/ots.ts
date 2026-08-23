/**
 * The OpenTimestamps proof format, read and written here rather than depended on.
 *
 * A timestamp proof is a MERKLE PATH: it starts at a digest, applies a run of
 * operations (append these bytes, hash the result), and ends at an ATTESTATION —
 * either a calendar server's promise that it is working on it, or a Bitcoin block
 * header's merkle root. Nothing in it is a claim by a server: the path either
 * folds to the root of a block that was actually mined, or it does not, and both
 * halves of that are arithmetic anyone can redo.
 *
 * IT IS PARSED HERE, IN THE ZERO-DEPENDENCY ENGINE, and that is the whole reason
 * the format was chosen over a service. A proof that needed a library to read
 * would move the trust rather than remove it: the library would be the thing
 * whose absence tomorrow makes yesterday's proof unreadable. The bytes are a few
 * hundred, the grammar is six operations and two attestations, and the file this
 * package writes is the ecosystem's own — a stranger runs `ots verify` on it and
 * gets the same answer without this product installed.
 *
 * WHAT THE FORMAT IS, in the order the bytes come:
 *
 *   <magic 31 bytes> <version varuint> <0x08> <32-byte sha256 digest> <timestamp>
 *
 * and a `timestamp` is a node of a tree: a set of attestations, and a set of
 * operations each leading to another node. `0xff` separates the members; `0x00`
 * introduces an attestation; anything else is an operation tag. The LAST member
 * of a node carries no `0xff` in front of it, which is what ends the node — so a
 * parser that treats every `0x00` as "another attestation follows" reads past the
 * end of its node and into the next one's bytes. (Measured: it reported every
 * calendar response as truncated.)
 *
 * NO OPERATION HERE TOUCHES THE RECORD. The only thing a proof of this package's
 * ever commits to is the SHA-256 of a checkpoint's signed message — see
 * witness.ts — so nothing that travels can be read back into an event, a title or
 * an id.
 */

import { createHash } from 'node:crypto';

/**
 * The 31 bytes every detached proof begins with.
 *
 * Written out rather than computed, because it is a constant of somebody else's
 * format: a file that does not start with exactly these is not a proof this
 * reader may guess at.
 */
const MAGIC = Buffer.from('004f70656e54696d657374616d7073000050726f6f6600bf89e2e884e89294', 'hex');

/** The version this reader writes and the highest it accepts. */
const MAJOR_VERSION = 1;

/** The op tag that says the proof's subject is a SHA-256 digest. */
const SHA256_TAG = 0x08;

/** The 8-byte tag of a calendar's "I am working on it" attestation. */
const PENDING_TAG = Buffer.from('83dfe30d2ef90c8e', 'hex');

/** The 8-byte tag of a Bitcoin block header attestation. */
const BITCOIN_TAG = Buffer.from('0588960d73d71901', 'hex');

/** A byte the format spends on structure rather than on content. */
const ATTESTATION = 0x00;
const SEPARATOR = 0xff;

/** Refused bytes: the file is not a proof this reader can account for. */
export class UnreadableProofError extends Error {
  constructor(reason: string) {
    super(`opentimestamps: ${reason}`);
    this.name = 'UnreadableProofError';
  }
}

/** One step of the path — what it does to the message it is handed. */
export type OtsOp =
  | { readonly op: 'append' | 'prepend'; readonly arg: Buffer }
  | { readonly op: 'sha1' | 'ripemd160' | 'sha256' | 'keccak256' | 'reverse' | 'hexlify' };

/** Where a path ENDS: a promise, a block, or a tag this reader does not know. */
export type OtsAttestation =
  | { readonly kind: 'pending'; readonly uri: string }
  | { readonly kind: 'bitcoin'; readonly height: number }
  | { readonly kind: 'unknown'; readonly tag: string; readonly payload: Buffer };

/** A node of the proof tree: what ends here, and what continues from here. */
export interface OtsTimestamp {
  readonly attestations: readonly OtsAttestation[];
  readonly steps: readonly (OtsOp & { readonly next: OtsTimestamp })[];
}

/** A detached proof: the digest it is about, and the tree over it. */
export interface OtsProof {
  readonly version: number;
  /** The 32 bytes the whole proof commits to. */
  readonly digest: Buffer;
  readonly timestamp: OtsTimestamp;
}

/**
 * An attestation with the message it attests — the pair a verifier needs.
 *
 * The attestation alone says "block 900123"; what makes it a proof is the MESSAGE
 * the path folded to by the time it got there, which for a Bitcoin attestation is
 * the block's merkle root. Walking is the only way to learn it, so the walk hands
 * both back together and no caller has to redo the fold.
 */
export interface ReachedAttestation {
  readonly attestation: OtsAttestation;
  /** What the path had folded the digest to when it reached this attestation. */
  readonly message: Buffer;
}

// ---------------------------------------------------------------------------
// reading

/** A cursor over the bytes, which refuses rather than reading off the end. */
class Cursor {
  private at = 0;
  constructor(private readonly bytes: Buffer) {}

  byte(): number {
    if (this.at >= this.bytes.length) throw new UnreadableProofError('ran off the end');
    return this.bytes[this.at++] as number;
  }

  /** Puts back the byte just read — the format's tags are read then dispatched on. */
  back(): void {
    this.at -= 1;
  }

  take(count: number): Buffer {
    if (this.at + count > this.bytes.length) throw new UnreadableProofError('ran off the end');
    const out = this.bytes.subarray(this.at, this.at + count);
    this.at += count;
    return Buffer.from(out);
  }

  /** The format's variable-length unsigned integer: seven bits a byte, low first. */
  varuint(): number {
    let value = 0;
    let shift = 0;
    for (;;) {
      const byte = this.byte();
      value += (byte & 0x7f) * 2 ** shift;
      if ((byte & 0x80) === 0) return value;
      shift += 7;
      if (shift > 56) throw new UnreadableProofError('a length that does not fit a number');
    }
  }

  varbytes(): Buffer {
    return this.take(this.varuint());
  }
}

const UNARY_OPS: Readonly<Record<number, Extract<OtsOp, { op: string }>['op']>> = {
  2: 'sha1',
  3: 'ripemd160',
  8: 'sha256',
  103: 'keccak256',
  242: 'reverse',
  243: 'hexlify',
};

const OP_TAGS: Readonly<Record<string, number>> = {
  sha1: 0x02,
  ripemd160: 0x03,
  sha256: 0x08,
  keccak256: 0x67,
  append: 0xf0,
  prepend: 0xf1,
  reverse: 0xf2,
  hexlify: 0xf3,
};

function readOp(cursor: Cursor): OtsOp {
  const tag = cursor.byte();
  if (tag === 0xf0) return { op: 'append', arg: cursor.varbytes() };
  if (tag === 0xf1) return { op: 'prepend', arg: cursor.varbytes() };
  const unary = UNARY_OPS[tag];
  if (unary === undefined) {
    throw new UnreadableProofError(`unknown operation 0x${tag.toString(16).padStart(2, '0')}`);
  }
  return { op: unary } as OtsOp;
}

function readAttestation(cursor: Cursor): OtsAttestation {
  const tag = cursor.take(8);
  const payload = cursor.varbytes();
  const inside = new Cursor(payload);
  if (tag.equals(PENDING_TAG)) return { kind: 'pending', uri: inside.varbytes().toString('utf-8') };
  if (tag.equals(BITCOIN_TAG)) return { kind: 'bitcoin', height: inside.varuint() };
  // A tag this reader does not know is KEPT WHOLE, never dropped: re-serializing a
  // proof without it would quietly weaken somebody else's file, and the format
  // length-prefixes every attestation for exactly this reason.
  return { kind: 'unknown', tag: tag.toString('hex'), payload };
}

function readTimestamp(cursor: Cursor): OtsTimestamp {
  const attestations: OtsAttestation[] = [];
  const steps: (OtsOp & { next: OtsTimestamp })[] = [];
  const member = (tag: number): void => {
    if (tag === ATTESTATION) {
      attestations.push(readAttestation(cursor));
      return;
    }
    cursor.back();
    const op = readOp(cursor);
    steps.push({ ...op, next: readTimestamp(cursor) } as OtsOp & { next: OtsTimestamp });
  };
  // Members are separated by `0xff` and the LAST one is not preceded by it, so the
  // first byte that is not a separator closes this node.
  let tag = cursor.byte();
  while (tag === SEPARATOR) {
    member(cursor.byte());
    tag = cursor.byte();
  }
  member(tag);
  return { attestations, steps };
}

/**
 * Reads a BARE timestamp — the grammar without the file header around it.
 *
 * A calendar answers with exactly this: the node over the commitment it was handed,
 * with no magic, no version and no digest, because the caller already knows what it
 * asked about. It is the same reader {@link parseOtsProof} uses, exposed rather than
 * copied, so the wire form and the file form can never come to be read by two
 * grammars that disagree.
 */
export function parseOtsTimestamp(bytes: Buffer): OtsTimestamp {
  return readTimestamp(new Cursor(bytes));
}

/** Reads a detached proof, refusing anything this reader cannot account for. */
export function parseOtsProof(bytes: Buffer): OtsProof {
  const cursor = new Cursor(bytes);
  if (!cursor.take(MAGIC.length).equals(MAGIC)) {
    throw new UnreadableProofError('not an OpenTimestamps proof');
  }
  const version = cursor.varuint();
  if (version > MAJOR_VERSION) {
    throw new UnreadableProofError(`version ${version} is newer than this reader`);
  }
  if (cursor.byte() !== SHA256_TAG) {
    throw new UnreadableProofError('the proof is not over a SHA-256 digest');
  }
  const digest = cursor.take(32);
  return { version, digest, timestamp: readTimestamp(cursor) };
}

// ---------------------------------------------------------------------------
// writing

function varuint(value: number): Buffer {
  const out: number[] = [];
  let left = value;
  for (;;) {
    const byte = left % 128;
    left = Math.floor(left / 128);
    out.push(left > 0 ? byte | 0x80 : byte);
    if (left === 0) return Buffer.from(out);
  }
}

function varbytes(bytes: Buffer): Buffer {
  return Buffer.concat([varuint(bytes.length), bytes]);
}

function writeOp(op: OtsOp): Buffer {
  const tag = Buffer.from([OP_TAGS[op.op] as number]);
  return 'arg' in op ? Buffer.concat([tag, varbytes(op.arg)]) : tag;
}

function writeAttestation(attestation: OtsAttestation): Buffer {
  if (attestation.kind === 'pending') {
    return Buffer.concat([PENDING_TAG, varbytes(varbytes(Buffer.from(attestation.uri, 'utf-8')))]);
  }
  if (attestation.kind === 'bitcoin') {
    return Buffer.concat([BITCOIN_TAG, varbytes(varuint(attestation.height))]);
  }
  return Buffer.concat([Buffer.from(attestation.tag, 'hex'), varbytes(attestation.payload)]);
}

function writeTimestamp(node: OtsTimestamp): Buffer {
  const parts: Buffer[] = [];
  const members: Buffer[] = [
    ...node.attestations.map((a) =>
      Buffer.concat([Buffer.from([ATTESTATION]), writeAttestation(a)]),
    ),
    ...node.steps.map((step) => Buffer.concat([writeOp(step), writeTimestamp(step.next)])),
  ];
  if (members.length === 0) throw new UnreadableProofError('a node with nothing in it');
  for (const member of members.slice(0, -1)) parts.push(Buffer.from([SEPARATOR]), member);
  parts.push(members[members.length - 1] as Buffer);
  return Buffer.concat(parts);
}

/**
 * Writes a BARE timestamp — the wire form, without the file header.
 *
 * The mirror of {@link parseOtsTimestamp}, and exported for the same reason: it is
 * what a calendar's answer looks like, so anything that has to produce one produces
 * it through the writer the reader is paired with.
 */
export function serializeOtsTimestamp(timestamp: OtsTimestamp): Buffer {
  return writeTimestamp(timestamp);
}

/** Writes a detached proof — the bytes an `.ots` file holds. */
export function serializeOtsProof(digest: Buffer, timestamp: OtsTimestamp): Buffer {
  return Buffer.concat([
    MAGIC,
    varuint(MAJOR_VERSION),
    Buffer.from([SHA256_TAG]),
    digest,
    writeTimestamp(timestamp),
  ]);
}

// ---------------------------------------------------------------------------
// walking

/**
 * Applies one step to a message.
 *
 * `ripemd160` is the one that can be UNAVAILABLE rather than wrong: OpenSSL 3
 * moved it behind the legacy provider, so a node built without it cannot run this
 * step. That is refused, never skipped — a path with a step nobody ran folds to
 * the wrong message, and a wrong message compared against a merkle root would
 * simply not match, which reads as a broken proof rather than as a machine that
 * cannot check this one.
 */
export function applyOtsOp(op: OtsOp, message: Buffer): Buffer {
  switch (op.op) {
    case 'append':
      return Buffer.concat([message, op.arg]);
    case 'prepend':
      return Buffer.concat([op.arg, message]);
    case 'reverse':
      return Buffer.from(message).reverse();
    case 'hexlify':
      return Buffer.from(message.toString('hex'), 'ascii');
    default:
      try {
        return createHash(op.op).update(message).digest();
      } catch {
        throw new UnreadableProofError(`this machine cannot compute ${op.op}`);
      }
  }
}

/**
 * Every attestation the proof reaches, each with the message the path folded to.
 *
 * The walk is TOTAL over the tree — a proof carries one path per calendar, and any
 * one of them reaching a block is enough — and it is where the digest actually
 * enters the arithmetic: nothing below this function ever sees the digest again,
 * so an attestation reported here is one this proof genuinely commits to.
 */
export function reachedAttestations(proof: OtsProof): readonly ReachedAttestation[] {
  const out: ReachedAttestation[] = [];
  const walk = (node: OtsTimestamp, message: Buffer): void => {
    for (const attestation of node.attestations) out.push({ attestation, message });
    for (const step of node.steps) walk(step.next, applyOtsOp(step, message));
  };
  walk(proof.timestamp, proof.digest);
  return out;
}

/** The SHA-256 of some bytes — the one hash this module's callers commit to. */
export function sha256(bytes: Buffer): Buffer {
  return createHash('sha256').update(bytes).digest();
}
