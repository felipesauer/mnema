/**
 * The OpenTimestamps format, read against bytes this package did not write.
 *
 * The one test that matters here is the round trip over a REAL calendar answer:
 * a reader and a writer of the same author agree with each other for free, and what
 * has to be true is that they agree with the format. So the vector is captured
 * (witness-vectors.ts), the parse is asserted against what the calendars actually
 * said, and the re-serialization is asserted BYTE FOR BYTE — which is the only form
 * of "we understood every byte" that cannot be satisfied by understanding most of
 * them.
 */

import { describe, expect, it } from 'vitest';

import {
  applyOtsOp,
  MAX_PROOF_BYTES,
  parseOtsProof,
  reachedAttestations,
  serializeOtsProof,
  sha256,
  UnreadableProofError,
} from './ots.js';
import {
  PENDING_PROOF_BASE64,
  PENDING_PROOF_CALENDARS,
  PENDING_PROOF_DIGEST,
} from './witness-vectors.js';

const REAL = Buffer.from(PENDING_PROOF_BASE64, 'base64');

describe('a detached OpenTimestamps proof', () => {
  it('reads a real calendar answer: the digest it commits to, and nothing else', () => {
    const proof = parseOtsProof(REAL);
    expect(proof.version).toBe(1);
    expect(proof.digest.toString('hex')).toBe(PENDING_PROOF_DIGEST);
  });

  it('re-serializes it byte for byte, which is what "read every byte" means', () => {
    const proof = parseOtsProof(REAL);
    expect(serializeOtsProof(proof.digest, proof.timestamp).equals(REAL)).toBe(true);
  });

  it('reaches one promise per calendar and no block yet', () => {
    const reached = reachedAttestations(parseOtsProof(REAL));
    expect(reached.map((r) => r.attestation)).toEqual(
      PENDING_PROOF_CALENDARS.map((uri) => ({ kind: 'pending', uri })),
    );
  });

  it('folds the digest through the path, so the message at each promise is derived', () => {
    // The first step of every calendar's path is ours: append a per-calendar nonce
    // and hash. The message the promise stands at is therefore NOT the digest — if
    // it were, every calendar would have been handed the same value.
    const reached = reachedAttestations(parseOtsProof(REAL));
    const messages = reached.map((r) => r.message.toString('hex'));
    expect(new Set(messages).size).toBe(reached.length);
    expect(messages).not.toContain(PENDING_PROOF_DIGEST);
  });

  it('refuses bytes that are not a proof rather than guessing at them', () => {
    expect(() => parseOtsProof(Buffer.from('not a proof at all, really'))).toThrow(
      UnreadableProofError,
    );
  });

  it('refuses a proof over a hash it does not know how to be about', () => {
    const bent = Buffer.from(REAL);
    // The byte after the version is the hash-op tag; 0x02 is SHA-1.
    bent[32] = 0x02;
    expect(() => parseOtsProof(bent)).toThrow(/not over a SHA-256 digest/);
  });

  it('refuses a truncated proof instead of reporting what it managed to read', () => {
    expect(() => parseOtsProof(REAL.subarray(0, REAL.length - 10))).toThrow(/ran off the end/);
  });

  it('refuses a version newer than this reader', () => {
    const bent = Buffer.from(REAL);
    bent[31] = 9;
    expect(() => parseOtsProof(bent)).toThrow(/newer than this reader/);
  });
});

describe('the operations a path is made of', () => {
  it('applies each one the way the format defines it', () => {
    const message = Buffer.from('abc', 'utf-8');
    expect(applyOtsOp({ op: 'append', arg: Buffer.from('!') }, message).toString()).toBe('abc!');
    expect(applyOtsOp({ op: 'prepend', arg: Buffer.from('!') }, message).toString()).toBe('!abc');
    expect(applyOtsOp({ op: 'reverse' }, message).toString()).toBe('cba');
    expect(applyOtsOp({ op: 'hexlify' }, message).toString()).toBe('616263');
    expect(applyOtsOp({ op: 'sha256' }, message).equals(sha256(message))).toBe(true);
  });

  it('does not mutate the message it is handed', () => {
    const message = Buffer.from('abc', 'utf-8');
    applyOtsOp({ op: 'reverse' }, message);
    expect(message.toString()).toBe('abc');
  });
});

describe('what a hostile clone can put in a tree', () => {
  /**
   * A proof is COMMITTED, so a clone reads whatever the last person to write the
   * repository put there. Depth costs one byte in this grammar — every `0x08` is
   * another `sha256` step — so these are built by hand rather than through the writer,
   * which is the only way to reach a depth the writer itself could not produce.
   */
  const deep = (steps: number): Buffer =>
    Buffer.concat([
      Buffer.from('004f70656e54696d657374616d7073000050726f6f6600bf89e2e884e89294', 'hex'),
      Buffer.from([1, 0x08]),
      Buffer.alloc(32),
      Buffer.alloc(steps, 0x08),
      // `0x00` then a pending attestation over a one-byte URI: something to end at.
      Buffer.from('0083dfe30d2ef90c8e020178', 'hex'),
    ]);

  it('reads a path as deep as anything real will ever be', () => {
    // Nine hundred, against the eight or nine steps a calendar's answer really has.
    expect(reachedAttestations(parseOtsProof(deep(900)))).toHaveLength(1);
  });

  it('refuses a deeper one BY NAME, before the stack has an opinion', () => {
    // MEASURED ON THE SHIPPED READER, before this limit: a 30 KB file of nothing but
    // that byte took the parse past V8's stack, and what reached the verdict was
    // `unreadable: Maximum call stack size exceeded` — survivable only because the
    // catch around it happens to be untyped. Depth is a property of the FORMAT.
    expect(() => parseOtsProof(deep(1001))).toThrow(UnreadableProofError);
    expect(() => parseOtsProof(deep(30_000))).toThrow(/deeper than 1000 steps/);
  });

  it('refuses a path that INFLATES its message instead of folding it', () => {
    // A small file can still be expensive: every `append` copies, so a thousand of
    // them with a kilobyte each is quadratic. Measured on the reader before this
    // limit: a 979 KiB file walked in 238 ms and ended holding a megabyte — which can
    // attest nothing, a merkle root being 32 bytes, so the work was pure waste.
    const step = Buffer.concat([
      Buffer.from([0xf0]), // append
      Buffer.from([0xe8, 0x07]), // of 1000 bytes
      Buffer.alloc(1000, 0x41),
    ]);
    const inflating = Buffer.concat([
      Buffer.from('004f70656e54696d657374616d7073000050726f6f6600bf89e2e884e89294', 'hex'),
      Buffer.from([1, 0x08]),
      Buffer.alloc(32),
      Buffer.concat(Array.from({ length: 900 }, () => step)),
      Buffer.from('0083dfe30d2ef90c8e020178', 'hex'),
    ]);
    // It PARSES — depth and size are both inside their limits, which is what makes
    // this a third question rather than a corollary of the first two.
    const parsed = parseOtsProof(inflating);
    expect(() => reachedAttestations(parsed)).toThrow(/past what a path folds/);
  });

  it('refuses a file past the size any proof has', () => {
    expect(() => parseOtsProof(Buffer.alloc(MAX_PROOF_BYTES + 1))).toThrow(
      /past the \d+ this reads/,
    );
  });
});

describe('the rule that ends a node', () => {
  /**
   * THE BUG THIS CASE EXISTS FOR. The format separates a node's members with `0xff`
   * and leaves the LAST one unprefixed, so the first member that arrives without a
   * separator closes the node. A reader that treats every attestation byte (`0x00`)
   * as "another member follows" reads past its own node and into the bytes of the
   * one above it — measured, and it reported every real calendar answer as
   * truncated. A node with an attestation AND a step after it is the shape that
   * tells the two readings apart.
   */
  it('writes a node whose last member is an attestation, and reads it back', () => {
    const digest = sha256(Buffer.from('a checkpoint'));
    const proof = {
      attestations: [],
      steps: [
        {
          op: 'append' as const,
          arg: Buffer.from('nonce'),
          next: {
            attestations: [{ kind: 'pending' as const, uri: 'https://example.invalid' }],
            steps: [],
          },
        },
      ],
    };
    const bytes = serializeOtsProof(digest, proof);
    const back = parseOtsProof(bytes);
    expect(serializeOtsProof(back.digest, back.timestamp).equals(bytes)).toBe(true);
    expect(reachedAttestations(back).map((r) => r.attestation)).toEqual([
      { kind: 'pending', uri: 'https://example.invalid' },
    ]);
  });

  it('writes a node carrying BOTH an attestation and a step, and reads both back', () => {
    const digest = sha256(Buffer.from('a checkpoint'));
    const proof = {
      attestations: [{ kind: 'bitcoin' as const, height: 800000 }],
      steps: [
        {
          op: 'sha256' as const,
          next: {
            attestations: [{ kind: 'pending' as const, uri: 'https://example.invalid' }],
            steps: [],
          },
        },
      ],
    };
    const bytes = serializeOtsProof(digest, proof);
    const reached = reachedAttestations(parseOtsProof(bytes));
    expect(reached.map((r) => r.attestation.kind)).toEqual(['bitcoin', 'pending']);
    // The block attestation stands at the digest; the promise stands one hash later.
    expect(reached[0]?.message.equals(digest)).toBe(true);
    expect(reached[1]?.message.equals(sha256(digest))).toBe(true);
  });
});
