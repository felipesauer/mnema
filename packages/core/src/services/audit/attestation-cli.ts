import path from 'node:path';
import { auditTailDirs } from '../../storage/audit/audit-files.js';
import type { IntegrityCheck } from '../integrity/audit-integrity.js';
import { readCommittedProjectHmacId } from '../integrity/project-secret.js';
import type { AttestationSigner } from './attestation-emitter.js';
import { planReattestIncremental } from './attestation-reattest.js';
import { committedSignerResolver, listArtifacts, writeArtifact } from './attestation-store.js';
import { CONTENT_ATTESTATION_CHECK, contentAttestationCheck } from './attestation-verify.js';
import { walkChainedEvents, walkChainedTail } from './audit-chain-walk.js';

/**
 * Chain-soundness checks whose WARNING-severity failures must still block a
 * reattest. These are the truncation-shaped states — the "mirror one ahead of
 * disk / truncated last line" count and hash-chain checks — that
 * `inspectAuditIntegrity` reports as `warning`, not `error`. Attesting over a
 * truncated tail would re-sign the truncation, so a non-ok check here blocks
 * even though it is only a warning.
 */
const CHAIN_SOUNDNESS_WARNINGS = new Set(['audit event count', 'audit hash chain']);

/**
 * Decides whether the on-disk chain is sound enough to attest, from the result
 * of `inspectAuditIntegrity`. FAIL-CLOSED and deliberately stricter than the
 * doctor's `every(c => c.ok)`:
 *
 * - blocks on ANY `error`-severity failure — including the early-return hard
 *   errors that carry a name outside the soundness set (e.g. the
 *   `audit_state`-row-missing "audit integrity" error), which a name-only
 *   allowlist would have let through;
 * - ALSO blocks on the warning-severity truncation shapes (count / hash chain
 *   not ok), which a naive `every(severity !== 'error')` would have blessed.
 *
 * A benign warning that is not truncation-related (e.g. `audit authenticity`
 * with no secret, `audit downgrade anchor`) does not block: attestation is
 * orthogonal to HMAC authenticity.
 *
 * @param checks - The result of `inspectAuditIntegrity`
 * @returns True only when the chain is sound enough to attest
 */
/**
 * Builds the content-attestation verdict for a project, ready to hand to
 * `inspectAuditIntegrity` as its pre-computed `contentAttestation` argument.
 * The single place that assembles walk + committed `.att` + signer resolver,
 * so every integrity surface (`audit verify`, `doctor`, the `audit_verify` MCP
 * tool) shows the SAME verdict rather than only the one that happened to wire
 * it.
 *
 * @param projectRoot - Absolute project root (holds `.mnema/keys/`)
 * @param auditDir - Absolute path to `.mnema/audit/`
 * @returns The content-attestation integrity check
 */
export function buildContentAttestation(projectRoot: string, auditDir: string): IntegrityCheck {
  const resolver = committedSignerResolver(projectRoot);
  const projectHmacId = readCommittedProjectHmacId(projectRoot);
  const tails = auditTailDirs(auditDir);

  // Each machine tail is its own chain with its own `.att` set — verify each
  // independently (the range indices are per-tail, so a merged global check
  // would see false overlaps/gaps at index 0). A degenerate single-tail
  // project folds to exactly one check, identical to the old flat behaviour.
  if (tails.length === 0) {
    // No tail on disk yet — an empty walk yields the dormant "no chained
    // events yet" verdict, identical to a fresh project.
    return contentAttestationCheck(walkChainedEvents(auditDir), [], resolver, projectHmacId);
  }
  const perTail = tails.map((tail) => {
    const walk = walkChainedEvents(tail);
    return {
      tail,
      isEmpty: walk.chained.length === 0,
      check: contentAttestationCheck(walk, listArtifacts(tail), resolver, projectHmacId),
    };
  });

  // The project verdict is the WORST tail verdict, so a single tail can never
  // hide behind a greener sibling. The ranking is fail-closed and finer than a
  // severity sort, because two very different states BOTH surface as a
  // `warning`:
  //   3 error            — a tamper or a wrong-project `.att`; blocks.
  //   2 partial (!ok)    — a tail with SOME events unattested (`ok:false`,
  //                        warning): the anonymous promise does not hold for
  //                        the tail, so it must outrank a merely-dormant one —
  //                        a plain severity sort would let a dormant sibling
  //                        that sorts first mask this via the tie-break.
  //   1 dormant (ok)     — a NON-EMPTY tail with no `.att` yet (`ok:true`,
  //                        warning): opt-in, but it keeps the project short of
  //                        a clean green.
  //   0 green / EMPTY    — fully attested, OR a tail with zero events (its
  //                        "no events yet" warning is about a fresh chain, not
  //                        unattested content — it must NOT drag a clean-green
  //                        sibling down to a warning).
  const rank = (t: (typeof perTail)[number]): number => {
    const c = t.check;
    if (!c.ok && (c.severity ?? 'error') === 'error') return 3;
    if (t.isEmpty) return 0;
    if (!c.ok) return 2; // partial coverage (warning + not ok)
    if ((c.severity ?? 'error') === 'warning') return 1; // dormant, has events
    return 0; // clean green
  };
  const worst = perTail.reduce((acc, cur) => (rank(cur) > rank(acc) ? cur : acc));
  if (rank(worst) > 0) {
    // Qualify by which tail (the degenerate root tail IS `auditDir`, no prefix).
    const qualified =
      worst.tail === auditDir
        ? worst.check.detail
        : `${path.basename(worst.tail)}: ${worst.check.detail}`;
    return { ...worst.check, detail: qualified };
  }
  // Every non-empty tail is fully attested (clean green). A single tail keeps
  // its own detail verbatim (unchanged for the common single-machine project);
  // multiple tails get a rolled-up line.
  const attestedTails = perTail.filter((t) => !t.isEmpty).length;
  return {
    name: CONTENT_ATTESTATION_CHECK,
    ok: true,
    detail:
      perTail.length === 1
        ? (perTail[0] as (typeof perTail)[number]).check.detail
        : `all chained events attested across ${attestedTails} machine tail(s)`,
  };
}

export function chainHealthyForAttest(checks: readonly IntegrityCheck[]): boolean {
  for (const c of checks) {
    if (c.ok) continue;
    const severity = c.severity ?? 'error';
    // Any hard error blocks — regardless of which check produced it.
    if (severity === 'error') return false;
    // A warning blocks only when it is a truncation-shaped soundness check.
    if (CHAIN_SOUNDNESS_WARNINGS.has(c.name)) return false;
  }
  return true;
}

/**
 * Materialises the `.att` for the unattested tail off the write hot-path,
 * invoked by the writer's checkpoint hook. Reuses the same fail-closed
 * {@link planReattest} the manual `reattest` command runs, so auto and manual
 * attestation share one policy — it refuses (writes nothing) on any tamper
 * signal rather than papering over it. Best-effort by contract: the writer
 * calls it inside a try/catch, and any batch it does not write is simply left
 * for the next checkpoint or a manual `reattest`.
 *
 * @param opts.projectRoot - Absolute project root (holds `.mnema/keys/`)
 * @param opts.auditDir - Absolute path to `.mnema/audit/`
 * @param opts.signer - The machine key + actor for new batches, or `null`
 * @param opts.projectHmacId - The committed `sha256(secret)` id, or `null`
 * @param opts.chainHealthy - Whether the chain is sound enough to attest
 *   (resolved by the caller via {@link chainHealthyForAttest})
 * @param opts.signedEventCountAt - Highest event_count under a signed
 *   checkpoint, for the truncation guard (or `null`)
 * @param opts.headCount - On-disk chained count at this checkpoint
 *   (`audit_state.event_count`). Bounds the tail walk so the checkpoint does
 *   NOT re-parse the whole chain — it attests only `[lastCoveredTo, headCount)`.
 * @param opts.batchSize - Backfill batch size (defaults inside the planner)
 */
export function autoAttest(opts: {
  projectRoot: string;
  auditDir: string;
  signer: AttestationSigner | null;
  projectHmacId: string | null;
  chainHealthy: boolean;
  signedEventCountAt: number | null;
  headCount: number;
  batchSize?: number;
}): void {
  const existing = listArtifacts(opts.auditDir);
  // The unattested tail begins at the highest `to` of the committed `.att`
  // set. Structural discontiguity/overlap is caught by the planner; here we
  // only need where to start reading so the walk stays bounded by the batch.
  const coveredTo = existing.reduce((max, art) => (art.to > max ? art.to : max), 0);
  // Walk ONLY [coveredTo, headCount) instead of the whole chain from genesis.
  const walk = walkChainedTail(opts.auditDir, opts.headCount, coveredTo);
  const plan = planReattestIncremental({
    walk,
    headCount: opts.headCount,
    existing,
    signer: opts.signer,
    projectHmacId: opts.projectHmacId,
    chainHealthy: opts.chainHealthy,
    signedEventCountAt: opts.signedEventCountAt,
    batchSize: opts.batchSize,
  });
  if (!plan.ok) return; // fail-closed: a refusal writes nothing
  for (const artifact of plan.artifacts) writeArtifact(opts.auditDir, artifact);
}
