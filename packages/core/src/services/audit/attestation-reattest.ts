import { type AttestationArtifact, verifyArtifact } from './attestation-artifact.js';
import type { AttestationSigner } from './attestation-emitter.js';
import { emitAttestation, emitAttestationFromEvents } from './attestation-emitter.js';
import type { AuditChainWalk } from './audit-chain-walk.js';

/**
 * Inputs for {@link planReattestIncremental}. Unlike {@link ReattestInput},
 * `walk` here covers ONLY the tail `[coveredTo, headCount)` (with absolute
 * indices), and `headCount` carries the whole-chain length separately — the
 * caller obtains it from `audit_state.event_count`, not by walking the log.
 */
export interface IncrementalReattestInput {
  /** The chained tail on disk, indexed absolutely (see `walkChainedTail`). */
  readonly walk: AuditChainWalk;
  /** On-disk chained count (the head high-water mark). */
  readonly headCount: number;
  /** Existing committed `.att`s (any order; sorted internally). */
  readonly existing: readonly AttestationArtifact[];
  /** The signer for NEW batches, or `null` when no identity is resolvable. */
  readonly signer: AttestationSigner | null;
  /** The committed `sha256(secret)` id, or `null` when not committed. */
  readonly projectHmacId: string | null;
  /** Whether the whole on-disk chain is sound enough to attest. */
  readonly chainHealthy: boolean;
  /** Highest `event_count` under a valid signed checkpoint, or `null`. */
  readonly signedEventCountAt: number | null;
  /** Batch size for the tail; defaults to {@link DEFAULT_BATCH}. */
  readonly batchSize?: number;
}

/**
 * The incremental counterpart to {@link planReattest} for the auto-attestation
 * hot path. It attests ONLY the tail `[coveredTo, headCount)` — where
 * `coveredTo` is the highest `to` of the existing contiguous `.att` prefix —
 * instead of re-walking and re-verifying the whole chain every checkpoint.
 *
 * Same fail-closed refusals as {@link planReattest} for everything that bears
 * on the batch being signed:
 *
 * - `chainHealthy` false — the whole-chain integrity check (resolved by the
 *   caller) failed, so an interior tamper is already caught and we refuse;
 * - malformed / unhashed lines IN THE TAIL — a corrupt line inside the batch
 *   we would sign;
 * - the disk chain retreated below a signed checkpoint (truncation);
 * - the existing `.att` set is discontiguous, overlapping, or reaches past the
 *   on-disk head — a structurally inconsistent committed set;
 * - there is a tail to emit but no resolvable signer / project fingerprint.
 *
 * It deliberately does NOT re-verify the CRYPTO of every already-committed
 * `.att` on each checkpoint — that is the O(n) cost being removed. A tampered
 * committed `.att` is still caught at verify time (`buildContentAttestation`,
 * `audit verify`, `doctor`) and by the manual `reattest`, which keeps the full
 * walk. The emitted artifacts are byte-identical to what the full-walk plan
 * would emit for the same tail, so verifying the whole chain afterwards yields
 * the identical verdict.
 *
 * @param input - The tail walk, head count, existing artifacts, and signals
 * @returns The plan to apply (emit batches), or a structured refusal
 */
export function planReattestIncremental(input: IncrementalReattestInput): ReattestPlan {
  const { walk, headCount, existing, signer, projectHmacId } = input;

  if (!input.chainHealthy) {
    return {
      ok: false,
      reason: 'on-disk chain is not internally consistent — reattesting would hide tampering',
    };
  }
  if (walk.malformedLines > 0) {
    return {
      ok: false,
      reason: `${walk.malformedLines} unparseable line(s) in the tail — resolve them before reattesting`,
    };
  }
  if (walk.unhashedLines > 0) {
    return {
      ok: false,
      reason: `${walk.unhashedLines} chained line(s) in the tail have no hash — the chain is malformed; resolve before reattesting`,
    };
  }
  if (headCount === 0) {
    return { ok: false, reason: 'no chained events on disk yet — nothing to attest' };
  }
  if (input.signedEventCountAt !== null && headCount < input.signedEventCountAt) {
    return {
      ok: false,
      reason: `a signed checkpoint attests event ${input.signedEventCountAt}, but the disk chain holds only ${headCount} — this looks like a truncation, not missing attestations`,
    };
  }

  // Structural validation of the committed `.att` prefix: it must be a
  // gap-free, non-overlapping prefix that does not reach past the on-disk head.
  // This is the same contiguity/overlap/in-bounds guard the full planner runs,
  // minus the per-artifact crypto re-verification (deferred to verify time).
  const sorted = [...existing].sort((a, b) => a.from - b.from);
  let coveredTo = 0;
  for (const art of sorted) {
    if (art.from !== coveredTo) {
      return {
        ok: false,
        reason: `committed attestations are discontiguous: expected a batch starting at ${coveredTo}, found [${art.from}, ${art.to})`,
      };
    }
    if (art.to > headCount) {
      return {
        ok: false,
        reason: `attestation [${art.from}, ${art.to}) covers events not present on disk (chain holds ${headCount})`,
      };
    }
    coveredTo = art.to;
  }

  const toEmit: PlannedBatch[] = [];
  const artifacts: AttestationArtifact[] = [];
  if (coveredTo < headCount) {
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
    // The tail walk must actually hold the events we are about to slice. If it
    // does not reach `coveredTo`, the head count and disk disagree — refuse
    // rather than emit over a short read.
    const firstTail = walk.chained[0];
    const firstTailIndex = firstTail === undefined ? headCount : firstTail.index;
    if (firstTailIndex > coveredTo) {
      return {
        ok: false,
        reason: `tail walk starts at ${firstTailIndex} but the unattested batch begins at ${coveredTo} — refusing to emit over a short read`,
      };
    }
    // Index the tail events by their absolute chained index for O(1) slicing.
    const byIndex = new Map<number, AuditChainWalk['chained'][number]['event']>();
    for (const c of walk.chained) byIndex.set(c.index, c.event);
    const batchSize = input.batchSize ?? DEFAULT_BATCH;
    try {
      for (let from = coveredTo; from < headCount; from += batchSize) {
        const to = Math.min(from + batchSize, headCount);
        const events: AuditChainWalk['chained'][number]['event'][] = [];
        for (let i = from; i < to; i += 1) {
          const ev = byIndex.get(i);
          if (ev === undefined) {
            return {
              ok: false,
              reason: `tail walk is missing event ${i} for batch [${from}, ${to}) — refusing to emit over a short read`,
            };
          }
          events.push(ev);
        }
        artifacts.push(emitAttestationFromEvents(events, from, to, signer, projectHmacId));
        toEmit.push({ from, to, action: 'emit', signerActor: signer.actor });
      }
    } catch (error) {
      return { ok: false, reason: `failed to emit attestation: ${(error as Error).message}` };
    }
  }

  return { ok: true, planned: toEmit, artifacts };
}

/**
 * Default batch size a fresh attestation covers when backfilling, used when
 * the caller does not pass one. Mirrors the `audit.checkpoint.events` default
 * so a backfilled `.att` lines up with the checkpoint cadence; the caller
 * should pass the RESOLVED config value via {@link ReattestInput.batchSize}.
 */
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
   * `true` only when the on-disk chain is sound ENOUGH to attest. The caller
   * MUST treat the truncation-shaped warnings from `inspectAuditIntegrity`
   * (the "mirror one ahead of disk / truncated last line" count and hash-chain
   * checks) as BLOCKING here — a naive `every(c => c.severity !== 'error')`
   * would pass a truncated tail and let this planner re-sign it. `false`
   * refuses the whole run.
   */
  readonly chainHealthy: boolean;
  /**
   * Highest `event_count` covered by a valid signed checkpoint, or `null`.
   * A disk chain SHORTER than this is a truncation and refuses the run. NOTE:
   * this is `null` for an anonymous clone (the checkpoint lives in gitignored
   * SQLite), so it defends the local machine, not the public verifier — tail
   * truncation past the last committed `.att` is a known residual (ADR-41).
   */
  readonly signedEventCountAt: number | null;
  /**
   * Batch size for backfilling the unattested tail. Should be the resolved
   * `audit.checkpoint.events` so `.att` boundaries track the checkpoint
   * cadence; defaults to {@link DEFAULT_BATCH} when omitted.
   */
  readonly batchSize?: number;
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
  const { walk, existing, resolvePublicKeyPem, signer, projectHmacId } = input;

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
  if (walk.unhashedLines > 0) {
    // A keyed line with no `hash` cannot be attested (its leaf/head derivation
    // needs it). Refuse cleanly rather than let the emitter throw on it.
    return {
      ok: false,
      reason: `${walk.unhashedLines} chained line(s) on disk have no hash — the chain is malformed; resolve before reattesting`,
    };
  }

  const total = walk.chained.length;
  if (total === 0) {
    return { ok: false, reason: 'no chained events on disk yet — nothing to attest' };
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

  // What is left to attest is the tail past the last covered event. Interior
  // gaps cannot occur: the contiguity check above already rejected any
  // existing set that was not a gap-free prefix.
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
    const batchSize = input.batchSize ?? DEFAULT_BATCH;
    // Emit the tail in fixed-size batches so a huge backlog does not become one
    // giant artifact; the last batch is whatever remains. Wrap the emit in a
    // guard so a signing failure surfaces as a structured refusal, never an
    // uncaught throw out of this fail-closed planner.
    try {
      for (let from = coveredTo; from < total; from += batchSize) {
        const to = Math.min(from + batchSize, total);
        artifacts.push(emitAttestation(walk, from, to, signer, projectHmacId));
        toEmit.push({ from, to, action: 'emit', signerActor: signer.actor });
      }
    } catch (error) {
      return { ok: false, reason: `failed to emit attestation: ${(error as Error).message}` };
    }
  }

  return { ok: true, planned: [...preserved, ...toEmit], artifacts };
}
