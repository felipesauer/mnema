import type { AuditEvent } from '../../storage/audit/audit-writer.js';
import { MachineKeyService } from '../integrity/machine-key.js';
import { computeLeaf, computeRoot } from './attestation-artifact.js';

/**
 * `mnema-prune/v1` — a committed, signed waiver that lets an audit chain be
 * pruned at a segment boundary WITHOUT the deletion reading as tampering.
 *
 * The problem (ADR-68): the audit chain is one continuous hash chain across
 * segment files; each event's `prev_hash` is inside its hashed bytes. Delete
 * the oldest months and the surviving oldest event's `prev_hash` points at a
 * hash no longer on disk — indistinguishable, to any verifier, from an
 * adversary who deleted history to hide it. A bare delete is always tamper.
 *
 * The fix: before deleting, compute a digest over the dropped prefix
 * `[0, cut)` that is RECOMPUTABLE FROM ITS CONTENT (the same keyless leaf +
 * root the attestation layer uses), and sign a waiver binding that digest to
 * the cut and to the surviving genesis. The digest becomes the re-baselined
 * genesis's `prev_hash` anchor: after the prune the content is gone, but the
 * committed, signed digest still attests "events [0, cut) existed and hashed
 * to X", and the surviving chain is bound to it. ONE artefact serves both
 * roles — the genesis anchor and the layer-3 attestation of the dropped
 * prefix — because tying authenticity to a single recomputable-from-content
 * signed digest is the robust shape (attestation lesson).
 *
 * This module is PURE crypto: no disk I/O, no writer coupling. Storage and the
 * apply/verify wiring live in the prune command and the integrity walk.
 *
 * Contrast with the OTHER waivers (`audit-diagnose.ts`): the legacy-breaks and
 * truncation waivers are unsigned local acknowledgements re-verified against
 * disk. This one is SIGNED (Ed25519) because the content it vouches for is
 * DELETED — there is nothing left on disk to re-verify it against, so an
 * anonymous verifier must trust the digest on the committed signature alone.
 *
 * What this establishes is AUTHORIZATION, not an absolute lower bound: `cut`
 * and `anchorDigest` are values the signer chose and cannot be re-derived once
 * the content is gone, so the protection is "a trusted, project-bound key
 * vouched for a prune to this surviving genesis". That is only as strong as
 * the committed `.pub` set being an authenticated allowlist and the project
 * fingerprint being pinned — both enforced by {@link verifyPruneWaiver}. On an
 * anonymous clone (`signedEventCountAt` is null) this signed waiver is what
 * keeps a legitimate prune from reading as tamper AND a silent prefix
 * truncation from reading as a legitimate prune, WITHIN that trust assumption.
 */

/** Format marker embedded in the signed input and the waiver. */
export const PRUNE_VERSION = 'mnema-prune/v1';

/** Per-leaf and pre-field separator byte (matches the attestation layer). */
const SEP = Buffer.from([0x00]);

/**
 * The committed prune waiver, written to `.mnema/audit/prune-accepted.json`.
 * Carries no secret: the public key that verifies `signature` is resolved from
 * the committed `.pub` by `signerFingerprint`, and `projectHmacId` is the
 * non-reversible `sha256(secret)` id.
 */
export interface PruneWaiver {
  readonly version: string;
  readonly signerActor: string;
  /** Full (256-bit) fingerprint of the signer's public key. */
  readonly signerFingerprint: string;
  /** `sha256(project secret)` hex — the committed, non-reversible id. */
  readonly projectHmacId: string;
  /**
   * The cut: the number of chained events dropped, 0-based one-past-the-last
   * dropped index. The dropped prefix is `[0, cut)`; the surviving chain now
   * begins at chained index `cut`, which becomes the re-baselined genesis.
   */
  readonly cut: number;
  /**
   * Hex of the content anchor digest over the dropped prefix `[0, cut)`. This
   * IS the re-baselined genesis's `prev_hash` — the surviving chain is bound
   * to it. Recomputable from the dropped content while it exists; after the
   * prune it is preserved only here.
   */
  readonly anchorDigest: string;
  /**
   * `hash` of the last dropped event (index `cut - 1`) — the head of the
   * pruned prefix. The surviving genesis's `prev_hash` field on disk still
   * carries this value, so binding it here lets the walk confirm the surviving
   * genesis chains to exactly the prefix this waiver covers.
   */
  readonly prunedHeadHash: string;
  /**
   * `hash` of the first surviving event (index `cut`) — the new genesis. Binds
   * the waiver to a specific surviving chain, so a waiver for one prune cannot
   * be replayed to launder a deeper, different truncation.
   */
  readonly genesisHash: string;
  /** Base64 Ed25519 signature over the {@link computePruneSignInput} bytes. */
  readonly signature: string;
  /** When the waiver was written (informational only). */
  readonly acceptedAt: string;
}

/**
 * A well-formed cut: a non-negative safe integer strictly greater than 0
 * (pruning zero events is a no-op that must never write a waiver). `cut` feeds
 * {@link be64}, whose `writeBigUInt64BE` throws on a negative value, so the
 * guard keeps a malformed cut from surfacing as a cryptic `RangeError`.
 */
function isValidCut(cut: number): boolean {
  return Number.isSafeInteger(cut) && cut > 0;
}

/** Big-endian unsigned 64-bit encoding of the cut index. */
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
 * The content anchor digest over the dropped prefix `[0, cut)`. Reuses the
 * attestation layer's keyless leaf and boundary-binding root, so the digest is
 * recomputable from the dropped events' own bytes exactly as an anonymous
 * verifier would — while the content still exists. After the prune, this digest
 * is preserved in the committed waiver and stands in for the deleted content.
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
 * Every variable-length field carries a `BE32` length; the fixed-width `cut`
 * and 32-byte anchor digest need none.
 *
 * `SIGN_INPUT = "mnema-prune/v1\0" || BE32(len id)||id
 *               || BE32(len fingerprint)||fingerprint || BE64(cut)
 *               || BE32(len prunedHead)||prunedHead
 *               || BE32(len genesis)||genesis || 0x00||anchorDigest`
 *
 * `signerFingerprint` is bound so the signature commits to WHICH key signed it:
 * without this, any holder of any committed `.pub` could re-sign the identical
 * digest with their own key and re-point `signerFingerprint`, silently taking
 * over the waiver (the committed `.pub` set is the anonymous-verify allowlist).
 * The cut, pruned head, and genesis are bound alongside the digest so a
 * rollback that lies about the boundary, replays the waiver against a different
 * surviving chain, or claims a different cut fails verification.
 *
 * @param projectHmacId - The committed `sha256(secret)` id
 * @param signerFingerprint - Full fingerprint of the signer's public key
 * @param cut - The dropped-prefix length (one-past-last-dropped index)
 * @param prunedHeadHash - `hash` of the last dropped event (index `cut - 1`)
 * @param genesisHash - `hash` of the first surviving event (index `cut`)
 * @param anchorDigest - The 32-byte digest from {@link computeAnchorDigest}
 */
export function computePruneSignInput(
  projectHmacId: string,
  signerFingerprint: string,
  cut: number,
  prunedHeadHash: string,
  genesisHash: string,
  anchorDigest: Buffer,
): Buffer {
  const id = Buffer.from(projectHmacId, 'utf-8');
  const fingerprint = Buffer.from(signerFingerprint, 'utf-8');
  const prunedHead = Buffer.from(prunedHeadHash, 'utf-8');
  const genesis = Buffer.from(genesisHash, 'utf-8');
  return Buffer.concat([
    Buffer.from(`${PRUNE_VERSION}\0`, 'utf-8'),
    be32(id.length),
    id,
    be32(fingerprint.length),
    fingerprint,
    be64(cut),
    be32(prunedHead.length),
    prunedHead,
    be32(genesis.length),
    genesis,
    SEP,
    anchorDigest,
  ]);
}

/**
 * Builds the signed prune waiver. Pure: the caller supplies the dropped events
 * (read off disk before deletion) and a signing function, so this never
 * touches the filesystem or the machine key directly.
 *
 * @throws If the cut is malformed, the event count does not match the cut, or
 *   a boundary event carries no hash
 */
export function buildPruneWaiver(params: {
  droppedEvents: readonly AuditEvent[];
  genesisHash: string;
  signerActor: string;
  signerFingerprint: string;
  projectHmacId: string;
  acceptedAt: string;
  sign: (message: Buffer) => Buffer;
}): PruneWaiver {
  const {
    droppedEvents,
    genesisHash,
    signerActor,
    signerFingerprint,
    projectHmacId,
    acceptedAt,
    sign,
  } = params;
  const cut = droppedEvents.length;
  if (!isValidCut(cut)) {
    throw new Error(`malformed prune cut ${cut} (nothing to prune)`);
  }
  const prunedHeadHash = droppedEvents[cut - 1]?.hash;
  if (typeof prunedHeadHash !== 'string') {
    throw new Error(`pruned head event at index ${cut - 1} has no hash`);
  }
  if (typeof genesisHash !== 'string' || genesisHash.length === 0) {
    throw new Error('surviving genesis event has no hash');
  }
  const anchorDigest = computeAnchorDigest(droppedEvents);
  const signature = sign(
    computePruneSignInput(
      projectHmacId,
      signerFingerprint,
      cut,
      prunedHeadHash,
      genesisHash,
      anchorDigest,
    ),
  );
  return {
    version: PRUNE_VERSION,
    signerActor,
    signerFingerprint,
    projectHmacId,
    cut,
    anchorDigest: anchorDigest.toString('hex'),
    prunedHeadHash,
    genesisHash,
    signature: signature.toString('base64'),
    acceptedAt,
  };
}

/** Verdict of {@link verifyPruneWaiver}: verified, mismatch, or cannot-verify. */
export type PruneVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string; readonly cannotVerify?: boolean };

/**
 * Verifies a prune waiver against the surviving genesis on disk and the
 * committed public key of its signer, with NO secret.
 *
 * Because the dropped content is GONE, this cannot recompute `anchorDigest` —
 * it trusts the committed signature over it. So verification rests on TWO
 * external invariants this function enforces, plus one it re-checks on disk:
 *
 * 1. PROJECT PIN (`expectedProjectHmacId`): the waiver's `projectHmacId` must
 *    equal this project's own committed `sha256(secret)`. Without it a waiver
 *    minted in project X — whose signature verifies against X's committed key —
 *    would verify unchanged in project Y (the signature is over the waiver's
 *    OWN id). Mirrors `contentAttestationCheck`, but load-bearing here because
 *    there is no on-disk content to re-derive as a second binding.
 * 2. SIGNER BIND: `signerFingerprint` is folded into the signed bytes
 *    ({@link computePruneSignInput}), so the signature commits to which key
 *    signed — a rogue holder of another committed `.pub` cannot re-sign the
 *    same digest and re-point the signer.
 * 3. GENESIS RE-CHECK: the surviving genesis on disk (`observedGenesisHash`)
 *    must be the one the waiver was signed for, so an OLD waiver cannot be
 *    replayed against a deeper, different truncation.
 *
 * This establishes AUTHORIZATION ("a trusted, project-bound key vouched for a
 * prune to this genesis"), not an absolute lower bound on how much history
 * existed — `cut` and `anchorDigest` are values the signer chose and cannot be
 * re-derived once content is gone. The guarantee therefore assumes the
 * committed `.pub` set is an authenticated allowlist.
 *
 * Returns `cannotVerify: true` (not a tamper verdict) when the signer's `.pub`
 * cannot be resolved, mirroring the attestation layer's fail-safe posture.
 *
 * @param waiver - The waiver to verify
 * @param observedGenesisHash - `hash` of the first surviving event on disk now
 * @param expectedProjectHmacId - This project's committed `sha256(secret)` id,
 *   or `null` when the project committed no fingerprint (nothing to pin
 *   against — the missing anchor is warned elsewhere)
 * @param resolvePublicKeyPem - Resolves a signer's public key PEM by FULL
 *   fingerprint, or `null` when absent
 */
export function verifyPruneWaiver(
  waiver: PruneWaiver,
  observedGenesisHash: string,
  expectedProjectHmacId: string | null,
  resolvePublicKeyPem: (fingerprint: string) => string | null,
): PruneVerdict {
  try {
    if (waiver.version !== PRUNE_VERSION) {
      return { ok: false, reason: `unknown prune waiver version ${waiver.version}` };
    }
    if (!isValidCut(waiver.cut)) {
      return { ok: false, reason: `malformed prune cut ${waiver.cut}` };
    }
    // Project pin: a foreign waiver's signature verifies against its own
    // committed key, so projectHmacId is the only thing tying it to THIS
    // project. Skipped only when the project committed no fingerprint.
    if (expectedProjectHmacId != null && waiver.projectHmacId !== expectedProjectHmacId) {
      return {
        ok: false,
        reason: `prune waiver carries project id …${waiver.projectHmacId.slice(0, 12)}, but this project's committed fingerprint is …${expectedProjectHmacId.slice(0, 12)} — the waiver is for a different project`,
      };
    }
    // The genesis on disk NOW must be the one the waiver was signed for. A
    // deeper truncation would move the genesis, and this check refuses to let
    // the old waiver cover it.
    if (observedGenesisHash !== waiver.genesisHash) {
      return {
        ok: false,
        reason: `surviving genesis ${observedGenesisHash.slice(0, 12)} does not match the waiver (${waiver.genesisHash.slice(0, 12)}) — a truncation deeper than the accepted prune`,
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
    const signInput = computePruneSignInput(
      waiver.projectHmacId,
      waiver.signerFingerprint,
      waiver.cut,
      waiver.prunedHeadHash,
      waiver.genesisHash,
      anchorDigest,
    );
    const verified = MachineKeyService.verify(
      signInput,
      Buffer.from(waiver.signature, 'base64'),
      pem,
    );
    return verified
      ? { ok: true }
      : { ok: false, reason: `prune waiver signature does not verify` };
  } catch (error) {
    return {
      ok: false,
      cannotVerify: true,
      reason: `cannot verify prune waiver: ${(error as Error).message}`,
    };
  }
}

/** Serialises a waiver to committed JSON (pretty, trailing newline). */
export function serializePruneWaiver(waiver: PruneWaiver): string {
  return `${JSON.stringify(waiver, null, 2)}\n`;
}

/**
 * Parses and structurally validates a committed prune waiver. Rejects a record
 * whose version is wrong or whose cut is malformed; leaves cryptographic
 * verification to {@link verifyPruneWaiver}.
 *
 * @throws If the JSON is malformed or the record is structurally invalid
 */
export function parsePruneWaiver(json: string): PruneWaiver {
  const raw = JSON.parse(json) as Partial<PruneWaiver>;
  if (raw.version !== PRUNE_VERSION) {
    throw new Error('not a mnema-prune/v1 waiver');
  }
  // Non-empty checks mirror buildPruneWaiver's own preconditions, so a
  // hand-authored file cannot rely on empty-string degeneracies (an empty
  // genesisHash would make the disk re-check `'' === ''` trivially pass — the
  // signature must still verify, but the parse path should not admit the
  // shape at all).
  if (
    typeof raw.signerActor !== 'string' ||
    typeof raw.signerFingerprint !== 'string' ||
    typeof raw.projectHmacId !== 'string' ||
    typeof raw.anchorDigest !== 'string' ||
    raw.anchorDigest.length === 0 ||
    typeof raw.prunedHeadHash !== 'string' ||
    raw.prunedHeadHash.length === 0 ||
    typeof raw.genesisHash !== 'string' ||
    raw.genesisHash.length === 0 ||
    typeof raw.signature !== 'string' ||
    !isValidCut(raw.cut as number)
  ) {
    throw new Error('malformed prune waiver');
  }
  return {
    version: PRUNE_VERSION,
    signerActor: raw.signerActor,
    signerFingerprint: raw.signerFingerprint,
    projectHmacId: raw.projectHmacId,
    cut: raw.cut as number,
    anchorDigest: raw.anchorDigest,
    prunedHeadHash: raw.prunedHeadHash,
    genesisHash: raw.genesisHash,
    signature: raw.signature,
    acceptedAt: typeof raw.acceptedAt === 'string' ? raw.acceptedAt : '',
  };
}
