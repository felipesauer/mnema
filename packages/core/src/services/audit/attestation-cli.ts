import type { IntegrityCheck } from '../integrity/audit-integrity.js';
import { readCommittedProjectHmacId } from '../integrity/project-secret.js';
import type { AttestationSigner } from './attestation-emitter.js';
import { planReattestIncremental } from './attestation-reattest.js';
import { committedSignerResolver, listArtifacts, writeArtifact } from './attestation-store.js';
import { contentAttestationCheck } from './attestation-verify.js';
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
 *   allowlist would have let through (ADR-41 review, finding 1);
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
 * it (ADR-41 review, finding 2).
 *
 * @param projectRoot - Absolute project root (holds `.mnema/keys/`)
 * @param auditDir - Absolute path to `.mnema/audit/`
 * @returns The content-attestation integrity check
 */
export function buildContentAttestation(projectRoot: string, auditDir: string): IntegrityCheck {
  return contentAttestationCheck(
    walkChainedEvents(auditDir),
    listArtifacts(auditDir),
    committedSignerResolver(projectRoot),
    readCommittedProjectHmacId(projectRoot),
  );
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
