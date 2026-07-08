import type { IntegrityCheck } from '../audit-integrity.js';

/**
 * Names of the integrity checks that reflect chain soundness for the purpose
 * of attestation. A reattest must NOT proceed while any of these is not `ok`
 * — INCLUDING their warning-severity forms (the "mirror one ahead of disk /
 * truncated last line" shapes). Trusting `every(c => c.severity !== 'error')`
 * would let a truncated tail through and let the planner re-sign it; this set
 * treats those warnings as blocking.
 */
const CHAIN_SOUNDNESS_CHECKS = new Set(['audit event count', 'audit hash chain']);

/**
 * Decides whether the on-disk chain is sound enough to attest, from the
 * integrity checks. Returns `false` if ANY chain-soundness check is not `ok`,
 * regardless of its severity — the deliberate stricter-than-error rule that
 * closes the truncation-laundering gap (ADR-41 review).
 *
 * @param checks - The result of `inspectAuditIntegrity`
 * @returns True only when every chain-soundness check passed
 */
export function chainHealthyForAttest(checks: readonly IntegrityCheck[]): boolean {
  return checks.every((c) => !CHAIN_SOUNDNESS_CHECKS.has(c.name) || c.ok);
}
