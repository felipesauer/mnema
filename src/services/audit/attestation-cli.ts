import type { IntegrityCheck } from '../audit-integrity.js';
import { committedSignerResolver, listArtifacts } from './attestation-store.js';
import { contentAttestationCheck } from './attestation-verify.js';
import { walkChainedEvents } from './audit-chain-walk.js';

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
