import type { IntegrityCheck } from '../integrity/audit-integrity.js';
import { type AttestationArtifact, verifyArtifact } from './attestation-artifact.js';
import type { AuditChainWalk } from './audit-chain-walk.js';

/** The check name, distinct from the head-signature 'audit machine attestation'. */
export const CONTENT_ATTESTATION_CHECK = 'audit content attestation';

/**
 * Produces the content-attestation verdict: does a chain of committed
 * `.att` cover every chained event, and does each verify against a committed
 * public key — WITH NO SECRET, so an anonymous clone gets a real answer.
 *
 * FAIL-CLOSED by design. `ok` is true ONLY when every chained event is covered
 * by a verifying attestation. Anything less is `ok: false` so the doctor /
 * `audit_verify` collapse (`checks.every(c => c.ok)`) reflects it, rather than
 * hiding an unattested tail behind a green line:
 *
 * - a batch whose signature/content does not verify → ERROR (tamper);
 * - a batch whose signer `.pub` is absent → WARNING (cannot attest);
 * - attestations that overlap or leave an interior gap → ERROR (the committed
 *   set is internally inconsistent);
 * - an unattested tail (events past the last `.att`) → WARNING, never green:
 *   the events are real but no one has signed them yet;
 * - no `.att` at all over a started chain → WARNING (feature dormant).
 *
 * The verdict reports the signer PER covered batch, so a change of signing
 * machine mid-chain is visible (never silently folded into a green pass).
 *
 * @param walk - The chained events on disk, indexed
 * @param artifacts - The committed `.att` records (any order)
 * @param resolvePublicKeyPem - Resolves a signer's PEM by FULL fingerprint
 * @param expectedProjectHmacId - The project's OWN committed HMAC fingerprint
 *   (`sha256(secret)` hex). Every artifact's `projectHmacId` must equal it —
 *   a mismatch means the `.att` belongs to a DIFFERENT project (or its
 *   `projectHmacId` was swapped), which the signature check alone cannot catch
 *   (the foreign signature verifies against its own committed key). Reported
 *   with a distinct wrong-project verdict, NOT generic tamper. `null` when the
 *   project committed no fingerprint (nothing to bind against — the missing
 *   downgrade anchor is warned separately), in which case binding is skipped.
 * @returns One integrity check line
 */
export function contentAttestationCheck(
  walk: AuditChainWalk,
  artifacts: readonly AttestationArtifact[],
  resolvePublicKeyPem: (fingerprint: string) => string | null,
  expectedProjectHmacId: string | null = null,
): IntegrityCheck {
  const total = walk.chained.length;

  if (artifacts.length === 0) {
    // No .att at all is DORMANT, not a failure — content attestation
    // is opt-in, so a project that never ran `reattest` must not report "not
    // intact" (that would train users to ignore the signal). `ok: true` with a
    // warning that nudges adoption. Fail-closed kicks in the moment ANY .att
    // exists: from there, partial coverage, a gap, a truncation, or a tamper
    // is ok:false.
    return {
      name: CONTENT_ATTESTATION_CHECK,
      ok: true,
      detail:
        total === 0
          ? 'no chained events yet — content attestation activates once events exist'
          : `${total} event(s) not yet attested — an anonymous clone cannot verify authenticity. Run \`mnema audit reattest --write\` to enable it.`,
      severity: 'warning',
    };
  }

  const sorted = [...artifacts].sort((a, b) => a.from - b.from);
  const signers: string[] = [];
  let coveredTo = 0;

  for (const art of sorted) {
    if (art.from !== coveredTo) {
      return {
        name: CONTENT_ATTESTATION_CHECK,
        ok: false,
        detail:
          art.from < coveredTo
            ? `attestations overlap near event ${art.from} — the committed .att set is inconsistent`
            : `attestation gap: events [${coveredTo}, ${art.from}) are not covered by any .att`,
        severity: 'error',
      };
    }
    if (art.to > total) {
      // An .att covers events not on disk: the chain retreated below an
      // attested high-water mark — a truncation the layer exists to catch.
      return {
        name: CONTENT_ATTESTATION_CHECK,
        ok: false,
        detail: `attestation covers event ${art.to} but the chain holds only ${total} — the log was truncated below attested history`,
        severity: 'error',
      };
    }
    // Project binding: the artifact must carry THIS project's committed HMAC
    // fingerprint. A foreign .att (swapped in, or from another project) has a
    // signature that verifies against ITS OWN committed key, so verifyArtifact
    // below would pass it — projectHmacId is the only thing tying the batch to
    // this project. A mismatch is wrong-project, a distinct verdict from a
    // tampered batch, so the operator is not sent hunting for a forgery that
    // is not there. Skipped when the project committed no fingerprint (there is
    // nothing to bind against; the missing anchor is warned elsewhere).
    if (expectedProjectHmacId != null && art.projectHmacId !== expectedProjectHmacId) {
      return {
        name: CONTENT_ATTESTATION_CHECK,
        ok: false,
        detail: `attestation [${art.from}, ${art.to}) by ${art.signerActor} carries project id …${art.projectHmacId.slice(0, 12)}, but this project's committed fingerprint is …${expectedProjectHmacId.slice(0, 12)} — the .att is for a different project (wrong project secret), not this one`,
        severity: 'error',
      };
    }
    const events = walk.chained.slice(art.from, art.to).map((c) => c.event);
    const verdict = verifyArtifact(art, events, resolvePublicKeyPem);
    if (!verdict.ok) {
      return {
        name: CONTENT_ATTESTATION_CHECK,
        ok: false,
        detail: `attestation [${art.from}, ${art.to}) by ${art.signerActor}: ${verdict.reason}`,
        // A missing key is "cannot attest" (warning); a real mismatch is tamper.
        severity: verdict.cannotAttest ? 'warning' : 'error',
      };
    }
    signers.push(art.signerActor);
    coveredTo = art.to;
  }

  const uniqueSigners = [...new Set(signers)];
  const signerNote =
    uniqueSigners.length === 1
      ? `signed by ${uniqueSigners[0]}`
      : `signed by ${uniqueSigners.length} machines (${uniqueSigners.join(', ')})`;

  if (coveredTo < total) {
    return {
      name: CONTENT_ATTESTATION_CHECK,
      ok: false,
      detail: `attested up to event ${coveredTo} of ${total} (${signerNote}); ${total - coveredTo} tail event(s) unattested — never verified green beyond the last attestation`,
      severity: 'warning',
    };
  }

  return {
    name: CONTENT_ATTESTATION_CHECK,
    ok: true,
    detail: `all ${total} chained events attested (${signerNote})`,
  };
}
