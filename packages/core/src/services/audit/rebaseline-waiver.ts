import type { AuditEvent } from '../../storage/audit/audit-writer.js';
import { MachineKeyService } from '../integrity/machine-key.js';
import { computeLeaf, computeRoot } from './attestation-artifact.js';

/**
 * `mnema-rebaseline/v1` — a committed, signed record that authorises the audit
 * chain to move its genesis WITHOUT the move reading as tampering. One format
 * covers every re-baseline; the `kind` names which:
 *
 * - `prune` — the oldest prefix `[0, cut)` was DELETED at a segment boundary.
 *   The surviving genesis's `prev_hash` points at a hash no longer on disk, so
 *   a bare verifier reads a `prev_hash` break. The waiver preserves an
 *   `anchorDigest` recomputable-from-content over the dropped prefix and binds
 *   it to the surviving genesis, so the deletion reads as an authorised prune.
 * - `truncation` — the TAIL retreated below a signed checkpoint (the machine
 *   head-signature attests a higher count than survives on disk). Nothing was
 *   deleted from the prefix, so there is no `anchorDigest`; the record vouches
 *   that a trusted, project-bound key ACCEPTED the retreat to this new head.
 *
 * The problem it solves is the same in both directions: a
 * genesis or head that moved leaves the on-disk chain looking truncated to any
 * verifier — indistinguishable from an adversary who removed history to hide
 * it. A bare move is always tamper. The fix is a SIGNED authorisation: because
 * what it vouches for is GONE (a deleted prefix, or a retreated tail whose
 * higher events no longer exist), an anonymous verifier must trust the digest
 * on the committed signature alone — so it is Ed25519-signed, never a plain
 * local acknowledgement.
 *
 * This module is PURE crypto: no disk I/O, no writer coupling. Storage and the
 * apply/verify wiring live in the recovery commands and the integrity walk.
 *
 * What this establishes is AUTHORIZATION, not an absolute lower bound: the
 * boundary values are ones the signer chose and cannot be re-derived once the
 * content is gone, so the protection is "a trusted, project-bound key vouched
 * for this move to this surviving genesis". That is only as strong as the
 * committed `.pub` set being an authenticated allowlist and the project
 * fingerprint being pinned — both enforced by {@link verifyRebaselineWaiver}.
 */

/** Format marker embedded in the signed input and the waiver. */
export const REBASELINE_VERSION = 'mnema-rebaseline/v1';

/** The kind of re-baseline a waiver authorises. */
export type RebaselineKind = 'prune' | 'truncation';

/** Per-leaf and pre-field separator byte (matches the attestation layer). */
const SEP = Buffer.from([0x00]);

/** A 32-byte all-zero digest — the canonical "no dropped prefix" anchor. */
const ZERO_DIGEST = Buffer.alloc(32);

/**
 * The committed re-baseline waiver, written to
 * `.mnema/audit/m-<id>/rebaseline.json` (per tail). Carries no secret: the
 * public key that verifies `signature` is resolved from the committed `.pub`
 * by `signerFingerprint`, and `projectHmacId` is the non-reversible
 * `sha256(secret)` id.
 */
export interface RebaselineWaiver {
  readonly version: string;
  /** Which re-baseline this authorises — see {@link RebaselineKind}. */
  readonly kind: RebaselineKind;
  readonly signerActor: string;
  /** Full (256-bit) fingerprint of the signer's public key. */
  readonly signerFingerprint: string;
  /** `sha256(project secret)` hex — the committed, non-reversible id. */
  readonly projectHmacId: string;
  /**
   * The tail this waiver re-baselines (`m-<12hex>`). Bound into the signed
   * bytes so a waiver for one machine's tail cannot be replayed against a
   * sibling tail that happens to share a genesis hash.
   */
  readonly tailId: string;
  /**
   * `prune`: the dropped-prefix length (one-past-the-last-dropped index); the
   * surviving chain begins at chained index `cut`. `truncation`: always 0 —
   * nothing is dropped from the prefix; the whole surviving chain is kept.
   */
  readonly cut: number;
  /**
   * `prune`: hex of the content anchor digest over the dropped prefix
   * `[0, cut)` — IS the re-baselined genesis's `prev_hash`, preserved here
   * once the content is gone. `truncation`: all-zero hex (no dropped prefix).
   */
  readonly anchorDigest: string;
  /**
   * `prune`: `hash` of the last dropped event (index `cut - 1`) — the head of
   * the pruned prefix, which the surviving genesis's on-disk `prev_hash` still
   * carries. `truncation`: empty (no dropped prefix).
   */
  readonly prunedHeadHash: string;
  /**
   * The new baseline head after the move. `prune`: `hash` of the first
   * surviving event (the new genesis). `truncation`: `hash` of the accepted
   * new tail head. Binds the waiver to a specific surviving chain so it cannot
   * be replayed to launder a deeper, different move.
   */
  readonly newHeadHash: string;
  /**
   * `prune`: the surviving event count (`total - cut`). `truncation`: the
   * accepted new event count. The count the mirror reconciles to.
   */
  readonly newEventCount: number;
  /** Base64 Ed25519 signature over the {@link computeRebaselineSignInput} bytes. */
  readonly signature: string;
  /** When the waiver was written (informational only). */
  readonly acceptedAt: string;
}

/** Big-endian unsigned 64-bit encoding. */
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

/** A non-negative safe integer. `cut` may be 0 (truncation); count may be 0. */
function isSafeCount(n: number): boolean {
  return Number.isSafeInteger(n) && n >= 0;
}

/**
 * The content anchor digest over the dropped prefix `[0, cut)`. Reuses the
 * attestation layer's keyless leaf and boundary-binding root, so the digest is
 * recomputable from the dropped events' own bytes exactly as an anonymous
 * verifier would — while the content still exists. After the prune, this digest
 * is preserved in the committed waiver and stands in for the deleted content.
 * A `truncation` drops no prefix, so it uses the all-zero digest.
 *
 * @param events - The dropped events `[0, cut)`, in chain order
 * @returns The 32-byte anchor digest
 */
export function computeAnchorDigest(events: readonly AuditEvent[]): Buffer {
  const leaves = events.map(computeLeaf);
  return computeRoot(0, events.length, leaves);
}

/**
 * The exact bytes the Ed25519 key signs. LENGTH-PREFIXED (TLV), never
 * `\n`-joined text — a delimiter-joined input is second-preimage-collidable.
 * Every variable-length field carries a `BE32` length; the fixed-width `kind`
 * tag, counts, and the 32-byte anchor digest need none.
 *
 * `kind`, `tailId`, and `signerFingerprint` are all bound so the signature
 * commits to WHICH move, on WHICH tail, by WHICH key: without them a holder of
 * any committed `.pub` could re-sign the digest with their own key, or a waiver
 * for tail A could be replayed against tail B, or a prune waiver reinterpreted
 * as a truncation. The counts, pruned head, new head, and digest are bound so a
 * move that lies about the boundary or replays against a different surviving
 * chain fails verification.
 */
export function computeRebaselineSignInput(params: {
  kind: RebaselineKind;
  projectHmacId: string;
  signerFingerprint: string;
  tailId: string;
  cut: number;
  prunedHeadHash: string;
  newHeadHash: string;
  newEventCount: number;
  anchorDigest: Buffer;
}): Buffer {
  const kind = Buffer.from(params.kind, 'utf-8');
  const id = Buffer.from(params.projectHmacId, 'utf-8');
  const fingerprint = Buffer.from(params.signerFingerprint, 'utf-8');
  const tail = Buffer.from(params.tailId, 'utf-8');
  const prunedHead = Buffer.from(params.prunedHeadHash, 'utf-8');
  const newHead = Buffer.from(params.newHeadHash, 'utf-8');
  return Buffer.concat([
    Buffer.from(`${REBASELINE_VERSION}\0`, 'utf-8'),
    be32(kind.length),
    kind,
    be32(id.length),
    id,
    be32(fingerprint.length),
    fingerprint,
    be32(tail.length),
    tail,
    be64(params.cut),
    be32(prunedHead.length),
    prunedHead,
    be32(newHead.length),
    newHead,
    be64(params.newEventCount),
    SEP,
    params.anchorDigest,
  ]);
}

/**
 * Builds a signed PRUNE waiver. Pure: the caller supplies the dropped events
 * (read off disk before deletion) and a signing function, so this never
 * touches the filesystem or the machine key directly.
 *
 * @throws If the cut is malformed, a boundary event carries no hash, or the
 *   surviving genesis has no hash
 */
export function buildPruneWaiver(params: {
  droppedEvents: readonly AuditEvent[];
  genesisHash: string;
  survivingEventCount: number;
  tailId: string;
  signerActor: string;
  signerFingerprint: string;
  projectHmacId: string;
  acceptedAt: string;
  sign: (message: Buffer) => Buffer;
}): RebaselineWaiver {
  const cut = params.droppedEvents.length;
  if (!Number.isSafeInteger(cut) || cut <= 0) {
    throw new Error(`malformed prune cut ${cut} (nothing to prune)`);
  }
  const prunedHeadHash = params.droppedEvents[cut - 1]?.hash;
  if (typeof prunedHeadHash !== 'string') {
    throw new Error(`pruned head event at index ${cut - 1} has no hash`);
  }
  if (typeof params.genesisHash !== 'string' || params.genesisHash.length === 0) {
    throw new Error('surviving genesis event has no hash');
  }
  const anchorDigest = computeAnchorDigest(params.droppedEvents);
  return finish({
    kind: 'prune',
    tailId: params.tailId,
    cut,
    anchorDigest,
    prunedHeadHash,
    newHeadHash: params.genesisHash,
    newEventCount: params.survivingEventCount,
    signerActor: params.signerActor,
    signerFingerprint: params.signerFingerprint,
    projectHmacId: params.projectHmacId,
    acceptedAt: params.acceptedAt,
    sign: params.sign,
  });
}

/**
 * Builds a signed TRUNCATION waiver. Nothing is dropped from the prefix, so
 * there is no anchor digest or pruned-head hash; the record vouches that a
 * trusted key accepted the tail retreating to `newHeadHash`/`newEventCount`.
 *
 * @throws If the new head hash is empty or the count is not a safe non-negative
 *   integer
 */
export function buildTruncationWaiver(params: {
  newHeadHash: string;
  newEventCount: number;
  tailId: string;
  signerActor: string;
  signerFingerprint: string;
  projectHmacId: string;
  acceptedAt: string;
  sign: (message: Buffer) => Buffer;
}): RebaselineWaiver {
  if (typeof params.newHeadHash !== 'string' || params.newHeadHash.length === 0) {
    throw new Error('accepted truncation head has no hash');
  }
  if (!isSafeCount(params.newEventCount)) {
    throw new Error(`malformed accepted event count ${params.newEventCount}`);
  }
  return finish({
    kind: 'truncation',
    tailId: params.tailId,
    cut: 0,
    anchorDigest: ZERO_DIGEST,
    prunedHeadHash: '',
    newHeadHash: params.newHeadHash,
    newEventCount: params.newEventCount,
    signerActor: params.signerActor,
    signerFingerprint: params.signerFingerprint,
    projectHmacId: params.projectHmacId,
    acceptedAt: params.acceptedAt,
    sign: params.sign,
  });
}

/** Signs the assembled fields and materialises the waiver record. */
function finish(p: {
  kind: RebaselineKind;
  tailId: string;
  cut: number;
  anchorDigest: Buffer;
  prunedHeadHash: string;
  newHeadHash: string;
  newEventCount: number;
  signerActor: string;
  signerFingerprint: string;
  projectHmacId: string;
  acceptedAt: string;
  sign: (message: Buffer) => Buffer;
}): RebaselineWaiver {
  const signature = p.sign(
    computeRebaselineSignInput({
      kind: p.kind,
      projectHmacId: p.projectHmacId,
      signerFingerprint: p.signerFingerprint,
      tailId: p.tailId,
      cut: p.cut,
      prunedHeadHash: p.prunedHeadHash,
      newHeadHash: p.newHeadHash,
      newEventCount: p.newEventCount,
      anchorDigest: p.anchorDigest,
    }),
  );
  return {
    version: REBASELINE_VERSION,
    kind: p.kind,
    signerActor: p.signerActor,
    signerFingerprint: p.signerFingerprint,
    projectHmacId: p.projectHmacId,
    tailId: p.tailId,
    cut: p.cut,
    anchorDigest: p.anchorDigest.toString('hex'),
    prunedHeadHash: p.prunedHeadHash,
    newHeadHash: p.newHeadHash,
    newEventCount: p.newEventCount,
    signature: signature.toString('base64'),
    acceptedAt: p.acceptedAt,
  };
}

/** Verdict of {@link verifyRebaselineWaiver}: verified, mismatch, or cannot-verify. */
export type RebaselineVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string; readonly cannotVerify?: boolean };

/**
 * Verifies a re-baseline waiver against what survives on disk NOW and the
 * committed public key of its signer, with NO secret. Verification rests on:
 *
 * 1. PROJECT PIN — the waiver's `projectHmacId` must equal this project's own
 *    committed `sha256(secret)`; else a waiver minted in another project (whose
 *    signature verifies against ITS key) would verify unchanged here.
 * 2. TAIL PIN — the waiver's `tailId` must equal the tail being verified; a
 *    waiver for a sibling tail cannot be replayed against this one even if the
 *    genesis hashes collide.
 * 3. SIGNER BIND — `signerFingerprint` and `kind` are in the signed bytes, so
 *    the signature commits to which key signed which kind of move.
 * 4. HEAD RE-CHECK — the new baseline head on disk (`observedNewHead`) must be
 *    the one the waiver was signed for, so an OLD waiver cannot be replayed
 *    against a deeper, different move.
 *
 * This establishes AUTHORIZATION, not an absolute lower bound — the boundary
 * values are the signer's and cannot be re-derived once content is gone, so the
 * guarantee assumes the committed `.pub` set is an authenticated allowlist.
 *
 * @param waiver - The waiver to verify
 * @param observedNewHead - `hash` of the new baseline head on disk now (the
 *   surviving genesis for a prune, the accepted tail head for a truncation)
 * @param expectedTailId - The tail this verification is scoped to (`m-<id>`)
 * @param expectedProjectHmacId - This project's committed `sha256(secret)` id,
 *   or `null` when none is committed (pin skipped; the missing anchor is warned
 *   elsewhere)
 * @param resolvePublicKeyPem - Resolves a signer's public key PEM by FULL
 *   fingerprint, or `null` when absent
 */
export function verifyRebaselineWaiver(
  waiver: RebaselineWaiver,
  observedNewHead: string,
  expectedTailId: string,
  expectedProjectHmacId: string | null,
  resolvePublicKeyPem: (fingerprint: string) => string | null,
): RebaselineVerdict {
  try {
    if (waiver.version !== REBASELINE_VERSION) {
      return { ok: false, reason: `unknown re-baseline waiver version ${waiver.version}` };
    }
    if (waiver.kind !== 'prune' && waiver.kind !== 'truncation') {
      return { ok: false, reason: `unknown re-baseline kind ${waiver.kind}` };
    }
    if (!isSafeCount(waiver.cut) || !isSafeCount(waiver.newEventCount)) {
      return { ok: false, reason: `malformed re-baseline counts` };
    }
    if (waiver.kind === 'prune' && waiver.cut <= 0) {
      return { ok: false, reason: `prune cut ${waiver.cut} drops nothing` };
    }
    // Project pin.
    if (expectedProjectHmacId != null && waiver.projectHmacId !== expectedProjectHmacId) {
      return {
        ok: false,
        reason: `re-baseline waiver carries project id …${waiver.projectHmacId.slice(0, 12)}, but this project's committed fingerprint is …${expectedProjectHmacId.slice(0, 12)} — the waiver is for a different project`,
      };
    }
    // Tail pin.
    if (waiver.tailId !== expectedTailId) {
      return {
        ok: false,
        reason: `re-baseline waiver is for tail ${waiver.tailId}, not ${expectedTailId} — it cannot re-baseline this tail`,
      };
    }
    // Head re-check: the new baseline head on disk NOW must be the one signed.
    if (observedNewHead !== waiver.newHeadHash) {
      return {
        ok: false,
        reason: `new baseline head ${observedNewHead.slice(0, 12)} does not match the waiver (${waiver.newHeadHash.slice(0, 12)}) — a move deeper than the one accepted`,
      };
    }
    const anchorDigest = Buffer.from(waiver.anchorDigest, 'hex');
    if (anchorDigest.length !== 32) {
      return { ok: false, reason: `anchor digest is not a 32-byte hash` };
    }
    const pem = resolvePublicKeyPem(waiver.signerFingerprint);
    if (pem === null) {
      return {
        ok: false,
        cannotVerify: true,
        reason: `signer ${waiver.signerFingerprint.slice(0, 12)} public key not present`,
      };
    }
    const signInput = computeRebaselineSignInput({
      kind: waiver.kind,
      projectHmacId: waiver.projectHmacId,
      signerFingerprint: waiver.signerFingerprint,
      tailId: waiver.tailId,
      cut: waiver.cut,
      prunedHeadHash: waiver.prunedHeadHash,
      newHeadHash: waiver.newHeadHash,
      newEventCount: waiver.newEventCount,
      anchorDigest,
    });
    const verified = MachineKeyService.verify(
      signInput,
      Buffer.from(waiver.signature, 'base64'),
      pem,
    );
    return verified
      ? { ok: true }
      : { ok: false, reason: `re-baseline waiver signature does not verify` };
  } catch (error) {
    return {
      ok: false,
      cannotVerify: true,
      reason: `cannot verify re-baseline waiver: ${(error as Error).message}`,
    };
  }
}

/** Serialises a waiver to committed JSON (pretty, trailing newline). */
export function serializeRebaselineWaiver(waiver: RebaselineWaiver): string {
  return `${JSON.stringify(waiver, null, 2)}\n`;
}

/**
 * Parses and structurally validates a committed re-baseline waiver. Rejects a
 * record whose version/kind is wrong or whose counts are malformed; leaves
 * cryptographic verification to {@link verifyRebaselineWaiver}.
 *
 * @throws If the JSON is malformed or the record is structurally invalid
 */
export function parseRebaselineWaiver(json: string): RebaselineWaiver {
  const raw = JSON.parse(json) as Record<string, unknown>;
  if (raw.version !== REBASELINE_VERSION) {
    throw new Error(`not a ${REBASELINE_VERSION} waiver`);
  }
  if (raw.kind !== 'prune' && raw.kind !== 'truncation') {
    throw new Error(`unknown re-baseline kind ${String(raw.kind)}`);
  }
  const stringFields = [
    'signerActor',
    'signerFingerprint',
    'projectHmacId',
    'tailId',
    'anchorDigest',
    'prunedHeadHash',
    'newHeadHash',
    'signature',
    'acceptedAt',
  ] as const;
  for (const f of stringFields) {
    if (typeof raw[f] !== 'string')
      throw new Error(`re-baseline waiver field ${f} is not a string`);
  }
  if (!isSafeCount(raw.cut as number) || !isSafeCount(raw.newEventCount as number)) {
    throw new Error('re-baseline waiver counts are malformed');
  }
  return raw as unknown as RebaselineWaiver;
}
