import { type AttestationArtifact, verifyArtifact } from './attestation-artifact.js';
import type { AttestationSigner } from './attestation-emitter.js';
import { emitAttestation } from './attestation-emitter.js';
import type { AuditChainWalk } from './audit-chain-walk.js';

/** The batch size a fresh attestation covers when backfilling. */
export const DEFAULT_BATCH = 100;

/** One batch the plan would emit (a NEW `.att`) or preserve (an existing one). */
export interface PlannedBatch {
  readonly from: number;
  readonly to: number;
  /** `emit` = this run signs it; `preserve` = an existing verifying `.att`. */
  readonly action: 'emit' | 'preserve';
  /** For a preserved batch, the actor whose committed key signed it. */
  readonly signerActor?: string;
}

/** Outcome of {@link planReattest}: a plan to apply, or a refusal. */
export type ReattestPlan =
  | {
      readonly ok: true;
      readonly planned: readonly PlannedBatch[];
      /** Artifacts to write (the `emit` batches, already signed). */
      readonly artifacts: readonly AttestationArtifact[];
    }
  | { readonly ok: false; readonly reason: string };

/**
 * Inputs for {@link planReattest}. The caller resolves chain health via
 * `inspectAuditIntegrity` (single source of truth for "is the chain sound") so
 * this module never re-verifies the hash chain itself — it plans attestation
 * over a chain someone else already vouched for.
 */
export interface ReattestInput {
  /** The chained events on disk, indexed. */
  readonly walk: AuditChainWalk;
  /** Existing committed `.att`s (ascending by `to`). */
  readonly existing: readonly AttestationArtifact[];
  /** Resolves a signer's public key PEM by FULL fingerprint. */
  readonly resolvePublicKeyPem: (fingerprint: string) => string | null;
  /** The signer for NEW batches, or `null` when no identity is resolvable. */
  readonly signer: AttestationSigner | null;
  /** The committed `sha256(secret)` id, or `null` when not committed. */
  readonly projectHmacId: string | null;
  /**
   * `true` when `inspectAuditIntegrity` reported NO error-severity check — the
   * chain is internally consistent. `false` refuses the whole run.
   */
  readonly chainHealthy: boolean;
  /**
   * Highest `event_count` covered by a valid signed checkpoint, or `null`.
   * A disk chain SHORTER than this is a truncation and refuses the run.
   */
  readonly signedEventCountAt: number | null;
  /** When true, also fill interior gaps between/ before existing `.att`s. */
  readonly all: boolean;
}

/**
 * Plans a reattest over the on-disk chain, FAIL-CLOSED: it refuses (signs
 * nothing) on any sign of real tampering rather than papering over it. The
 * refusals mirror `reconcileAuditState`'s posture:
 *
 * - the chain is not internally consistent (`chainHealthy` false) — reattesting
 *   would bless a broken chain;
 * - malformed lines are present — a possible smokescreen for a deletion;
 * - an existing `.att` does not verify — never overwrite it, and never emit
 *   around a corrupt attestation;
 * - existing `.att`s are discontiguous or overlap — the committed set is
 *   already inconsistent;
 * - the disk chain retreated below a signed checkpoint — a truncation the
 *   attestation layer exists to catch;
 * - there is a batch to emit but no resolvable signer/identity — refuse loudly
 *   rather than skip silently (unlike the opportunistic checkpoint).
 *
 * On success it returns the batches to emit (already signed) and the ones to
 * preserve; the caller writes the artifacts (or, in dry-run, just reports).
 *
 * @param input - The walk, existing artifacts, signer, and health signals
 * @returns The plan to apply, or a structured refusal
 */
export function planReattest(input: ReattestInput): ReattestPlan {
  const { walk, existing, resolvePublicKeyPem, signer, projectHmacId, all } = input;

  if (!input.chainHealthy) {
    return {
      ok: false,
      reason: 'on-disk chain is not internally consistent — reattesting would hide tampering',
    };
  }
  if (walk.malformedLines > 0) {
    return {
      ok: false,
      reason: `${walk.malformedLines} unparseable line(s) on disk — resolve them before reattesting`,
    };
  }

  const total = walk.chained.length;
  if (total === 0) {
    return { ok: false, reason: 'no chained (v>=2) events on disk yet — nothing to attest' };
  }
  if (input.signedEventCountAt !== null && total < input.signedEventCountAt) {
    return {
      ok: false,
      reason: `a signed checkpoint attests event ${input.signedEventCountAt}, but the disk chain holds only ${total} — this looks like a truncation, not missing attestations`,
    };
  }

  // Validate + preserve existing artifacts, and record which ranges are
  // already covered. They must be contiguous, non-overlapping, in-bounds, and
  // each must verify against a committed key.
  const sorted = [...existing].sort((a, b) => a.from - b.from);
  const preserved: PlannedBatch[] = [];
  let coveredTo = 0;
  for (const art of sorted) {
    if (art.from !== coveredTo) {
      return {
        ok: false,
        reason: `committed attestations are discontiguous: expected a batch starting at ${coveredTo}, found [${art.from}, ${art.to})`,
      };
    }
    if (art.to > total) {
      return {
        ok: false,
        reason: `attestation [${art.from}, ${art.to}) covers events not present on disk (chain holds ${total})`,
      };
    }
    const events = walk.chained.slice(art.from, art.to).map((c) => c.event);
    const verdict = verifyArtifact(art, events, resolvePublicKeyPem);
    if (!verdict.ok) {
      // A cannot-attest (missing .pub) is still a refusal here: reattest must
      // not emit around an artifact it cannot confirm, or it could launder a
      // swapped key. The operator resolves the key first.
      return {
        ok: false,
        reason: `existing attestation [${art.from}, ${art.to}) does not verify: ${verdict.reason}`,
      };
    }
    preserved.push({
      from: art.from,
      to: art.to,
      action: 'preserve',
      signerActor: art.signerActor,
    });
    coveredTo = art.to;
  }

  // What is left to attest. Without --all we only extend the tail past the last
  // covered event; with --all we would also fill any interior gap — but the
  // contiguity check above already rejects interior gaps in the EXISTING set,
  // so the only gap that can remain is the tail. `all` therefore currently
  // differs only in intent for future multi-gap layouts; the tail is the gap.
  void all;
  const toEmit: PlannedBatch[] = [];
  const artifacts: AttestationArtifact[] = [];
  if (coveredTo < total) {
    if (signer === null) {
      return {
        ok: false,
        reason:
          'events are unattested but no signing identity is resolvable — configure an identity (mnema identity set) before reattesting',
      };
    }
    if (projectHmacId === null) {
      return {
        ok: false,
        reason:
          'no committed project fingerprint (.mnema/keys/project.hmac-id) to bind the attestation to',
      };
    }
    // Emit the tail in fixed-size batches so a huge backlog does not become one
    // giant artifact; the last batch is whatever remains.
    for (let from = coveredTo; from < total; from += DEFAULT_BATCH) {
      const to = Math.min(from + DEFAULT_BATCH, total);
      artifacts.push(emitAttestation(walk, from, to, signer, projectHmacId));
      toEmit.push({ from, to, action: 'emit', signerActor: signer.actor });
    }
  }

  return { ok: true, planned: [...preserved, ...toEmit], artifacts };
}
