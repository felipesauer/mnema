import { createHash } from 'node:crypto';

import { canonicalise } from '../../storage/audit/audit-hash.js';
import type { AuditEvent } from '../../storage/audit/audit-writer.js';
import { MachineKeyService } from '../machine-key.js';

/**
 * `mnema-attest/v1` — a committed, per-batch attestation that lets an
 * ANONYMOUS verifier (a public clone with no project HMAC secret) confirm the
 * authenticity of a range of audit events offline, using only the committed
 * Ed25519 public key.
 *
 * The core idea (ADR-41): a per-machine Ed25519 key signs a root that is
 * RECOMPUTABLE FROM THE CONTENT on disk. The verifier rebuilds each leaf from
 * the event's own bytes (via the SAME {@link canonicalise} the hash chain
 * uses), folds them into a root, and checks the signature against the
 * committed `.pub`. Editing any covered event changes its leaf, changes the
 * root, and breaks the signature — with no secret required to detect it.
 *
 * This module is PURE crypto: no disk I/O, no writer coupling. Storage lives
 * in `attestation-store`, emission in `attestation-emitter`.
 *
 * Distinct from the head-signature mechanism (`createAttestationSource` in
 * `head-checkpoint`, single SQLite row): that signs one head hash; this signs
 * a content root over an event RANGE and is committed as a file.
 */

/** Format marker embedded in the signed input and the artifact. */
export const ATTEST_VERSION = 'mnema-attest/v1';

/** Domain-separation tag folded into the root (see {@link computeRoot}). */
const ROOT_DOMAIN = 'mnema-attest/v1/root';

/** Per-leaf and pre-root separator byte. */
const SEP = Buffer.from([0x00]);

/**
 * The committed attestation record, written to
 * `.mnema/audit/attest/<to>.att`. Carries no secret: the public key that
 * verifies `signature` is resolved from the committed `.pub` by
 * `signerFingerprint`, and `projectHmacId` is the non-reversible
 * `sha256(secret)` fingerprint (never the secret).
 */
export interface AttestationArtifact {
  readonly version: string;
  readonly signerActor: string;
  /** Full (256-bit) fingerprint of the signer's public key. */
  readonly signerFingerprint: string;
  /** `sha256(project secret)` hex — the committed, non-reversible id. */
  readonly projectHmacId: string;
  /** First covered event index (inclusive, 0-based over chained events). */
  readonly from: number;
  /** One past the last covered event index (exclusive). */
  readonly to: number;
  /** `hash` of the event at index `to - 1` — the batch's head. */
  readonly coveredHeadHash: string;
  /** Hex of the content root over events `[from, to)`. */
  readonly contentRoot: string;
  /** Base64 Ed25519 signature over the {@link computeSignInput} bytes. */
  readonly signature: string;
}

/** Big-endian unsigned 64-bit encoding of a batch index. */
function be64(n: number): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(n));
  return b;
}

/** Big-endian unsigned 32-bit length prefix. */
function be32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
}

/**
 * The keyless leaf of one event: `SHA-256(0x00 || canonicalise(event))`.
 * Uses the SAME canonicalisation as the hash chain, so a verifier recomputes
 * it from the event on disk with no secret. The `0x00` prefix domain-separates
 * a leaf from the root's own preimage.
 */
export function computeLeaf(event: AuditEvent): Buffer {
  return createHash('sha256').update(SEP).update(canonicalise(event)).digest();
}

/**
 * The content root over a batch of leaves, binding the batch boundaries INTO
 * the hashed bytes:
 *
 * `R = SHA-256(0x00 || "mnema-attest/v1/root" || BE64(from) || BE64(to)
 *              || 0x00||leaf_0 || 0x00||leaf_1 || …)`
 *
 * Folding `from`/`to` into `R` (not only into the signed input) means a future
 * consumer of `contentRoot` alone cannot re-partition the batch ambiguously.
 * Fixed-width 32-byte leaves each prefixed with `0x00` make the boundary
 * between leaves unambiguous.
 *
 * @param from - First covered index (inclusive)
 * @param to - One past the last covered index (exclusive)
 * @param leaves - The per-event leaves, in order, for `[from, to)`
 */
export function computeRoot(from: number, to: number, leaves: readonly Buffer[]): Buffer {
  const h = createHash('sha256');
  h.update(SEP).update(ROOT_DOMAIN).update(be64(from)).update(be64(to));
  for (const leaf of leaves) {
    h.update(SEP).update(leaf);
  }
  return h.digest();
}

/**
 * The exact bytes the Ed25519 key signs. LENGTH-PREFIXED (TLV), never
 * `\n`-joined text: a delimiter-joined input is second-preimage-collidable
 * (two different (hmacId, head) tuples producing identical bytes), so every
 * variable-length field carries a `BE32` length. Fixed-width fields (`from`,
 * `to`, the 32-byte root) need no prefix.
 *
 * `SIGN_INPUT = "mnema-attest/v1\0" || BE32(len id)||id || BE64(from)
 *               || BE64(to) || BE32(len head)||head || root`
 *
 * `from`/`to` live here AND inside the root — a second binding, so a rollback
 * that lies about the range fails signature verification.
 *
 * @param projectHmacId - The committed `sha256(secret)` id
 * @param from - First covered index (inclusive)
 * @param to - One past the last covered index (exclusive)
 * @param coveredHeadHash - `hash` of the event at `to - 1`
 * @param root - The 32-byte content root from {@link computeRoot}
 */
export function computeSignInput(
  projectHmacId: string,
  from: number,
  to: number,
  coveredHeadHash: string,
  root: Buffer,
): Buffer {
  const id = Buffer.from(projectHmacId, 'utf-8');
  const head = Buffer.from(coveredHeadHash, 'utf-8');
  return Buffer.concat([
    Buffer.from(`${ATTEST_VERSION}\0`, 'utf-8'),
    be32(id.length),
    id,
    be64(from),
    be64(to),
    be32(head.length),
    head,
    root,
  ]);
}

/**
 * Builds the signed artifact for a batch of events. Pure: the caller supplies
 * the events (read off disk elsewhere) and a signing function, so this never
 * touches the filesystem or the machine key directly.
 *
 * @param params.events - The events for `[from, to)`, in chain order
 * @param params.from - First covered index (inclusive)
 * @param params.to - One past the last covered index (exclusive)
 * @param params.signerActor - The actor handle owning the signing key
 * @param params.signerFingerprint - Full fingerprint of the signer's key
 * @param params.projectHmacId - The committed `sha256(secret)` id
 * @param params.sign - Signs the {@link computeSignInput} bytes (e.g.
 *   `machineKey.sign`)
 * @returns The attestation artifact, ready to serialise and commit
 * @throws If the batch is empty or the range is malformed
 */
export function buildArtifact(params: {
  events: readonly AuditEvent[];
  from: number;
  to: number;
  signerActor: string;
  signerFingerprint: string;
  projectHmacId: string;
  sign: (message: Buffer) => Buffer;
}): AttestationArtifact {
  const { events, from, to, signerActor, signerFingerprint, projectHmacId, sign } = params;
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || to <= from) {
    throw new Error(`malformed attestation range [${from}, ${to})`);
  }
  if (events.length !== to - from) {
    throw new Error(`expected ${to - from} events for [${from}, ${to}), got ${events.length}`);
  }
  const head = events[events.length - 1]?.hash;
  if (typeof head !== 'string') {
    throw new Error(`covered head event at index ${to - 1} has no hash`);
  }
  const leaves = events.map(computeLeaf);
  const root = computeRoot(from, to, leaves);
  const signature = sign(computeSignInput(projectHmacId, from, to, head, root));
  return {
    version: ATTEST_VERSION,
    signerActor,
    signerFingerprint,
    projectHmacId,
    from,
    to,
    coveredHeadHash: head,
    contentRoot: root.toString('hex'),
    signature: signature.toString('base64'),
  };
}

/** Verdict of {@link verifyArtifact}: verified, mismatch, or cannot-attest. */
export type ArtifactVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string; readonly cannotAttest?: boolean };

/**
 * Verifies one artifact against the events on disk and the committed public
 * key of its signer, with NO secret. Recomputes the content root from
 * `events` — so a content edit that leaves the artifact untouched is caught —
 * then checks the Ed25519 signature.
 *
 * Returns `cannotAttest: true` (not a tamper verdict) when the signer's `.pub`
 * cannot be resolved, mirroring the fail-safe posture of
 * `createAttestationSource`: a missing/corrupt key is "cannot attest", never a
 * false tamper and never a crash.
 *
 * @param artifact - The artifact to verify
 * @param events - The on-disk events for `[artifact.from, artifact.to)`
 * @param resolvePublicKeyPem - Resolves a signer's public key PEM by FULL
 *   fingerprint, or `null` when absent from the repo
 */
export function verifyArtifact(
  artifact: AttestationArtifact,
  events: readonly AuditEvent[],
  resolvePublicKeyPem: (fingerprint: string) => string | null,
): ArtifactVerdict {
  try {
    if (artifact.version !== ATTEST_VERSION) {
      return { ok: false, reason: `unknown attestation version ${artifact.version}` };
    }
    if (
      !Number.isSafeInteger(artifact.from) ||
      !Number.isSafeInteger(artifact.to) ||
      artifact.to <= artifact.from
    ) {
      return { ok: false, reason: `malformed range [${artifact.from}, ${artifact.to})` };
    }
    if (events.length !== artifact.to - artifact.from) {
      return {
        ok: false,
        reason: `batch [${artifact.from}, ${artifact.to}) references missing events`,
      };
    }
    const leaves = events.map(computeLeaf);
    const root = computeRoot(artifact.from, artifact.to, leaves);
    if (root.toString('hex') !== artifact.contentRoot) {
      return { ok: false, reason: `content root mismatch for [${artifact.from}, ${artifact.to})` };
    }
    if (events[events.length - 1]?.hash !== artifact.coveredHeadHash) {
      return { ok: false, reason: `covered head hash mismatch for [${artifact.to})` };
    }
    const pem = resolvePublicKeyPem(artifact.signerFingerprint);
    if (pem === null) {
      return {
        ok: false,
        cannotAttest: true,
        reason: `signer ${artifact.signerFingerprint.slice(0, 12)} public key not present`,
      };
    }
    const signInput = computeSignInput(
      artifact.projectHmacId,
      artifact.from,
      artifact.to,
      artifact.coveredHeadHash,
      root,
    );
    const verified = MachineKeyService.verify(
      signInput,
      Buffer.from(artifact.signature, 'base64'),
      pem,
    );
    return verified
      ? { ok: true }
      : { ok: false, reason: `signature for [${artifact.from}, ${artifact.to}) does not verify` };
  } catch (error) {
    // Attacker-influenceable inputs (a corrupt PEM, bad base64) must never
    // crash the verifier — treat any failure as cannot-attest.
    return {
      ok: false,
      cannotAttest: true,
      reason: `cannot attest [${artifact.from}, ${artifact.to}): ${(error as Error).message}`,
    };
  }
}

/** Serialises an artifact to committed JSON (pretty, trailing newline). */
export function serializeArtifact(artifact: AttestationArtifact): string {
  return `${JSON.stringify(artifact, null, 2)}\n`;
}

/**
 * Parses and structurally validates a committed `.att`. Rejects a record
 * whose declared version is wrong or whose range is malformed; leaves
 * cryptographic verification to {@link verifyArtifact}.
 *
 * @throws If the JSON is malformed or the record is structurally invalid
 */
export function parseArtifact(json: string): AttestationArtifact {
  const raw = JSON.parse(json) as Partial<AttestationArtifact>;
  if (raw.version !== ATTEST_VERSION) {
    throw new Error('not a mnema-attest/v1 artifact');
  }
  if (
    typeof raw.signerActor !== 'string' ||
    typeof raw.signerFingerprint !== 'string' ||
    typeof raw.projectHmacId !== 'string' ||
    typeof raw.coveredHeadHash !== 'string' ||
    typeof raw.contentRoot !== 'string' ||
    typeof raw.signature !== 'string' ||
    !Number.isSafeInteger(raw.from) ||
    !Number.isSafeInteger(raw.to)
  ) {
    throw new Error('malformed attestation artifact');
  }
  return {
    version: ATTEST_VERSION,
    signerActor: raw.signerActor,
    signerFingerprint: raw.signerFingerprint,
    projectHmacId: raw.projectHmacId,
    from: raw.from as number,
    to: raw.to as number,
    coveredHeadHash: raw.coveredHeadHash,
    contentRoot: raw.contentRoot,
    signature: raw.signature,
  };
}
