/**
 * Identity operations: founding an anchor and moving keys in and out of it.
 *
 * These are the low-level mechanism behind mnema's identity — one anchor with N
 * keys enrolled by signature. They emit the enrollment facts (`identity.founded`
 * / `key.enrolled` / `key.revoked`) that the chain verifier folds to decide WHO
 * a signer speaks for. The between-machines flow that produces the material a
 * `key.enrolled` needs — the new machine's fingerprint and its reverse signature
 * — is a surface concern (a future `mnema enroll`); here a caller supplies that
 * material directly, so the mechanism is testable and complete on its own.
 *
 * Founding is what makes the single identity rule hold for a fresh installation:
 * an event is authentic only if its signer is a key valid for its anchor, so a
 * machine's first fact must be its founding. `ensureFounded` seeds that once,
 * before the first gated write, so a caller never has to remember to.
 */

import { identityFounded, keyEnrolled, keyRevoked } from '@mnema/chain';
import { systemClock } from './clock.js';
import type { WriteContext } from './operations.js';

/** An identity fact was appended. */
export interface IdentityOk {
  readonly ok: true;
  /** The anchor the fact concerns. */
  readonly anchor: string;
}

/**
 * Founds this installation's anchor if it has not recorded one yet: records the
 * anchor locally and appends the `identity.founded` that enrolls its key for its
 * own anchor. A no-op once an anchor is recorded — the installation already
 * founded or enrolled into one — so it is safe to call before every write.
 *
 * Returns the anchor this installation serves either way.
 */
export function ensureFounded(ctx: WriteContext): string {
  const anchor = ctx.writer.anchor;
  if (ctx.writer.hasAnchor) return anchor;
  const at = (ctx.clock ?? systemClock)();
  ctx.writer.recordAnchor(anchor);
  ctx.writer.append(
    identityFounded(
      { at, who: anchor, signerFp: ctx.writer.signerFingerprint, subject: anchor },
      { foundingFp: ctx.writer.signerFingerprint },
    ),
  );
  return anchor;
}

/**
 * Founds this installation's anchor explicitly. Idempotent: if already founded
 * (or enrolled), it appends nothing and reports the anchor it already serves.
 */
export function foundIdentity(ctx: WriteContext): IdentityOk {
  return { ok: true, anchor: ensureFounded(ctx) };
}

/**
 * Enrolls a new key into this installation's anchor: the local key (a member)
 * vouches for `newFp`, whose reverse signature over `enroll:<anchor>:<newFp>`
 * proves it consents. The caller supplies that material (the new machine
 * produces it); this only signs the vouch and appends the fact. Founds first, so
 * the local key is a member able to vouch.
 */
export function enrollKey(
  ctx: WriteContext,
  input: { newFp: string; reverseSig: string },
): IdentityOk {
  const anchor = ensureFounded(ctx);
  const at = (ctx.clock ?? systemClock)();
  ctx.writer.append(
    keyEnrolled(
      { at, who: anchor, signerFp: ctx.writer.signerFingerprint, subject: anchor },
      { newFp: input.newFp, reverseSig: input.reverseSig },
    ),
  );
  return { ok: true, anchor };
}

/**
 * Revokes a key from this installation's anchor, from this point forward. Any
 * member may revoke any other (peers, no hierarchy); events the revoked key
 * signed before stay valid. Founds first, so the local key is a member able to
 * revoke.
 */
export function revokeKey(
  ctx: WriteContext,
  input: { revokedFp: string; reason: string },
): IdentityOk {
  const anchor = ensureFounded(ctx);
  const at = (ctx.clock ?? systemClock)();
  ctx.writer.append(
    keyRevoked(
      { at, who: anchor, signerFp: ctx.writer.signerFingerprint, subject: anchor },
      { revokedFp: input.revokedFp, reason: input.reason },
    ),
  );
  return { ok: true, anchor };
}
