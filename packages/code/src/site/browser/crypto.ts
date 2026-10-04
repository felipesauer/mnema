/**
 * The part of `node:crypto` the verifier reads with, written out so a page can hold it.
 *
 * `verifyChain` is synchronous and so is every hash and signature check in it, and the
 * browser's own cryptography (WebCrypto) is asynchronous only. Rather than rewrite the
 * verifier around promises — a second verifier is the one thing this page must not carry —
 * the page gives the SAME verifier a synchronous SHA-256, SHA-512 and Ed25519 verification
 * in plain JavaScript. They are exact and slow, and a page that checks a few hundred
 * checkpoints pays seconds for them, not minutes.
 *
 * What a page cannot do — mint a key, sign, encrypt, draw randomness — is not here: those
 * names exist so the bundle links, and each one refuses when called.
 */

import { Buffer, copyOf, fromBase64, fromHex } from './buffer.js';

type Bytes = Uint8Array;

const utf8 = new TextEncoder();

function bytesOf(data: string | Bytes): Bytes {
  return typeof data === 'string' ? utf8.encode(data) : data;
}

// --- SHA-256 -----------------------------------------------------------------------------

const K256 = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));

export function sha256(message: Bytes): Bytes {
  const length = message.length;
  const padded = new Uint8Array((((length + 9 + 63) >> 6) << 6) >>> 0);
  padded.set(message);
  padded[length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(length / 0x20000000), false);
  view.setUint32(padded.length - 4, (length << 3) >>> 0, false);
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  for (let block = 0; block < padded.length; block += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(block + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const w15 = w[i - 15] as number;
      const w2 = w[i - 2] as number;
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      w[i] = ((w[i - 16] as number) + s0 + (w[i - 7] as number) + s1) | 0;
    }
    let [a, b, c, d, e, f, g, hh] = h as unknown as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    for (let i = 0; i < 64; i++) {
      const t1 =
        (hh +
          (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) +
          ((e & f) ^ (~e & g)) +
          (K256[i] as number) +
          (w[i] as number)) |
        0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    const next = [a, b, c, d, e, f, g, hh];
    for (let i = 0; i < 8; i++) h[i] = ((h[i] as number) + (next[i] as number)) | 0;
  }
  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) outView.setUint32(i * 4, h[i] as number, false);
  return out;
}

// --- SHA-512 (only for Ed25519) -----------------------------------------------------------

const MASK64 = (1n << 64n) - 1n;

const K512 = [
  0x428a2f98d728ae22n,
  0x7137449123ef65cdn,
  0xb5c0fbcfec4d3b2fn,
  0xe9b5dba58189dbbcn,
  0x3956c25bf348b538n,
  0x59f111f1b605d019n,
  0x923f82a4af194f9bn,
  0xab1c5ed5da6d8118n,
  0xd807aa98a3030242n,
  0x12835b0145706fben,
  0x243185be4ee4b28cn,
  0x550c7dc3d5ffb4e2n,
  0x72be5d74f27b896fn,
  0x80deb1fe3b1696b1n,
  0x9bdc06a725c71235n,
  0xc19bf174cf692694n,
  0xe49b69c19ef14ad2n,
  0xefbe4786384f25e3n,
  0x0fc19dc68b8cd5b5n,
  0x240ca1cc77ac9c65n,
  0x2de92c6f592b0275n,
  0x4a7484aa6ea6e483n,
  0x5cb0a9dcbd41fbd4n,
  0x76f988da831153b5n,
  0x983e5152ee66dfabn,
  0xa831c66d2db43210n,
  0xb00327c898fb213fn,
  0xbf597fc7beef0ee4n,
  0xc6e00bf33da88fc2n,
  0xd5a79147930aa725n,
  0x06ca6351e003826fn,
  0x142929670a0e6e70n,
  0x27b70a8546d22ffcn,
  0x2e1b21385c26c926n,
  0x4d2c6dfc5ac42aedn,
  0x53380d139d95b3dfn,
  0x650a73548baf63den,
  0x766a0abb3c77b2a8n,
  0x81c2c92e47edaee6n,
  0x92722c851482353bn,
  0xa2bfe8a14cf10364n,
  0xa81a664bbc423001n,
  0xc24b8b70d0f89791n,
  0xc76c51a30654be30n,
  0xd192e819d6ef5218n,
  0xd69906245565a910n,
  0xf40e35855771202an,
  0x106aa07032bbd1b8n,
  0x19a4c116b8d2d0c8n,
  0x1e376c085141ab53n,
  0x2748774cdf8eeb99n,
  0x34b0bcb5e19b48a8n,
  0x391c0cb3c5c95a63n,
  0x4ed8aa4ae3418acbn,
  0x5b9cca4f7763e373n,
  0x682e6ff3d6b2b8a3n,
  0x748f82ee5defb2fcn,
  0x78a5636f43172f60n,
  0x84c87814a1f0ab72n,
  0x8cc702081a6439ecn,
  0x90befffa23631e28n,
  0xa4506cebde82bde9n,
  0xbef9a3f7b2c67915n,
  0xc67178f2e372532bn,
  0xca273eceea26619cn,
  0xd186b8c721c0c207n,
  0xeada7dd6cde0eb1en,
  0xf57d4f7fee6ed178n,
  0x06f067aa72176fban,
  0x0a637dc5a2c898a6n,
  0x113f9804bef90daen,
  0x1b710b35131c471bn,
  0x28db77f523047d84n,
  0x32caab7b40c72493n,
  0x3c9ebe0a15c9bebcn,
  0x431d67c49c100d4cn,
  0x4cc5d4becb3e42b6n,
  0x597f299cfc657e2an,
  0x5fcb6fab3ad6faecn,
  0x6c44198c4a475817n,
];

const rotr64 = (x: bigint, n: bigint): bigint => ((x >> n) | (x << (64n - n))) & MASK64;

export function sha512(message: Bytes): Bytes {
  const length = message.length;
  const padded = new Uint8Array(((length + 17 + 127) >> 7) << 7);
  padded.set(message);
  padded[length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 4, (length << 3) >>> 0, false);
  view.setUint32(padded.length - 8, Math.floor(length / 0x20000000), false);
  const h = [
    0x6a09e667f3bcc908n,
    0xbb67ae8584caa73bn,
    0x3c6ef372fe94f82bn,
    0xa54ff53a5f1d36f1n,
    0x510e527fade682d1n,
    0x9b05688c2b3e6c1fn,
    0x1f83d9abfb41bd6bn,
    0x5be0cd19137e2179n,
  ];
  const w = new Array<bigint>(80).fill(0n);
  for (let block = 0; block < padded.length; block += 128) {
    for (let i = 0; i < 16; i++) w[i] = view.getBigUint64(block + i * 8, false);
    for (let i = 16; i < 80; i++) {
      const w15 = w[i - 15] as bigint;
      const w2 = w[i - 2] as bigint;
      const s0 = rotr64(w15, 1n) ^ rotr64(w15, 8n) ^ (w15 >> 7n);
      const s1 = rotr64(w2, 19n) ^ rotr64(w2, 61n) ^ (w2 >> 6n);
      w[i] = ((w[i - 16] as bigint) + s0 + (w[i - 7] as bigint) + s1) & MASK64;
    }
    let [a, b, c, d, e, f, g, hh] = h as [
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
    ];
    for (let i = 0; i < 80; i++) {
      const t1 =
        (hh +
          (rotr64(e, 14n) ^ rotr64(e, 18n) ^ rotr64(e, 41n)) +
          ((e & f) ^ (~e & MASK64 & g)) +
          (K512[i] as bigint) +
          (w[i] as bigint)) &
        MASK64;
      const t2 =
        ((rotr64(a, 28n) ^ rotr64(a, 34n) ^ rotr64(a, 39n)) + ((a & b) ^ (a & c) ^ (b & c))) &
        MASK64;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) & MASK64;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) & MASK64;
    }
    const next = [a, b, c, d, e, f, g, hh];
    for (let i = 0; i < 8; i++) h[i] = ((h[i] as bigint) + (next[i] as bigint)) & MASK64;
  }
  const out = new Uint8Array(64);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) outView.setBigUint64(i * 8, h[i] as bigint, false);
  return out;
}

// --- Ed25519 verification (RFC 8032, the cofactorless equation) --------------------------

const P = (1n << 255n) - 19n;
const L = (1n << 252n) + 27742317777372353535851937790883648493n;

const mod = (a: bigint, m: bigint = P): bigint => {
  const r = a % m;
  return r >= 0n ? r : r + m;
};

function power(base: bigint, exponent: bigint, m: bigint = P): bigint {
  let result = 1n;
  let b = mod(base, m);
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return result;
}

const invert = (a: bigint): bigint => power(a, P - 2n);

const D = mod(-121665n * invert(121666n));
const SQRT_M1 = power(2n, (P - 1n) / 4n);

/** A point in extended coordinates (X, Y, Z, T), x = X/Z, y = Y/Z, xy = T/Z. */
type Point = readonly [bigint, bigint, bigint, bigint];

const IDENTITY: Point = [0n, 1n, 1n, 0n];

function add(p: Point, q: Point): Point {
  const [x1, y1, z1, t1] = p;
  const [x2, y2, z2, t2] = q;
  const a = mod((y1 - x1) * (y2 - x2));
  const b = mod((y1 + x1) * (y2 + x2));
  const c = mod(2n * D * t1 * t2);
  const d = mod(2n * z1 * z2);
  const e = b - a;
  const f = d - c;
  const g = d + c;
  const h = b + a;
  return [mod(e * f), mod(g * h), mod(f * g), mod(e * h)];
}

function multiply(point: Point, scalar: bigint): Point {
  let result = IDENTITY;
  let addend = point;
  let k = scalar;
  while (k > 0n) {
    if (k & 1n) result = add(result, addend);
    addend = add(addend, addend);
    k >>= 1n;
  }
  return result;
}

function decode(bytes: Bytes): Point | null {
  if (bytes.length !== 32) return null;
  let y = 0n;
  for (let i = 31; i >= 0; i--) y = (y << 8n) | BigInt(bytes[i] as number);
  const sign = y >> 255n;
  y &= (1n << 255n) - 1n;
  if (y >= P) return null;
  const y2 = mod(y * y);
  const u = mod(y2 - 1n);
  const v = mod(D * y2 + 1n);
  let x = mod(u * power(v, 3n) * power(u * power(v, 7n), (P - 5n) / 8n));
  const check = mod(v * x * x);
  if (check !== u) {
    if (check !== mod(-u)) return null;
    x = mod(x * SQRT_M1);
  }
  if (x === 0n && sign === 1n) return null;
  if ((x & 1n) !== sign) x = mod(-x);
  return [x, y, 1n, mod(x * y)];
}

const BASE: Point = (() => {
  const y = mod(4n * invert(5n));
  const y2 = mod(y * y);
  const u = mod(y2 - 1n);
  const v = mod(D * y2 + 1n);
  let x = mod(u * power(v, 3n) * power(u * power(v, 7n), (P - 5n) / 8n));
  if (mod(v * x * x) !== u) x = mod(x * SQRT_M1);
  if ((x & 1n) !== 0n) x = mod(-x);
  return [x, y, 1n, mod(x * y)];
})();

const same = (p: Point, q: Point): boolean =>
  mod(p[0] * q[2]) === mod(q[0] * p[2]) && mod(p[1] * q[2]) === mod(q[1] * p[2]);

function littleEndian(bytes: Bytes): bigint {
  let n = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(bytes[i] as number);
  return n;
}

/** Whether `signature` is `publicKey`'s Ed25519 signature over `message`. */
export function ed25519Verify(message: Bytes, signature: Bytes, publicKey: Bytes): boolean {
  if (signature.length !== 64 || publicKey.length !== 32) return false;
  const a = decode(publicKey);
  const r = decode(signature.subarray(0, 32));
  const s = littleEndian(signature.subarray(32));
  if (a === null || r === null || s >= L) return false;
  const hashed = new Uint8Array(64 + message.length);
  hashed.set(signature.subarray(0, 32));
  hashed.set(publicKey, 32);
  hashed.set(message, 64);
  const k = mod(littleEndian(sha512(hashed)), L);
  return same(multiply(BASE, s), add(r, multiply(a, k)));
}

// --- the names `node:crypto` is imported by ------------------------------------------------

const NOT_HERE = (name: string) => (): never => {
  throw new Error(`${name} is not available in the browser verifier — it only reads.`);
};

class Hash {
  private readonly parts: Bytes[] = [];

  update(data: string | Bytes): this {
    this.parts.push(bytesOf(data));
    return this;
  }

  digest(): Buffer;
  digest(encoding: 'hex'): string;
  digest(encoding?: 'hex'): Buffer | string {
    const total = this.parts.reduce((n, part) => n + part.length, 0);
    const all = new Uint8Array(total);
    let at = 0;
    for (const part of this.parts) {
      all.set(part, at);
      at += part.length;
    }
    const out = copyOf(sha256(all));
    return encoding === 'hex' ? out.toString('hex') : out;
  }
}

export function createHash(algorithm: string): Hash {
  if (algorithm !== 'sha256') throw new Error(`createHash(${algorithm}) is not available here`);
  return new Hash();
}

const SPKI_ED25519_PREFIX = '302a300506032b6570032100';

/** The public key as the verifier holds it: Ed25519, 32 raw bytes, exportable as DER or PEM. */
export class KeyObject {
  readonly type = 'public';
  readonly asymmetricKeyType = 'ed25519';

  constructor(readonly raw: Bytes) {}

  export(options: { type: 'spki'; format: 'der' }): Buffer;
  export(options: { type: 'spki'; format: 'pem' }): string;
  export(options: { type: 'spki'; format: 'der' | 'pem' }): Buffer | string {
    const der = Buffer.concat([fromHex(SPKI_ED25519_PREFIX), copyOf(this.raw)]);
    if (options.format === 'der') return der;
    const body = der.toString('base64').replace(/(.{64})/g, '$1\n');
    return `-----BEGIN PUBLIC KEY-----\n${body.replace(/\n$/, '')}\n-----END PUBLIC KEY-----\n`;
  }
}

export function createPublicKey(pem: string): KeyObject {
  const match = /-----BEGIN PUBLIC KEY-----([^-]+)-----END PUBLIC KEY-----/.exec(pem);
  if (match === null) throw new Error('not a PEM public key');
  const der = fromBase64((match[1] as string).replace(/\s+/g, ''));
  if (der.length !== 44 || der.toString('hex', 0, 12) !== SPKI_ED25519_PREFIX) {
    throw new Error('not an Ed25519 public key');
  }
  return new KeyObject(der.subarray(12));
}

export function verify(algorithm: null, message: Bytes, key: KeyObject, signature: Bytes): boolean {
  if (algorithm !== null) throw new Error('verify: only Ed25519 (no digest) is available here');
  return ed25519Verify(message, signature, key.raw);
}

export const createPrivateKey = NOT_HERE('createPrivateKey');
export const sign = NOT_HERE('sign');
export const generateKeyPairSync = NOT_HERE('generateKeyPairSync');
export const randomBytes = NOT_HERE('randomBytes');
export const scryptSync = NOT_HERE('scryptSync');
export const createCipheriv = NOT_HERE('createCipheriv');
export const createDecipheriv = NOT_HERE('createDecipheriv');
