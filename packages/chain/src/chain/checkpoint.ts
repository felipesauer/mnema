/**
 * Checkpoints: signed statements over a content-recomputable root.
 *
 * A checkpoint asserts "this contiguous range of this tail has this content
 * root, and I — the machine with this fingerprint — sign it." It is the only
 * layer of authenticity: it covers T2 (an editor without the private key
 * cannot re-sign a changed root) and T4 (an anonymous clone recomputes the
 * root from the bytes and checks the signature against the committed public
 * key, offline, with no secret).
 *
 * The signed message includes the FULL signer fingerprint, so a signature
 * cannot be re-pointed at a different key. The content root is recomputed from
 * the events, never read from stored entry hashes — see hash.ts.
 */

import { canonicalBytes, canonicalStringify } from '../events/canonical.js';
import type { CatalogEvent } from '../events/catalog.js';
import { contentRoot } from './hash.js';
import type { KeyPair } from './keys.js';
import { type KeyObject, sign, verify } from './keys.js';

const SCHEME = 'mnema-checkpoint/1';

/** A signed checkpoint over a contiguous range of one tail. */
export interface Checkpoint {
  readonly scheme: string;
  readonly tail: string;
  /** First seq covered (inclusive). */
  readonly fromSeq: number;
  /** Last seq covered (inclusive). */
  readonly toSeq: number;
  /** Content root folded over the events in the range. */
  readonly contentRoot: string;
  /** Full fingerprint of the signing key. */
  readonly signerFp: string;
  /** Hex Ed25519 signature over the canonical signed message. */
  readonly sig: string;
}

/** The canonical bytes that are signed — everything but the signature. */
function signedMessage(fields: Omit<Checkpoint, 'sig'>): Uint8Array {
  return canonicalBytes({
    scheme: fields.scheme,
    tail: fields.tail,
    fromSeq: fields.fromSeq,
    toSeq: fields.toSeq,
    contentRoot: fields.contentRoot,
    signerFp: fields.signerFp,
  });
}

/**
 * Signs a checkpoint over `events`, which must be the contiguous range
 * `[fromSeq..toSeq]` of `tail` in order. The content root is folded from the
 * events' canonical bytes.
 */
export function signCheckpoint(input: {
  tail: string;
  fromSeq: number;
  events: readonly CatalogEvent[];
  keyPair: KeyPair;
}): Checkpoint {
  const { tail, fromSeq, events, keyPair } = input;
  const fields: Omit<Checkpoint, 'sig'> = {
    scheme: SCHEME,
    tail,
    fromSeq,
    toSeq: fromSeq + events.length - 1,
    contentRoot: contentRoot(events),
    signerFp: keyPair.fingerprint,
  };
  const sig = Buffer.from(sign(signedMessage(fields), keyPair.privateKey)).toString('hex');
  return { ...fields, sig };
}

/**
 * Verifies a checkpoint against the events it claims to cover and the public
 * key it names. Recomputes the content root from the events (never from stored
 * hashes) and checks the Ed25519 signature. Returns a verdict rather than
 * throwing so the verifier can aggregate many checkpoints.
 */
export function verifyCheckpoint(input: {
  checkpoint: Checkpoint;
  events: readonly CatalogEvent[];
  publicKey: KeyObject;
}): CheckpointVerdict {
  const { checkpoint, events, publicKey } = input;

  const expectedCount = checkpoint.toSeq - checkpoint.fromSeq + 1;
  if (events.length !== expectedCount) {
    return { ok: false, reason: 'range-mismatch' };
  }
  const recomputed = contentRoot(events);
  if (recomputed !== checkpoint.contentRoot) {
    return { ok: false, reason: 'content-root-mismatch' };
  }
  const { sig, ...fields } = checkpoint;
  let signatureOk: boolean;
  try {
    signatureOk = verify(signedMessage(fields), Buffer.from(sig, 'hex'), publicKey);
  } catch {
    signatureOk = false;
  }
  if (!signatureOk) {
    return { ok: false, reason: 'bad-signature' };
  }
  return { ok: true };
}

export type CheckpointVerdict =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: 'range-mismatch' | 'content-root-mismatch' | 'bad-signature';
    };

/** Serializes a checkpoint to its stored line (canonical). */
export function serializeCheckpoint(checkpoint: Checkpoint): string {
  return canonicalStringify({
    scheme: checkpoint.scheme,
    tail: checkpoint.tail,
    fromSeq: checkpoint.fromSeq,
    toSeq: checkpoint.toSeq,
    contentRoot: checkpoint.contentRoot,
    signerFp: checkpoint.signerFp,
    sig: checkpoint.sig,
  });
}

/** Parses a stored checkpoint line. */
export function parseCheckpoint(line: string): Checkpoint {
  const raw = JSON.parse(line) as Record<string, unknown>;
  const requireString = (key: string): string => {
    const value = raw[key];
    if (typeof value !== 'string' || value.length === 0) {
      throw new CheckpointParseError(`checkpoint missing string "${key}"`);
    }
    return value;
  };
  const requireSeq = (key: string): number => {
    const value = raw[key];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      throw new CheckpointParseError(`checkpoint missing seq "${key}"`);
    }
    return value;
  };
  const scheme = requireString('scheme');
  if (scheme !== SCHEME) {
    throw new CheckpointParseError(`unknown checkpoint scheme "${scheme}"`);
  }
  return {
    scheme,
    tail: requireString('tail'),
    fromSeq: requireSeq('fromSeq'),
    toSeq: requireSeq('toSeq'),
    contentRoot: requireString('contentRoot'),
    signerFp: requireString('signerFp'),
    sig: requireString('sig'),
  };
}

/** Thrown when a stored checkpoint line is malformed. */
export class CheckpointParseError extends Error {
  override readonly name = 'CheckpointParseError';
}
