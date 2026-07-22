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
 *
 * Two identities are derived from that fingerprint, of different natures:
 *   - the SIGNER FINGERPRINT is the fingerprint itself — WHICH physical key
 *     attested a fact. It rides on the envelope of every event alongside the
 *     checkpoint that also binds it, so a reader knows exactly which key signed.
 *   - the ANCHOR is a further hash of the fingerprint — WHO the key speaks for.
 *     A machine mints its anchor from its own key with no coordination, so two
 *     offline clones can never derive the same one; that uniqueness by
 *     construction is what forecloses a false identity merge at the root. Today,
 *     with one machine and one key, the anchor is the degenerate one-key set:
 *     `anchor = sha256(fingerprint)`. The two only diverge once several keys are
 *     brought under one anchor, a later concern; carrying both from the first
 *     event is what lets that happen without ever changing the event's shape.
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

/**
 * The prefix that marks an anchor id, so a reader can tell an anchor from a
 * bare fingerprint at a glance and a future scheme has a namespace to grow in.
 * Cosmetic — it carries no meaning beyond "this is a mnema identity anchor".
 */
export const ANCHOR_PREFIX = 'mnid:';

/**
 * Derives the anchor id — WHO a key speaks for — from a signer fingerprint. A
 * further SHA-256 over the fingerprint (not the fingerprint itself) so the
 * anchor is a distinct value from the physical-key identity, leaving room for
 * several keys to fold under one anchor later without the anchor ever being one
 * of their fingerprints. Deterministic: the same fingerprint always yields the
 * same anchor, and no two distinct fingerprints share one.
 */
export function deriveAnchor(signerFp: string): string {
  return ANCHOR_PREFIX + createHash('sha256').update(signerFp).digest('hex');
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
