import type { CheckpointSigner } from '../head-checkpoint.js';
import { type AttestationArtifact, buildArtifact } from './attestation-artifact.js';
import type { AuditChainWalk } from './audit-chain-walk.js';

/**
 * A resolved signer: the machine key plus the actor handle it belongs to.
 * Re-exported from {@link CheckpointSigner} — the checkpoint and attestation
 * paths sign with the same per-machine key, so they share one signer type
 * rather than drifting apart as two identical declarations.
 */
export type AttestationSigner = CheckpointSigner;

/**
 * Materialises the signed attestation for the chained events in `[from, to)`,
 * reading them from an already-computed {@link AuditChainWalk}. Off the write
 * hot-path by construction: the caller (the `reattest` command, or later the
 * anchor scheduler) walks the log once and emits batches from it; the writer
 * never signs a batch inline.
 *
 * The signer's Ed25519 key produces the signature; its full fingerprint is
 * recorded so an anonymous verifier resolves the committed `.pub` by the whole
 * 256-bit fingerprint (see `committedSignerResolver`).
 *
 * @param walk - The chained events on disk, indexed
 * @param from - First covered index (inclusive)
 * @param to - One past the last covered index (exclusive)
 * @param signer - The machine key + actor doing the signing
 * @param projectHmacId - The committed `sha256(secret)` id bound into the sig
 * @returns The signed artifact, ready to write and commit
 * @throws If `[from, to)` is not a valid range within the walked events, or a
 *   covered event lacks a hash (surfaced by `buildArtifact`)
 */
export function emitAttestation(
  walk: AuditChainWalk,
  from: number,
  to: number,
  signer: AttestationSigner,
  projectHmacId: string,
): AttestationArtifact {
  // The walk is indexed 0..n-1 over chained events; a batch must fall inside
  // that range. buildArtifact re-checks the range shape (from >= 0, to > from)
  // and the event count, so this only needs to bound `to` to what was walked.
  if (to > walk.chained.length) {
    throw new Error(
      `attestation range [${from}, ${to}) exceeds ${walk.chained.length} chained events on disk`,
    );
  }
  const events = walk.chained.slice(from, to).map((c) => c.event);
  const { fingerprint } = signer.machineKey.getOrCreate();
  return buildArtifact({
    events,
    from,
    to,
    signerActor: signer.actor,
    signerFingerprint: fingerprint,
    projectHmacId,
    sign: (message) => signer.machineKey.sign(message),
  });
}
