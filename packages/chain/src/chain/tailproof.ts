/**
 * Tail proof: the signing key's signature over its own tail id.
 *
 * A tail directory is named `<fingerprint>-<installationId>`. The fingerprint
 * prefix is a committed key, but the installation-id suffix is chosen locally
 * and, on its own, is bound to nothing: a party who holds no key can copy a
 * residual (uncheckpointed) tail into `tails/<real-fingerprint>-<forged>/`,
 * relabel every `link.tail`, recompute the keyless hash chain, and the verifier
 * would count the same events under two tail ids — a keyless duplication in the
 * window before the first checkpoint. (A checkpoint already signs the full tail
 * id, so a tail that has checkpointed is immune; the gap is only the residual
 * window.)
 *
 * The tail proof closes that gap the same way the checkpoint does — by
 * signature. At birth the owner signs a statement naming THIS tail id with its
 * private key and stores it beside the segments. The verifier requires every
 * tail to carry a valid proof over its own directory name, checked against the
 * committed public key for the fingerprint prefix. A keyless party cannot mint
 * one over a forged suffix, and a genuine proof does not transfer to a
 * different tail id (the signed message is the tail id), so a legitimate second
 * installation of a copied key — which holds the key and signs its OWN distinct
 * id — still verifies, while the fabricated sibling does not.
 *
 * The proof is over the id, never the content: integrity of the events is the
 * hash chain's job and their authenticity is the checkpoint's. It is signed
 * once, at birth, and lives for the life of the tail.
 */

import { canonicalBytes, canonicalStringify } from '../events/canonical.js';
import { type KeyObject, type KeyPair, sign, verify } from './keys.js';

const SCHEME = 'mnema-tail/1';

/** A signing key's proof that it owns a given tail id. */
export interface TailProof {
  readonly scheme: string;
  /** The tail id this proof is over — `<fingerprint>-<installationId>`. */
  readonly tail: string;
  /** Full fingerprint of the signing key (equal to the tail's prefix). */
  readonly signerFp: string;
  /** Hex Ed25519 signature over the canonical signed message. */
  readonly sig: string;
}

/** The canonical bytes that are signed — everything but the signature. */
function signedMessage(fields: Omit<TailProof, 'sig'>): Uint8Array {
  return canonicalBytes({
    scheme: fields.scheme,
    tail: fields.tail,
    signerFp: fields.signerFp,
  });
}

/** Signs a proof that `keyPair` owns `tail`. */
export function signTailProof(tail: string, keyPair: KeyPair): TailProof {
  const fields: Omit<TailProof, 'sig'> = {
    scheme: SCHEME,
    tail,
    signerFp: keyPair.fingerprint,
  };
  const sig = Buffer.from(sign(signedMessage(fields), keyPair.privateKey)).toString('hex');
  return { ...fields, sig };
}

/**
 * Verifies a proof is a signature over `tail` by the given public key. Returns
 * a verdict rather than throwing so the verifier can aggregate over many tails.
 * The proof's own `tail` must equal the directory name the verifier found, so a
 * genuine proof cannot be relocated to a fabricated tail.
 */
export function verifyTailProof(input: {
  proof: TailProof;
  tail: string;
  publicKey: KeyObject;
}): TailProofVerdict {
  const { proof, tail, publicKey } = input;
  if (proof.scheme !== SCHEME) return { ok: false, reason: 'unknown-scheme' };
  if (proof.tail !== tail) return { ok: false, reason: 'tail-mismatch' };
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
  | { readonly ok: false; readonly reason: 'unknown-scheme' | 'tail-mismatch' | 'bad-signature' };

/** Serializes a tail proof to its stored line (canonical). */
export function serializeTailProof(proof: TailProof): string {
  return canonicalStringify({
    scheme: proof.scheme,
    tail: proof.tail,
    signerFp: proof.signerFp,
    sig: proof.sig,
  });
}

/** Parses a stored tail-proof line. */
export function parseTailProof(line: string): TailProof {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(line) as Record<string, unknown>;
  } catch (error) {
    throw new TailProofParseError(`not valid JSON: ${(error as Error).message}`);
  }
  const requireString = (key: string): string => {
    const value = raw[key];
    if (typeof value !== 'string' || value.length === 0) {
      throw new TailProofParseError(`tail proof missing string "${key}"`);
    }
    return value;
  };
  const scheme = requireString('scheme');
  if (scheme !== SCHEME) {
    throw new TailProofParseError(`unknown tail-proof scheme "${scheme}"`);
  }
  return {
    scheme,
    tail: requireString('tail'),
    signerFp: requireString('signerFp'),
    sig: requireString('sig'),
  };
}

/** Thrown when a stored tail-proof line is malformed. */
export class TailProofParseError extends Error {
  override readonly name = 'TailProofParseError';
}
