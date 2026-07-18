import { rmSync } from 'node:fs';
import path from 'node:path';

import type { AuditEvent } from '../../storage/audit/audit-writer.js';
import { walkChainedEvents } from './audit-chain-walk.js';
import { removeCoveredAtts } from './prune-att-lockstep.js';
import { writeRebaselineWaiver } from './rebaseline-store.js';
import { buildPruneWaiver, type RebaselineWaiver } from './rebaseline-waiver.js';
import type { CutPoint } from './retention-cut-point.js';

/**
 * The plan a prune apply would execute, computed WITHOUT touching disk so the
 * dry-run path can report it and every gate can run before anything
 * destructive happens.
 */
export interface PrunePlan {
  /**
   * The cut: the chained-event index the prune drops below (`[0, cut)` goes).
   * Equals `droppedEvents.length`; carried explicitly so the `.att` / anchor
   * lockstep gates address the same boundary without re-deriving it.
   */
  readonly cut: number;
  /** The dropped events `[0, cut)`, in chain order (needed to sign the waiver). */
  readonly droppedEvents: readonly AuditEvent[];
  /** `hash` of the first surviving event (the new genesis). */
  readonly genesisHash: string;
  /** `hash` of the last surviving event (the new head after reconcile). */
  readonly survivingHeadHash: string;
  /** `at` of the last surviving event, for the reconcile. */
  readonly survivingHeadAt: string | null;
  /** The count the audit_state event_count reconciles down to. */
  readonly keptEventCount: number;
}

/** Raised when the on-disk chain does not match what the cut point assumed. */
export class PrunePlanError extends Error {}

/**
 * Builds the prune plan from a cut point by walking the chained events on
 * disk. Pure and read-only. Refuses (throws {@link PrunePlanError}) when the
 * on-disk chain cannot support the cut — a malformed/unhashed boundary event,
 * or a chained count that disagrees with the cut point (a chain that changed
 * under the cut computation). The apply step never runs on a refused plan.
 *
 * @param auditDir - Absolute path to `.mnema/audit/`
 * @param cut - The cut point from {@link computeCutPoint}
 */
export function buildPrunePlan(auditDir: string, cut: CutPoint): PrunePlan {
  if (!cut.hasCut) {
    throw new PrunePlanError('nothing to prune (no cut)');
  }
  const walk = walkChainedEvents(auditDir);
  if (walk.malformedLines > 0) {
    throw new PrunePlanError(
      `${walk.malformedLines} unparseable line(s) on disk — resolve those before pruning`,
    );
  }
  if (walk.unhashedLines > 0) {
    throw new PrunePlanError(
      `${walk.unhashedLines} chained line(s) carry no hash — cannot compute a prune anchor`,
    );
  }
  const total = walk.chained.length;
  const cutIndex = cut.keepFromIndex;
  // The cut point counted segments; the walk counts events. They must agree,
  // or the chain changed between the two reads — refuse rather than prune the
  // wrong boundary.
  if (cut.keptEventCount + cutIndex !== total) {
    throw new PrunePlanError(
      `cut point (${cutIndex} dropped + ${cut.keptEventCount} kept) disagrees with the ${total} chained events on disk — the chain changed; recompute the cut`,
    );
  }
  if (cutIndex <= 0 || cutIndex >= total) {
    throw new PrunePlanError(`cut index ${cutIndex} is out of range for ${total} chained events`);
  }

  const droppedEvents = walk.chained.slice(0, cutIndex).map((c) => c.event);
  const genesis = walk.chained[cutIndex]?.event;
  const survivingHead = walk.chained[total - 1]?.event;
  const genesisHash = genesis?.hash;
  const survivingHeadHash = survivingHead?.hash;
  if (typeof genesisHash !== 'string' || typeof survivingHeadHash !== 'string') {
    throw new PrunePlanError('surviving boundary event carries no hash');
  }

  return {
    cut: cutIndex,
    droppedEvents,
    genesisHash,
    survivingHeadHash,
    survivingHeadAt: typeof survivingHead?.at === 'string' ? survivingHead.at : null,
    keptEventCount: cut.keptEventCount,
  };
}

/**
 * Applies a prune plan destructively, in the fail-closed order the
 * accept-truncation recovery command established, generalised from "recover
 * from a truncated tail" to "delete a pruned prefix":
 *
 * 1. Build and SIGN the prune waiver over the dropped prefix — while its
 *    content is still on disk, so the anchor digest is recomputable.
 * 2. Delete the dropped segment files.
 * 3. Reconcile `audit_state.event_count` down to the surviving count.
 * 4. Re-sign the head at the new (lower) count.
 * 5. Write the committed waiver LAST — after the reconcile and re-sign, so a
 *    failure mid-apply never leaves a waiver pointing at a state the DB and
 *    signature have not caught up to.
 *
 * Pure of policy: the caller (the `mnema audit prune` command) runs every gate
 * — strategy is destructive, chain is healthy, no `.att`/anchor straddles the
 * cut — BEFORE calling this. This performs the mechanical apply only.
 *
 * @param params.auditDir - Absolute path to `.mnema/audit/`
 * @param params.plan - The plan from {@link buildPrunePlan}
 * @param params.droppedFiles - Absolute paths of the segment files to delete
 *   (the cut point's `dropped[].file`)
 * @param params.attToRemove - Absolute paths of committed `.att` files to
 *   delete in the SAME destructive pass (from the `.att` lockstep decision),
 *   so no attestation is ever left over a removed tail. The command gates on
 *   the lockstep NOT being blocked before calling this.
 * @param params.signerActor - The actor handle owning the signing key
 * @param params.signerFingerprint - Full fingerprint of the signer's key
 * @param params.projectHmacId - The committed `sha256(secret)` id
 * @param params.sign - Signs the waiver's sign-input bytes
 * @param params.forceReconcile - Re-points audit_state to the surviving tail
 * @param params.reSignHead - Re-signs the head at the new count; returns
 *   whether a signer was available
 * @param params.deleteAnchorsBelow - Deletes committed anchor rows whose
 *   `event_count_at` is at or below the cut (their receipts covered a removed
 *   head), in the SAME destructive pass; returns the count removed. Optional —
 *   omitted when anchoring is off. Unlike `.att`, a surviving anchor is
 *   verified by its head_hash (intact on disk), so anchors ABOVE the cut need
 *   no re-basing and this never blocks.
 * @param params.now - Clock for the waiver's acceptedAt (injectable for tests)
 * @returns The written waiver, whether the head was re-signed, and how many
 *   anchors were removed
 */
export function applyPrune(params: {
  auditDir: string;
  plan: PrunePlan;
  droppedFiles: readonly string[];
  attToRemove?: readonly string[];
  signerActor: string;
  signerFingerprint: string;
  projectHmacId: string;
  sign: (message: Buffer) => Buffer;
  forceReconcile: (eventCount: number, headHash: string, lastAt: string | null) => void;
  reSignHead: (newHeadHash: string, newEventCount: number) => boolean;
  deleteAnchorsBelow?: (cut: number) => number;
  now: () => Date;
}): {
  readonly waiver: RebaselineWaiver;
  readonly reSigned: boolean;
  readonly anchorsRemoved: number;
} {
  const {
    auditDir,
    plan,
    droppedFiles,
    attToRemove = [],
    signerActor,
    signerFingerprint,
    projectHmacId,
    sign,
    forceReconcile,
    reSignHead,
    deleteAnchorsBelow,
    now,
  } = params;

  // 1. Sign the waiver while the dropped content still exists. `auditDir` here
  //    is this machine's tail, so its basename is the tail id bound into the
  //    signature (a prune waiver cannot be replayed against a sibling tail).
  const waiver = buildPruneWaiver({
    droppedEvents: plan.droppedEvents,
    genesisHash: plan.genesisHash,
    survivingEventCount: plan.keptEventCount,
    tailId: path.basename(auditDir),
    signerActor,
    signerFingerprint,
    projectHmacId,
    acceptedAt: now().toISOString(),
    sign,
  });

  // 2. Delete the dropped segment files AND the covered .att / anchor rows in
  //    lockstep, so no attestation or receipt is ever left over a removed tail.
  for (const file of droppedFiles) {
    rmSync(file, { force: true });
  }
  removeCoveredAtts(attToRemove);
  const anchorsRemoved = deleteAnchorsBelow?.(plan.cut) ?? 0;

  // 3. Reconcile audit_state down to the surviving tail.
  forceReconcile(plan.keptEventCount, plan.survivingHeadHash, plan.survivingHeadAt);

  // 4. Re-sign the head at the new (lower) count.
  const reSigned = reSignHead(plan.survivingHeadHash, plan.keptEventCount);

  // 5. Write the committed waiver last.
  writeRebaselineWaiver(auditDir, waiver);

  return { waiver, reSigned, anchorsRemoved };
}
