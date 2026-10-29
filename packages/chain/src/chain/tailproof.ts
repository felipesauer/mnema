/**
 * Tail proof: the signing key's signature over its own tail id.
 *
 * A tail directory is named `<fingerprint>-<installationId>`. The fingerprint
 * prefix is a committed key, but the installation-id suffix is chosen locally
 * and, on its own, is bound to nothing: a party who holds no key can copy a
 * residual (uncheckpointed) tail into `tails/<real-fingerprint>-<forged>/`,
 * relabel every `link.tail`, recompute the keyless hash chain, and the verifier
 * would count the same events under two tail ids, a keyless duplication in the
 * window before the first checkpoint. (A checkpoint already signs the full tail
 * id, so a tail that has checkpointed is immune; the gap is only the residual
 * window.)
 *
 * The tail proof closes that gap the same way the checkpoint does: by
 * signature. At birth the owner signs a statement naming THIS tail id with its
 * private key and stores it beside the segments. The verifier requires every
 * tail to carry a valid proof over its own directory name, checked against the
 * committed public key for the fingerprint prefix. A keyless party cannot mint
 * one over a forged suffix, and a genuine proof does not transfer to a
 * different tail id (the signed message is the tail id), so a legitimate second
 * installation of a copied key, which holds the key and signs its OWN distinct
 * id, still verifies, while the fabricated sibling does not.
 *
 * The proof is over the id, never the content: integrity of the events is the
 * hash chain's job and their authenticity is the checkpoint's. It is signed
 * once, at birth, and lives for the life of the tail.
 */

import { canonicalBytes, canonicalStringify } from '../events/canonical.js';
import { holdsExactly, keyList, parseCanonicalLine, schemeNotRead } from '../events/stored-json.js';
import { type KeyObject, type KeyPair, sign, verify } from './keys.js';
import { tailFingerprint } from './layout.js';

/**
 * The scheme a tail proof declares.
 *
 * EXPORTED SO THE DOCUMENT CAN NAME IT. `format-doc.test.ts` requires every
 * `mnema-<thing>/<n>` tag written in `FORMAT.md` to be a constant the code
 * exports: its own comment says a new section "has to export its own before it
 * can name it". This artifact went undocumented until an independent verifier
 * found it in a tail directory and had to guess what it signs (gap G10), so the
 * document now has a section about it, and this is the constant that section is
 * checked against, with {@link NAMED_TAILPROOF_SCHEME} beside it. The readers of the values are all
 * in this file.
 */
export const TAILPROOF_SCHEME = 'mnema-tail/1';

/**
 * The scheme of a tail proof that also names the record the tail belongs to (FORMAT.md section
 * 6.10): `{"record","scheme","signerFp","tail"}` signed. A tail born under it counts only in that
 * record.
 */
export const NAMED_TAILPROOF_SCHEME = 'mnema-tail/2';

const SCHEME = TAILPROOF_SCHEME;
const SCHEMES_READ = [TAILPROOF_SCHEME, NAMED_TAILPROOF_SCHEME] as const;

/** A signing key's proof that it owns a given tail id. */
export interface TailProof {
  readonly scheme: string;
  /** The tail id this proof is over: `<fingerprint>-<installationId>`. */
  readonly tail: string;
  /** Full fingerprint of the signing key (equal to the tail's prefix). */
  readonly signerFp: string;
  /** The record the tail belongs to: present exactly under {@link NAMED_TAILPROOF_SCHEME}. */
  readonly record?: string;
  /** Hex Ed25519 signature over the canonical signed message. */
  readonly sig: string;
}

/** The fields a proof stores, by its scheme, `sig` aside. */
function storedFields(fields: Omit<TailProof, 'sig'>): Record<string, string | null> {
  const signed: Record<string, string | null> = {
    scheme: fields.scheme,
    tail: fields.tail,
    signerFp: fields.signerFp,
  };
  if (fields.scheme === NAMED_TAILPROOF_SCHEME) signed.record = fields.record ?? null;
  return signed;
}

/** The canonical bytes that are signed: everything but the signature. */
function signedMessage(fields: Omit<TailProof, 'sig'>): Uint8Array {
  return canonicalBytes(storedFields(fields));
}

/**
 * Signs a proof that `keyPair` owns `tail`; given `record`, under {@link NAMED_TAILPROOF_SCHEME},
 * naming the record the tail belongs to.
 */
export function signTailProof(tail: string, keyPair: KeyPair, record?: string): TailProof {
  const fields: Omit<TailProof, 'sig'> = {
    scheme: record === undefined ? SCHEME : NAMED_TAILPROOF_SCHEME,
    tail,
    signerFp: keyPair.fingerprint,
    ...(record === undefined ? {} : { record }),
  };
  const sig = Buffer.from(sign(signedMessage(fields), keyPair.privateKey)).toString('hex');
  return { ...fields, sig };
}

/**
 * Verifies a proof is a signature over `tail` by the given public key. Returns
 * a verdict rather than throwing so the verifier can aggregate over many tails.
 * The proof's own `tail` must equal the directory name the verifier found, so a
 * genuine proof cannot be relocated to a fabricated tail, and its `signerFp` must
 * be the fingerprint that directory name begins with: `publicKey` is the key the
 * tail id names, never one looked up by the proof's own claim.
 */
export function verifyTailProof(input: {
  proof: TailProof;
  tail: string;
  publicKey: KeyObject;
}): TailProofVerdict {
  const { proof, tail, publicKey } = input;
  if (proof.scheme !== SCHEME && proof.scheme !== NAMED_TAILPROOF_SCHEME) {
    return { ok: false, reason: 'unknown-scheme' };
  }
  if (proof.tail !== tail) return { ok: false, reason: 'tail-mismatch' };
  // The key is the one the tail id names, and the proof has to say so (FORMAT.md section
  // 6.1): a proof another key of the record signed, or one that names another key, proves
  // nothing about who owns this tail. The second reader compares the same two strings.
  if (proof.signerFp !== tailFingerprint(tail)) return { ok: false, reason: 'signer-mismatch' };
  const { sig, ...fields } = proof;
  let signatureOk: boolean;
  try {
    signatureOk = verify(signedMessage(fields), Buffer.from(sig, 'hex'), publicKey);
  } catch {
    signatureOk = false;
  }
  return signatureOk ? { ok: true } : { ok: false, reason: 'bad-signature' };
}

export type TailProofVerdict =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: 'unknown-scheme' | 'tail-mismatch' | 'signer-mismatch' | 'bad-signature';
    };

/** Serializes a tail proof to its stored line (canonical). */
export function serializeTailProof(proof: TailProof): string {
  const { sig, ...fields } = proof;
  return canonicalStringify({ ...storedFields(fields), sig });
}

/** The keys of a stored `/1` tail proof: the three signed ones and `sig`, and nothing else. */
const TAILPROOF_LINE_KEYS = ['scheme', 'sig', 'signerFp', 'tail'] as const;

/** The keys of a stored `/2` tail proof: the four signed ones and `sig`. */
const NAMED_TAILPROOF_LINE_KEYS = ['record', 'scheme', 'sig', 'signerFp', 'tail'] as const;

/**
 * The proof's shape, checked before its bytes, in the second reader's order and words
 * (`read_tailproof` in `mnemaverify/checkpoint.py`): an object, a scheme this reader knows,
 * then exactly the four keys. A key beside them is outside the signed message, so the
 * signature still verifies with it there, and it is refused.
 */
function tailProofShape(raw: unknown): void {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new TailProofParseError('a tail proof that is not a JSON object');
  }
  const { scheme } = raw as { scheme?: unknown };
  if (scheme !== SCHEME && scheme !== NAMED_TAILPROOF_SCHEME) {
    throw new TailProofParseError(schemeNotRead('tail-proof', scheme, 'mnema-tail/', SCHEMES_READ));
  }
  const keys = scheme === NAMED_TAILPROOF_SCHEME ? NAMED_TAILPROOF_LINE_KEYS : TAILPROOF_LINE_KEYS;
  if (!holdsExactly(raw, keys)) {
    throw new TailProofParseError(
      `tail-proof keys are ${keyList(Object.keys(raw))}, not ${keyList(keys)}`,
    );
  }
}

/** Parses a stored tail-proof line. */
export function parseTailProof(line: string): TailProof {
  let raw: Record<string, unknown>;
  try {
    raw = parseCanonicalLine(line, tailProofShape) as Record<string, unknown>;
  } catch (error) {
    if (error instanceof TailProofParseError) throw error;
    throw new TailProofParseError((error as Error).message);
  }
  const requireString = (key: string): string => {
    const value = raw[key];
    if (typeof value !== 'string' || value.length === 0) {
      throw new TailProofParseError(`tail proof missing string "${key}"`);
    }
    return value;
  };
  // The shape above refused any other scheme, before the bytes.
  const scheme = raw.scheme === NAMED_TAILPROOF_SCHEME ? NAMED_TAILPROOF_SCHEME : SCHEME;
  return {
    scheme,
    tail: requireString('tail'),
    signerFp: requireString('signerFp'),
    ...(scheme === NAMED_TAILPROOF_SCHEME ? { record: requireString('record') } : {}),
    sig: requireString('sig'),
  };
}

/** Thrown when a stored tail-proof line is malformed. */
export class TailProofParseError extends Error {
  override readonly name = 'TailProofParseError';
}
