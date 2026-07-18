import path from 'node:path';

import type { AcceptedRebaseline } from '../integrity/audit-integrity.js';
import { readCommittedProjectHmacId } from '../integrity/project-secret.js';
import { committedSignerResolver } from './attestation-store.js';
import { walkChainedEvents } from './audit-chain-walk.js';
import { readRebaselineWaiver } from './rebaseline-store.js';
import { verifyRebaselineWaiver } from './rebaseline-waiver.js';

/**
 * Builds the per-tail re-baseline resolver the integrity walk consumes: given a
 * tail directory, it reads that tail's committed waiver, VERIFIES it (signature,
 * project pin, tail pin, on-disk head match — no secret), and returns the two
 * boundary hashes the walk needs to accept the moved genesis, or `null` when
 * there is no waiver or it does not verify.
 *
 * This is the wiring that was missing: without it the walk always treated a
 * pruned tail's absent prior segment as a `prev_hash` break, so a legitimate
 * `mnema audit prune` read as tamper in every `doctor`/`verify`. The walk stays
 * pure — it never touches the waiver file or crypto; all of that happens here,
 * once per tail, and only the pre-verified boundary is handed on.
 *
 * ONLY a `prune` waiver moves the genesis (it deletes the oldest prefix, so the
 * surviving genesis's `prev_hash` points at a hash no longer on disk). A
 * `truncation` waiver retreats the TAIL and leaves the genesis intact, so it
 * produces no `AcceptedRebaseline` — the shortened chain is already internally
 * consistent; the head-signature check is what vouches for that retreat.
 *
 * @param projectRoot - Absolute project root (holds `.mnema/keys/` for the
 *   committed `.pub` trust anchor)
 * @param projectHmacId - This project's committed `sha256(secret)` id, or
 *   `null` when none is committed (the project pin is skipped)
 * @param resolvePublicKeyPem - Resolver from a signer fingerprint to its PEM
 *   (the committed-`.pub` allowlist)
 * @returns A resolver `(tailDir) => AcceptedRebaseline | null`
 */
export function buildRebaselineResolver(
  projectHmacId: string | null,
  resolvePublicKeyPem: (fingerprint: string) => string | null,
): (tailDir: string) => AcceptedRebaseline | null {
  return (tailDir: string): AcceptedRebaseline | null => {
    const waiver = readRebaselineWaiver(tailDir);
    if (waiver === null || waiver.kind !== 'prune') return null;

    // The surviving genesis on disk NOW — the first chained event of the tail.
    const genesis = walkChainedEvents(tailDir).chained[0];
    const observedGenesisHash = typeof genesis?.event.hash === 'string' ? genesis.event.hash : '';
    if (observedGenesisHash.length === 0) return null;

    const tailId = path.basename(tailDir);
    const verdict = verifyRebaselineWaiver(
      waiver,
      observedGenesisHash,
      tailId,
      projectHmacId,
      resolvePublicKeyPem,
    );
    if (!verdict.ok) return null;

    // The walk matches the surviving genesis's on-disk `prev_hash` against the
    // pruned head, and its `hash` against the new baseline head (the genesis).
    return { anchorPrevHash: waiver.prunedHeadHash, genesisHash: waiver.newHeadHash };
  };
}

/**
 * Convenience: builds the re-baseline resolver from a project root, wiring the
 * committed project fingerprint and the committed-`.pub` signer allowlist. The
 * single place the verify/recovery surfaces assemble the resolver, so a change
 * to what a waiver is verified against has one site to touch.
 *
 * @param projectRoot - Absolute project root (holds `.mnema/keys/`)
 * @returns A resolver `(tailDir) => AcceptedRebaseline | null`
 */
export function rebaselineResolverFor(
  projectRoot: string,
): (tailDir: string) => AcceptedRebaseline | null {
  return buildRebaselineResolver(
    readCommittedProjectHmacId(projectRoot),
    committedSignerResolver(projectRoot),
  );
}
