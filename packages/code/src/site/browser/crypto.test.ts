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
  sha512,
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

/**
 * FIPS 180-4's own example messages, with the digests the standard prints (the NIST CAVP
 * "SHA examples": one block, two blocks, the empty message, a million 'a'). The cases above
 * hold the page to Node; these hold it to a source that is neither Node nor this file, so a
 * hash that drifted together with Node's would still be named.
 */
const ascii = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('the page SHA-256 against FIPS 180-4', () => {
  const vectors: readonly (readonly [string, Uint8Array, string])[] = [
    [
      'the empty message',
      new Uint8Array(0),
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    ],
    [
      '"abc", one block',
      ascii('abc'),
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    ],
    [
      'the 448-bit message, whose padding needs a second block',
      ascii('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    ],
    [
      'a million "a"',
      new Uint8Array(1_000_000).fill(0x61),
      'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
    ],
  ];

  it.each(vectors)('prints the standard digest of %s', (_name, message, digest) => {
    expect(hex(sha256(message))).toBe(digest);
  });
});

/**
 * The million-"a" vector is the slow case. Against the shared 5 s, on a machine kept at a load
 * average of 50 to 100 (48 busy loops on 16 cores, two workers) it took 6.8 to 12.2 s and
 * stopped at five seconds in six runs of six, while the SHA-256 of the same message took 0.1 to
 * 0.6 s. The vector is the point, so the limit is given room for a machine several times slower
 * than that one, not removed.
 */
const SHA512_MILLION_A = 30_000;

describe('the page SHA-512 against FIPS 180-4', () => {
  const vectors: readonly (readonly [string, Uint8Array, string])[] = [
    [
      'the empty message',
      new Uint8Array(0),
      'cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e',
    ],
    [
      '"abc", one block',
      ascii('abc'),
      'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
    ],
    [
      'the 896-bit message, whose padding needs a second block',
      ascii(
        'abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu',
      ),
      '8e959b75dae313da8cf4f72814fc143f8f7779c6eb9f7fa17299aeadb6889018501d289e4900f7e4331b99dec4b5433ac7d329eeb6dd26545e96e55b874be909',
    ],
    [
      'a million "a"',
      new Uint8Array(1_000_000).fill(0x61),
      'e718483d0ce769644e2e42c7bc15b4638e1f98b13b2044285632a803afa973ebde0ff244877ea60a4cb0432ce577c31beb009c5c2c49aa2e4eadb217ad8cc09b',
    ],
  ];

  it.each(vectors)(
    'prints the standard digest of %s',
    { timeout: SHA512_MILLION_A },
    (_name, message, digest) => {
      expect(hex(sha512(message))).toBe(digest);
    },
  );
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
