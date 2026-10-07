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
 * The fingerprint is the SHA-256 of the key's SubjectPublicKeyInfo — its DER
 * `spki` encoding, the twelve-byte RFC 8410 prefix included — in full. This
 * used to read "the SHA-256 of the raw public key", which is FALSE and is the
 * one thing about the derivation the repository said out loud: the raw 32-byte
 * key is precisely what it is not a hash of. What falsified it was an
 * independent verifier written from `FORMAT.md`, which had to try four
 * candidate derivations against the two fingerprints in the frozen records to
 * find out which one closes (`verifier/mnemaverify/keys.py`, gap G03). The full
 * fingerprint — not a short prefix — is bound into every signed checkpoint, so
 * a signature cannot be re-pointed at a different key while looking valid; that
 * clause is only CHECKABLE by a party who can recompute it, which is why the
 * derivation is now written here and in `FORMAT.md` section 6.
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

/**
 * The half of a key a CHAIN ever carries: the public key and its fingerprint.
 * Materializing a key into a chain needs exactly this much — never the private
 * half — so the operation asks for exactly this much. It also lets a key that is
 * a member of an identity WITHOUT signing here (a cold backup, whose private
 * half has left the machine) be materialized like any other.
 */
export type PublicHalf = Pick<KeyPair, 'publicKey' | 'fingerprint'>;

/** Generates a fresh Ed25519 key pair with its fingerprint. */
export function generateKeyPair(): KeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return { privateKey, publicKey, fingerprint: fingerprintOf(publicKey) };
}

/** The full fingerprint of a public key: SHA-256 hex of its DER `spki` encoding. */
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

/**
 * Reconstructs a WHOLE key pair from the private half alone: the public key is
 * derived from the private one, not read from a second file.
 *
 * This is what makes a cold key ONE file. The copy a person keeps off the machine
 * needs no `.pub` beside it, so there is no second file to lose, and no pair of
 * files that could disagree about which key this is — the fingerprint is
 * re-derived here from the material itself. Throws when the text is not a private
 * key, so a caller can tell "unreadable" from "not a member".
 */
export function keyPairFromPrivatePem(pem: string): KeyPair {
  const privateKey = createPrivateKey(pem);
  // The PUBLIC key is read out of the same PEM: an Ed25519 private key carries
  // its public point, so `createPublicKey` over private material derives the
  // public half rather than requiring a second file.
  const publicKey = createPublicKey(pem);
  return { privateKey, publicKey, fingerprint: fingerprintOf(publicKey) };
}

/** Signs a message with an Ed25519 private key. */
export function sign(message: Uint8Array, privateKey: KeyObject): Uint8Array {
  // Ed25519 takes a null algorithm (the algorithm is implied by the key).
  return edSign(null, message, privateKey);
}

/** p = 2^255 - 19, the field; L, the order of the base point (RFC 8032 section 5.1). */
const P = (1n << 255n) - 19n;
const L = (1n << 252n) + 27742317777372353535851937790883648493n;

/**
 * The eight points of small order — [8]P is the identity — in their canonical encodings, as
 * CCTV's `ed25519/README.md` lists them. Every other encoding of one of them is non-canonical
 * (`y >= p`, or `x = 0` with the sign bit set), and {@link strictPoint} refuses those first, so
 * these eight are the whole set left to refuse.
 */
const SMALL_ORDER: ReadonlySet<string> = new Set([
  '0000000000000000000000000000000000000000000000000000000000000000',
  '0000000000000000000000000000000000000000000000000000000000000080',
  '0100000000000000000000000000000000000000000000000000000000000000',
  '26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05',
  '26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc85',
  'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a',
  'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac03fa',
  'ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
]);

function littleEndian(bytes: Uint8Array): bigint {
  let n = 0n;
  for (let i = bytes.length - 1; i >= 0; i -= 1) n = (n << 8n) | BigInt(bytes[i] as number);
  return n;
}

/**
 * Whether a 32-byte point encoding is one the strict rule admits: canonical, and not of small
 * order. Whether it is a point at all is left to `node:crypto`, which refuses one that is not.
 */
function strictPoint(encoded: Uint8Array): boolean {
  if (encoded.length !== 32) return false;
  const whole = littleEndian(encoded);
  const y = whole & ((1n << 255n) - 1n);
  if (y >= P) return false;
  // x = 0 only where y = 1 or y = p - 1, and there the sign bit can only be 0: a 1 is "-0".
  if (whole >> 255n === 1n && (y === 1n || y === P - 1n)) return false;
  return !SMALL_ORDER.has(Buffer.from(encoded).toString('hex'));
}

/**
 * Whether a public key's A is one the strict rule admits, asked once per key: exporting the key
 * to read its 32 bytes cost a third of a verification, and a record checks many signatures by
 * few keys.
 */
const STRICT_KEYS = new WeakMap<KeyObject, boolean>();

function strictKey(publicKey: KeyObject): boolean {
  let admitted = STRICT_KEYS.get(publicKey);
  if (admitted === undefined) {
    admitted = strictPoint(publicKey.export({ type: 'spki', format: 'der' }).subarray(12));
    STRICT_KEYS.set(publicKey, admitted);
  }
  return admitted;
}

/**
 * Verifies an Ed25519 signature against a public key, under the STRICT rule `FORMAT.md` section
 * 6 states: A and R decode canonically to points that are not of small order, `S < L`, and the
 * equation is the one without the cofactor.
 *
 * The encodings are checked HERE, before `node:crypto`, because `node:crypto` is not one rule:
 * Node 22 and Node 24 up to 24.18 accept a small-order A or R, and a non-canonical A, which Node
 * 24.19 and later refuse (nodejs/node#64026). Without this check a record forged with a
 * small-order key verified under one Node and failed under another. The equation is still
 * `node:crypto`'s, and it is cofactorless on every version
 * (`packages/code/tests/every-verifier-gives-one-ed25519-verdict.test.ts`).
 */
export function verify(message: Uint8Array, signature: Uint8Array, publicKey: KeyObject): boolean {
  if (signature.length !== 64) return false;
  if (!strictKey(publicKey) || !strictPoint(signature.subarray(0, 32))) return false;
  if (littleEndian(signature.subarray(32)) >= L) return false;
  return edVerify(null, message, publicKey, signature);
}
