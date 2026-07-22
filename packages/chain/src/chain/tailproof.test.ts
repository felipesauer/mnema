import { describe, expect, it } from 'vitest';
import { generateKeyPair } from './keys.js';
import {
  parseTailProof,
  serializeTailProof,
  signTailProof,
  TailProofParseError,
  verifyTailProof,
} from './tailproof.js';

describe('tail proof', () => {
  it('a proof the key signs over its own tail id verifies', () => {
    const kp = generateKeyPair();
    const tail = `${kp.fingerprint}-i1`;
    const proof = signTailProof(tail, kp);
    expect(verifyTailProof({ proof, tail, publicKey: kp.publicKey }).ok).toBe(true);
    expect(proof.signerFp).toBe(kp.fingerprint);
  });

  it('does NOT verify against a different tail id (a proof cannot be relocated)', () => {
    const kp = generateKeyPair();
    const proof = signTailProof(`${kp.fingerprint}-i1`, kp);
    const verdict = verifyTailProof({
      proof,
      tail: `${kp.fingerprint}-forged`,
      publicKey: kp.publicKey,
    });
    expect(verdict).toEqual({ ok: false, reason: 'tail-mismatch' });
  });

  it('does NOT verify against a different key (the signature binds the signer)', () => {
    const owner = generateKeyPair();
    const other = generateKeyPair();
    const tail = `${owner.fingerprint}-i1`;
    const proof = signTailProof(tail, owner);
    const verdict = verifyTailProof({ proof, tail, publicKey: other.publicKey });
    expect(verdict).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('rejects a tampered signature', () => {
    const kp = generateKeyPair();
    const tail = `${kp.fingerprint}-i1`;
    const proof = { ...signTailProof(tail, kp), sig: 'deadbeef' };
    expect(verifyTailProof({ proof, tail, publicKey: kp.publicKey }).ok).toBe(false);
  });

  it('rejects an unknown scheme', () => {
    const kp = generateKeyPair();
    const tail = `${kp.fingerprint}-i1`;
    const proof = { ...signTailProof(tail, kp), scheme: 'mnema-tail/2' };
    expect(verifyTailProof({ proof, tail, publicKey: kp.publicKey })).toEqual({
      ok: false,
      reason: 'unknown-scheme',
    });
  });

  it('round-trips through serialize/parse', () => {
    const kp = generateKeyPair();
    const tail = `${kp.fingerprint}-i1`;
    const proof = signTailProof(tail, kp);
    const parsed = parseTailProof(serializeTailProof(proof));
    expect(parsed).toEqual(proof);
    expect(verifyTailProof({ proof: parsed, tail, publicKey: kp.publicKey }).ok).toBe(true);
  });

  it('rejects malformed stored lines', () => {
    expect(() => parseTailProof('{not json')).toThrow(TailProofParseError);
    expect(() => parseTailProof('{"scheme":"mnema-tail/1"}')).toThrow(/missing string "tail"/);
    expect(() => parseTailProof('{"scheme":"other","tail":"t","signerFp":"f","sig":"a"}')).toThrow(
      /unknown tail-proof scheme/,
    );
  });
});
