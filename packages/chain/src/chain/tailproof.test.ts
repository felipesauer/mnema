import { describe, expect, it } from 'vitest';
import { canonicalBytes } from '../events/canonical.js';
import { generateKeyPair, type KeyPair, sign } from './keys.js';
import {
  NAMED_TAILPROOF_SCHEME,
  parseTailProof,
  serializeTailProof,
  signTailProof,
  type TailProof,
  TailProofParseError,
  verifyTailProof,
} from './tailproof.js';

/** Signs a proof's fields as they stand, whatever they name: what a writer could put on disk. */
function signTailProofOver(proof: TailProof, keyPair: KeyPair): TailProof {
  const { sig: _sig, ...fields } = proof;
  const sig = Buffer.from(sign(canonicalBytes(fields), keyPair.privateKey)).toString('hex');
  return { ...fields, sig };
}

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

  it('refuses a proof another key signed naming itself, under the key the tail id names', () => {
    const owner = generateKeyPair();
    const other = generateKeyPair();
    const tail = `${owner.fingerprint}-i1`;
    const proof = signTailProof(tail, other);
    expect(verifyTailProof({ proof, tail, publicKey: owner.publicKey })).toEqual({
      ok: false,
      reason: 'signer-mismatch',
    });
  });

  it('refuses a proof the tail key signed that names another key as its signer', () => {
    const owner = generateKeyPair();
    const other = generateKeyPair();
    const tail = `${owner.fingerprint}-i1`;
    const proof = {
      ...signTailProof(tail, owner),
      signerFp: other.fingerprint,
    };
    // Re-signed by the owner over the message that names the other key, so the signature
    // itself holds under the tail's key: only the claim is wrong.
    const resigned = signTailProofOver(proof, owner);
    expect(verifyTailProof({ proof: resigned, tail, publicKey: owner.publicKey })).toEqual({
      ok: false,
      reason: 'signer-mismatch',
    });
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
    const proof = { ...signTailProof(tail, kp), scheme: 'mnema-tail/3' };
    expect(verifyTailProof({ proof, tail, publicKey: kp.publicKey })).toEqual({
      ok: false,
      reason: 'unknown-scheme',
    });
  });

  it('signs, round-trips and verifies a proof that names its record', () => {
    const kp = generateKeyPair();
    const tail = `${kp.fingerprint}-i1`;
    const record = 'ab'.repeat(32);
    const proof = signTailProof(tail, kp, record);
    expect(proof.scheme).toBe(NAMED_TAILPROOF_SCHEME);
    const parsed = parseTailProof(serializeTailProof(proof));
    expect(parsed).toEqual(proof);
    expect(verifyTailProof({ proof: parsed, tail, publicKey: kp.publicKey }).ok).toBe(true);
    // The name is signed: the same signature over another name fails.
    expect(
      verifyTailProof({
        proof: { ...parsed, record: 'cd'.repeat(32) },
        tail,
        publicKey: kp.publicKey,
      }),
    ).toEqual({ ok: false, reason: 'bad-signature' });
    expect(() =>
      parseTailProof(serializeTailProof(proof).replace(NAMED_TAILPROOF_SCHEME, 'mnema-tail/1')),
    ).toThrow("tail-proof keys are ['record', 'scheme', 'sig', 'signerFp', 'tail']");
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
    expect(() => parseTailProof('[]')).toThrow('a tail proof that is not a JSON object');
    // A key missing is said as the second reader says it: the keys found, and the keys a proof has.
    expect(() => parseTailProof('{"scheme":"mnema-tail/1"}')).toThrow(
      "tail-proof keys are ['scheme'], not ['scheme', 'sig', 'signerFp', 'tail']",
    );
    expect(() =>
      parseTailProof('{"scheme":"mnema-tail/1","sig":1,"signerFp":"f","tail":"t"}'),
    ).toThrow(/missing string "sig"/);
    expect(() => parseTailProof('{"scheme":"other","sig":"a","signerFp":"f","tail":"t"}')).toThrow(
      "a tail-proof scheme this reader does not know: 'other'",
    );
  });
});
