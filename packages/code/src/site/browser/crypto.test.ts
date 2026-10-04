/**
 * The page's SHA-256 and Ed25519 against Node's own, over inputs Node produced.
 *
 * The verdict test proves the two agree on real records; this pins WHY they do — block
 * boundaries of the hash, and a signature that is altered anywhere, or whose scalar is out of
 * range, being refused — so a break in the arithmetic is named here and not found as a verdict
 * that differs.
 */

import {
  createHash,
  generateKeyPairSync,
  createPublicKey as nodePublicKey,
  sign,
} from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createPublicKey,
  ed25519Verify,
  createHash as pageHash,
  randomBytes,
  sha256,
  verify,
} from './crypto.js';

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

describe('the page SHA-256', () => {
  it('gives what Node gives at every padding boundary', () => {
    for (const length of [0, 1, 3, 55, 56, 57, 63, 64, 65, 119, 120, 128, 1000, 70000]) {
      const message = Uint8Array.from({ length }, (_, i) => (i * 31 + 7) % 256);
      expect(hex(sha256(message)), `length ${length}`).toBe(
        createHash('sha256').update(message).digest('hex'),
      );
    }
  });

  it('hashes what is fed to it in pieces as one message, strings as UTF-8', () => {
    expect(pageHash('sha256').update('mnid:').update('é').digest('hex')).toBe(
      createHash('sha256').update('mnid:é').digest('hex'),
    );
    expect(() => pageHash('md5')).toThrow(/not available/);
  });
});

describe('the page Ed25519', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const message = new TextEncoder().encode('a checkpoint, as the chain signs it');
  const signature = sign(null, message, privateKey);
  const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

  it('accepts what Node signed, through the PEM the record commits', () => {
    expect(verify(null, message, createPublicKey(pem), signature)).toBe(true);
    expect(createPublicKey(pem).export({ type: 'spki', format: 'pem' })).toBe(pem);
    expect(hex(createPublicKey(pem).export({ type: 'spki', format: 'der' }))).toBe(
      nodePublicKey(pem).export({ type: 'spki', format: 'der' }).toString('hex'),
    );
  });

  it('refuses a message, a signature byte or a key that is not the signed one', () => {
    const raw = createPublicKey(pem).raw;
    expect(ed25519Verify(message, signature, raw)).toBe(true);
    expect(ed25519Verify(new TextEncoder().encode('another message'), signature, raw)).toBe(false);
    for (const at of [0, 31, 32, 63]) {
      const altered = Uint8Array.from(signature);
      altered[at] = (altered[at] as number) ^ 1;
      expect(ed25519Verify(message, altered, raw), `byte ${at}`).toBe(false);
    }
    const other = generateKeyPairSync('ed25519').publicKey;
    expect(
      ed25519Verify(
        message,
        signature,
        createPublicKey(other.export({ type: 'spki', format: 'pem' }).toString()).raw,
      ),
    ).toBe(false);
  });

  it('refuses a scalar that is not below the group order, and a signature of the wrong length', () => {
    const raw = createPublicKey(pem).raw;
    const unreduced = Uint8Array.from(signature);
    unreduced.fill(0xff, 32);
    expect(ed25519Verify(message, unreduced, raw)).toBe(false);
    expect(ed25519Verify(message, signature.subarray(0, 63), raw)).toBe(false);
  });

  it('refuses text that is not an Ed25519 public key, and cannot do what a page may not', () => {
    expect(() => createPublicKey('not a key')).toThrow(/PEM/);
    const rsaLike = pem.replace('MCowBQYDK2VwAyEA', 'MCowBQYDK2VxAyEA');
    expect(() => createPublicKey(rsaLike)).toThrow(/Ed25519/);
    expect(() => randomBytes()).toThrow(/only reads/);
  });
});
