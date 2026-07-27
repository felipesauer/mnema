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
 *
 * On top of that mechanism sits one policy, `establishIdentity`: a tree that is
 * deliberately created is born knowing the identity's WHOLE key roster, not just
 * the key at hand. That is where "at least two keys, from the founding" is
 * enforced — the only protection mnema offers against a lost key, since it
 * refuses central recovery by design.
 */

import {
  type BackupKey,
  type CatalogEvent,
  ensureBackupKey,
  identityFounded,
  keyEnrolled,
  keyRevoked,
  listRegistrations,
  materializePublicKey,
  type RegistrationFault,
} from '@mnema/chain';
import { orderedEvents } from '../projections/order.js';
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

/** A key the key root offers that this tree did NOT take, and why. */
export interface DeclinedKey {
  readonly fingerprint: string;
  /** Plain-language reason, to be reported to the person as-is. */
  readonly reason: string;
}

/** What establishing an identity into a tree produced. */
export interface EstablishedIdentity {
  /** The anchor this installation serves. */
  readonly anchor: string;
  /**
   * The identity's cold backup key, or null when one could not be established
   * because a registration at the key root cannot be read — a state reported,
   * never repaired behind the person (the fault appears in {@link declined}).
   */
  readonly backup: BackupKey | null;
  /** Fingerprints this call enrolled into this tree. */
  readonly enrolled: readonly string[];
  /** Registered keys this tree did not take, with their reasons. */
  readonly declined: readonly DeclinedKey[];
}

/**
 * Establishes this machine's identity into a tree, WHOLE: founds the anchor,
 * makes sure the identity has its cold backup key, and brings every key
 * registered at the key root into this tree.
 *
 * This is the policy behind "at least two keys, from the founding". Founding
 * alone would leave a tree knowing exactly one key — and if that key is lost,
 * nothing can ever speak for the identity again, because mnema has no central
 * recovery (an entity able to restore an identity is an entity able to forge
 * one). So a tree is born knowing the backup too.
 *
 * It runs per TREE because enrollment is a per-tree fact while the identity is
 * per-machine: two projects share one anchor and one key, but each carries its
 * own `identity.founded`. A backup enrolled in one project would be a stranger
 * in the next project created — silently, until the day it was needed. Replaying
 * the registration into each tree is what closes that: the signature covers
 * fixed values, so it proves consent in every tree, forever.
 *
 * A key the tree has ALREADY decided about is skipped — enrolled, founded, or
 * REVOKED. Skipping the revoked ones is the point of reading the chain rather
 * than the key root's files: a key retired from this identity must not be
 * resurrected by a later `init` just because its registration is still on disk.
 *
 * The public half is materialized into the tree BEFORE the enrollment is
 * appended, so the order of a crash can only ever leave a harmless key with no
 * event, never an event whose proof is missing.
 */
export function establishIdentity(
  ctx: WriteContext,
  input: { keyRoot: string },
): EstablishedIdentity {
  const anchor = ensureFounded(ctx);
  const keyRoot = { root: input.keyRoot };
  const backup = ensureBackupKey(keyRoot, anchor);
  const decided = keysDecidedFor(ctx, anchor);
  const enrolled: string[] = [];
  const declined: DeclinedKey[] = [];

  for (const registration of listRegistrations(keyRoot)) {
    if (!registration.usable) {
      declined.push({
        fingerprint: registration.fingerprint,
        reason: faultReason(registration.fault),
      });
      continue;
    }
    if (registration.anchor !== anchor) {
      declined.push({
        fingerprint: registration.fingerprint,
        reason: `it is registered for another identity (${registration.anchor})`,
      });
      continue;
    }
    if (decided.has(registration.fingerprint)) continue;
    materializePublicKey(ctx.layout, registration);
    enrollKey(ctx, { newFp: registration.fingerprint, reverseSig: registration.reverseSig });
    enrolled.push(registration.fingerprint);
  }

  return { anchor, backup, enrolled, declined };
}

/**
 * Enrolls a new key into this installation's anchor: the local key (a member)
 * vouches for `newFp`, whose reverse signature over `enroll:<anchor>:<newFp>`
 * proves it consents. The caller supplies that material (the new machine
 * produces it); this only signs the vouch and appends the fact. Founds first, so
 * the local key is a member able to vouch.
 *
 * The enrollment is checkpointed immediately — for a different reason than a
 * revocation is. An ADDITION takes effect even while residual (the verifier gates
 * only the mutations that can alter signed history), so the checkpoint is not
 * what makes the membership valid; it is what keeps the chain fully signed.
 * A legitimate membership change proves itself at once instead of resting on the
 * hash chain alone, so `fullySigned` keeps discriminating: an unsigned residual
 * means unproven work, never "the owner just enrolled a key". It also covers the
 * one addition the verifier DOES gate — an enrollment that restores a key revoked
 * under coverage takes effect only when itself covered.
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
  ctx.writer.checkpoint();
  return { ok: true, anchor };
}

/**
 * Revokes a key from this installation's anchor, from this point forward. Any
 * member may revoke any other (peers, no hierarchy); events the revoked key
 * signed before stay valid. Founds first, so the local key is a member able to
 * revoke.
 *
 * The revocation is checkpointed immediately: the verifier trusts a `key.revoked`
 * to remove a key only once it is signature-covered (a residual revoke is
 * forgeable and is ignored), so a revocation that stayed in the residual window
 * would have no effect. Signing a checkpoint over it makes it effective at once,
 * with this machine's own key — the honest path.
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
  ctx.writer.checkpoint();
  return { ok: true, anchor };
}

/**
 * The fingerprints this tree has already recorded a decision about for `anchor`:
 * the founding key, every key enrolled, and every key revoked. A revoked key
 * counts as decided so it is never re-enrolled.
 */
function keysDecidedFor(ctx: WriteContext, anchor: string): Set<string> {
  const decided = new Set<string>();
  for (const event of orderedEvents(ctx.layout, ctx.upcasters)) {
    if (event.subject !== anchor) continue;
    const fingerprint = enrollmentSubjectKey(event);
    if (fingerprint !== undefined) decided.add(fingerprint);
  }
  return decided;
}

/** The key an enrollment fact concerns, or undefined for any other event. */
function enrollmentSubjectKey(event: CatalogEvent): string | undefined {
  switch (event.kind) {
    case 'identity.founded':
      return event.payload.foundingFp;
    case 'key.enrolled':
      return event.payload.newFp;
    case 'key.revoked':
      return event.payload.revokedFp;
    default:
      return undefined;
  }
}

/** The plain-language reason a registration cannot be used, as the person reads it. */
function faultReason(fault: RegistrationFault): string {
  switch (fault) {
    case 'unreadable':
      return 'its registration at the key root cannot be read';
    case 'no-public-key':
      return 'its public key is missing from the key root';
    case 'key-mismatch':
      return 'the public key at the key root is not the key it names';
    case 'unproven':
      return 'its registration does not prove the key consented';
  }
}
