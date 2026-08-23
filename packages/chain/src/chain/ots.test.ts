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
