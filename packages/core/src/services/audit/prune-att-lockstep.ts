import { rmSync } from 'node:fs';

import { attestPath, listArtifacts } from './attestation-store.js';

/**
 * The `.att` lockstep decision for a prune at chained-event index `cut`
 * (ADR-68). A committed attestation covers events `[from, to)` by ABSOLUTE
 * chained index from the physical genesis, and the verifier addresses events
 * by that index (`walk.chained.slice(from, to)`), requiring contiguous
 * coverage from index 0. A prune deletes `[0, cut)` and the walk re-indexes
 * the survivors from 0, so any `.att` that covers a surviving event would have
 * a stale, now-wrong range — its `from`/`to` are baked into its signature and
 * cannot be shifted without re-signing.
 *
 * So the fail-closed rule (mirrors the accept-truncation Gate 4, generalised
 * to a prefix prune):
 *
 * - An `.att` fully inside the dropped prefix (`to <= cut`) is REMOVED in
 *   lockstep — its content is gone, leaving it would orphan coverage over a
 *   deleted tail.
 * - An `.att` that STRADDLES the cut (`from < cut < to`) or covers any
 *   surviving event (`to > cut`) BLOCKS the prune. Splitting or re-basing it
 *   would require re-signing during a destructive op — deliberately out of
 *   scope (minimise the signing surface). The operator moves the cut to a
 *   batch boundary or reconciles the `.att` first.
 */
export interface AttLockstepDecision {
  /** Absolute paths of `.att` files to remove (fully inside the dropped prefix). */
  readonly toRemove: readonly string[];
  /**
   * `true` when a committed `.att` covers a surviving event (straddles the cut
   * or sits above it) and the prune must be refused.
   */
  readonly blocked: boolean;
  /** Actionable reason when `blocked`, else `null`. */
  readonly blockReason: string | null;
}

/**
 * Decides the `.att` lockstep for a prune at `cut`, read-only. The command
 * runs this as a gate BEFORE any destructive step and refuses when `blocked`.
 *
 * @param auditDir - Absolute path to `.mnema/audit/`
 * @param cut - The chained-event index the prune drops below (`[0, cut)` goes)
 */
export function decideAttLockstep(auditDir: string, cut: number): AttLockstepDecision {
  const artifacts = listArtifacts(auditDir); // ascending by `to`
  const toRemove: string[] = [];

  for (const art of artifacts) {
    if (art.to <= cut) {
      // Fully inside the dropped prefix — remove in lockstep.
      toRemove.push(attestPath(auditDir, art.to));
      continue;
    }
    // to > cut: this .att covers at least one surviving event.
    const straddles = art.from < cut;
    return {
      toRemove,
      blocked: true,
      blockReason: straddles
        ? `committed attestation attest/${art.to}.att covers events [${art.from}, ${art.to}) — it straddles the cut at ${cut}. Move the cut to a batch boundary (an .att ends at ${art.from} or ${art.to}) or reconcile that .att first; a prune never splits or re-signs an attestation.`
        : `committed attestation attest/${art.to}.att covers surviving events [${art.from}, ${art.to}) whose indices would shift after the prune — remove or reconcile it before pruning (a prune never re-bases an attestation).`,
    };
  }

  return { toRemove, blocked: false, blockReason: null };
}

/**
 * Removes the `.att` files a decision marked for removal. Called by the apply
 * step AFTER the decision was checked (never blocked) and in the same
 * destructive pass as the segment deletion, so no `.att` is ever left over a
 * removed tail.
 *
 * @param toRemove - Absolute `.att` paths from {@link decideAttLockstep}
 */
export function removeCoveredAtts(toRemove: readonly string[]): void {
  for (const file of toRemove) {
    rmSync(file, { force: true });
  }
}
