/**
 * Ed25519 key material — the only cryptographic material in mnema.
 *
 * A machine signs its own checkpoints with a private key that stays local and
 * is never committed. Its public key travels with the chain (committed, named
 * by fingerprint) so anyone — a collaborator, an anonymous clone — can verify a
 * checkpoint offline without any secret. Reinstalling a machine generates a
 * fresh pair; checkpoints signed by the old key stay verifiable against the old
 * public key. There is no shared secret to distribute or re-provision.
 *
 * The fingerprint is the SHA-256 of the raw public key, in full. The full
 * fingerprint — not a short prefix — is bound into every signed checkpoint, so
 * a signature cannot be re-pointed at a different key while looking valid.
 */

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as edSign,
  verify as edVerify,
  generateKeyPairSync,
  type KeyObject,
} from 'node:crypto';

export type { KeyObject };

/** A machine's signing identity. */
export interface KeyPair {
  readonly privateKey: KeyObject;
  readonly publicKey: KeyObject;
  /** Full SHA-256 hex of the raw public key. */
  readonly fingerprint: string;
}

/** Generates a fresh Ed25519 key pair with its fingerprint. */
export function generateKeyPair(): KeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return { privateKey, publicKey, fingerprint: fingerprintOf(publicKey) };
}

/** The full fingerprint of a public key: SHA-256 hex of its raw bytes. */
export function fingerprintOf(publicKey: KeyObject): string {
  const raw = publicKey.export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(raw).digest('hex');
}

/** Serializes a public key to PEM text (what gets committed). */
export function publicKeyToPem(publicKey: KeyObject): string {
  return publicKey.export({ type: 'spki', format: 'pem' }).toString();
}

/** Serializes a private key to PEM text (what stays local, never committed). */
export function privateKeyToPem(privateKey: KeyObject): string {
  return privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
}

/** Reconstructs a public key from committed PEM text. */
export function publicKeyFromPem(pem: string): KeyObject {
  return createPublicKey(pem);
}

/** Reconstructs a private key from local PEM text. */
export function privateKeyFromPem(pem: string): KeyObject {
  return createPrivateKey(pem);
}

/** Signs a message with an Ed25519 private key. */
export function sign(message: Uint8Array, privateKey: KeyObject): Uint8Array {
  // Ed25519 takes a null algorithm (the algorithm is implied by the key).
  return edSign(null, message, privateKey);
}

/** Verifies an Ed25519 signature against a public key. */
export function verify(message: Uint8Array, signature: Uint8Array, publicKey: KeyObject): boolean {
  return edVerify(null, message, publicKey, signature);
}
