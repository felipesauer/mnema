/**
 * Identity operations: founding an anchor and moving keys in and out of it.
 *
 * These are the low-level mechanism behind mnema's identity — one anchor with N
 * keys enrolled by signature. They emit the enrollment facts (`identity.founded`
 * / `key.enrolled` / `key.revoked`) that the chain verifier folds to decide WHO
 * a signer speaks for. The material a `key.enrolled` needs — the joining
 * machine's public key and its reverse signature — is produced elsewhere (the
 * handshake) and supplied here, so the mechanism is testable and complete on its
 * own.
 *
 * Founding is what makes the single identity rule hold for a fresh installation:
 * an event is authentic only if its signer is a key valid for its anchor, so a
 * machine's first fact must be its founding. `ensureFounded` seeds that once,
 * before the first gated write, so a caller never has to remember to — and it
 * founds only when the record proves no membership, because a key another machine
 * already enrolled must ADOPT that identity instead of minting a second one.
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
  committedPublicKey,
  ensureBackupKey,
  identityFounded,
  keyEnrolled,
  keyRevoked,
  listRegistrations,
  materializePublicKey,
  type RegistrationFault,
} from '@mnema/chain';
import {
  type ContentTooLargeErr,
  type ScreenedWrite,
  screenContent,
  screened,
} from '../content/screen.js';
import { IdentityUnavailableError, type Membership, membershipIn } from '../identity/membership.js';
import { oneLine } from '../one-line.js';
import { orderedEvents } from '../projections/order.js';
import { appendEvent, type UnreadableEventErr } from './append.js';
import { systemClock } from './clock.js';
import type { WriteContext } from './operations.js';

/** An identity fact was appended. */
export interface IdentityOk extends ScreenedWrite {
  readonly ok: true;
  /** The anchor the fact concerns. */
  readonly anchor: string;
}

/**
 * Settles which anchor this installation serves in a tree, WITHOUT writing
 * anything.
 *
 * With an anchor already recorded locally there is nothing to settle — that file
 * is the decision, made once. With none, the RECORD is asked first: a key another
 * machine already enrolled belongs to that machine's identity, and the tree
 * carries the proof. Only when the record proves nothing does the key fall back
 * to the anchor it derives from itself — the anchor it will found.
 *
 * Asking the record is what stops the trap this closes: a key that is already a
 * member, writing into a tree where it has not yet recorded an anchor (a fresh
 * clone of the team's repo), would otherwise derive its OWN anchor and found a
 * SECOND identity in a record the team shares — one person appearing as two
 * strangers, appended, unappendable-back.
 *
 * When the record proves the key belongs to more than one identity, or proves the
 * identity RETIRED it, there is no honest answer and this throws
 * {@link IdentityUnavailableError} instead of picking one. Choosing would decide
 * whose record this is on the person's behalf; writing under a retired key would
 * leave the whole tree failing verification.
 */
export function decideAnchor(ctx: WriteContext): AnchorDecision {
  if (ctx.writer.hasAnchor) return { anchor: ctx.writer.anchor, source: 'recorded' };

  // The key's own public half as the TREE carries it — materialized when this
  // writer opened, or by the member that enrolled it. Reading it from the record
  // rather than the key root keeps the decision to material an anonymous clone
  // could check, and binds the consent signature to the key it names. A tree that
  // carries no public half for this key is a tree that never admitted it.
  const key = committedPublicKey(ctx.layout, ctx.writer.signerFingerprint);
  if (key !== null) {
    const proven = membershipIn({ tree: ctx.layout.root, upcasters: ctx.upcasters }, key);
    if (proven.ok) {
      return { anchor: proven.anchor, source: 'adopted', membership: proven.membership };
    }
    // NOT_A_MEMBER is the ordinary shape of a first write — a fresh installation,
    // a new project — so it falls through to founding. The other two are
    // unanswerable, and an unanswerable identity does not write.
    if (proven.code !== 'NOT_A_MEMBER') {
      throw new IdentityUnavailableError(proven.code, proven.message);
    }
  }
  return { anchor: ctx.writer.anchor, source: 'unfounded' };
}

/**
 * WHO this installation authorizes as in a tree: the value every event's `who`
 * must carry, decided without writing anything.
 *
 * Every write operation reads this before it builds its event, and
 * {@link ensureFounded} settles the same question on the way to appending it —
 * so both go through {@link decideAnchor} and cannot disagree. They once could:
 * reading the writer's anchor directly was harmless while the only answer was
 * "the anchor this key derives", because that is what founding recorded anyway.
 * With adoption it stopped being harmless — a key another machine had enrolled
 * would build its FIRST event under its own derived anchor and then record the
 * adopted one, leaving exactly one event speaking for an identity that never
 * existed. One function, both moments.
 *
 * On the hot path it costs what reading the writer's anchor cost: the recorded
 * anchor answers immediately, and the record is only consulted while no anchor is
 * recorded yet.
 */
export function authorizingAnchor(ctx: WriteContext): string {
  return decideAnchor(ctx).anchor;
}

/** Where the anchor an installation serves in one tree came from. */
export type AnchorDecision =
  /** Already recorded locally: decided by an earlier founding, adoption, or restore. */
  | { readonly source: 'recorded'; readonly anchor: string }
  /** The record proves this key a member of that anchor; nothing needs founding. */
  | { readonly source: 'adopted'; readonly anchor: string; readonly membership: Membership }
  /** The record proves no membership: the key's own anchor, not yet founded here. */
  | { readonly source: 'unfounded'; readonly anchor: string };

/**
 * Makes sure this installation serves an anchor in this tree before its first
 * fact: records which anchor it is, and appends the `identity.founded` when the
 * anchor is its OWN to found. A no-op once an anchor is recorded, so it is safe
 * to call before every write.
 *
 * Two paths reach a recorded anchor, and only one of them founds. A key the
 * record already proves a member ADOPTS that identity — it must not found,
 * because an anchor can only be founded by the key it derives from, and appending
 * a founding for its own anchor is exactly the second identity this avoids. A key
 * the record knows nothing about founds its own, as a first installation does.
 *
 * The record is read ONLY on the path where no anchor is recorded yet. Every
 * gated write calls this, so consulting the chain unconditionally would put a
 * full replay on the hot path; behind that check the cost is paid once per tree,
 * and from then on the recorded anchor answers. That is why the read lives inside
 * the branch and not before it.
 *
 * Returns the anchor this installation serves either way.
 */
export function ensureFounded(ctx: WriteContext): string {
  if (ctx.writer.hasAnchor) return ctx.writer.anchor;

  const decided = decideAnchor(ctx);
  ctx.writer.recordAnchor(decided.anchor);
  // An adopted identity is already on the record, vouched for by a member: there
  // is nothing to found, and founding would mint a second identity.
  if (decided.source === 'adopted') return decided.anchor;

  const at = (ctx.clock ?? systemClock)();
  // Appended straight, with no typed refusal to report, and that is the one place
  // in the core where it is the honest shape: every field of a founding is DERIVED
  // — the anchor from a key, the fingerprint from that same key, `at` from the
  // clock — so no input a caller could get wrong reaches it, and there is nobody to
  // report a refusal to (this returns the anchor, and it is called on the way to
  // every other write). The writer's own check still stands under it: if a founding
  // ever came out unreadable that is a bug in this function, and it fails loudly
  // instead of entering the record.
  ctx.writer.append(
    identityFounded(
      { at, who: decided.anchor, signerFp: ctx.writer.signerFingerprint, subject: decided.anchor },
      { foundingFp: ctx.writer.signerFingerprint },
    ),
  );
  return decided.anchor;
}

/**
 * Founds this installation's anchor explicitly, as a result union. Idempotent: if
 * already founded (or enrolled), it appends nothing and reports the anchor it
 * already serves.
 *
 * NOT on the writing surface. No surface ever founded on its own — `init`
 * establishes an identity whole, and every other write founds on its way in
 * through {@link ensureFounded} — so the wrapper is reached only by the
 * enrollment integration test, which uses it as the "machine A exists" step.
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
 * What this covers, stated plainly: the trees created DELIBERATELY, which today
 * means a project's public tree. The private and global trees are founded on the
 * way to a write (`ensureFounded`), which sees no key root, so they are born
 * knowing one key — and a key lost is a key lost for them. That is a smaller hole
 * than it reads: both are local and uncommitted, so the disk that takes the key
 * takes them too, and no backup would have helped. What the backup does cover is
 * the case where the KEY is gone and the disk is not — and there the committed
 * tree, which survives in git, is exactly where the proof of membership is found.
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
        reason: `it is registered for another identity (${oneLine(registration.anchor)})`,
      });
      continue;
    }
    if (decided.has(registration.fingerprint)) continue;
    materializePublicKey(ctx.layout, registration);
    const joined = enrollKey(ctx, {
      newFp: registration.fingerprint,
      reverseSig: registration.reverseSig,
    });
    // A registration the catalog itself would not accept is a key this tree did
    // not take, reported like every other one rather than thrown. It is not
    // reachable through `listRegistrations` (a usable registration carries a
    // fingerprint computed from the key and a non-empty signature), which is
    // exactly why it belongs in `declined`: the loop keeps going and the person
    // hears about the one key instead of losing the whole establishment.
    if (!joined.ok) {
      declined.push({ fingerprint: registration.fingerprint, reason: joined.message });
      continue;
    }
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
): IdentityOk | UnreadableEventErr {
  const anchor = ensureFounded(ctx);
  const at = (ctx.clock ?? systemClock)();
  // Through the door like every other write, even though both fields are derived
  // (a fingerprint computed from the joining key, a signature `decodeKeyRequest`
  // already rejected as absent). This is an EXPORT of the writing surface, so a
  // caller outside the two surfaces can hand it a value the real callers never
  // produce, and it owes that caller a refusal it can read rather than a throw.
  const appended = appendEvent(
    ctx.writer,
    keyEnrolled(
      { at, who: anchor, signerFp: ctx.writer.signerFingerprint, subject: anchor },
      { newFp: input.newFp, reverseSig: input.reverseSig },
    ),
  );
  if (!appended.ok) return appended;
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
 *
 * The `reason` is the only free text any identity fact carries (a founding and an
 * enrollment carry fingerprints and a signature, nothing a person typed), so it
 * goes through the same content door every other write does — screened before
 * anything is founded, so an oversize reason costs nothing.
 */
export function revokeKey(
  ctx: WriteContext,
  input: { revokedFp: string; reason: string },
): IdentityOk | ContentTooLargeErr | UnreadableEventErr {
  const text = screenContent({ reason: input.reason });
  if (!text.ok) return text;

  const anchor = ensureFounded(ctx);
  const at = (ctx.clock ?? systemClock)();
  const appended = appendEvent(
    ctx.writer,
    keyRevoked(
      { at, who: anchor, signerFp: ctx.writer.signerFingerprint, subject: anchor },
      { revokedFp: input.revokedFp, reason: text.fields.reason },
    ),
  );
  if (!appended.ok) return appended;
  ctx.writer.checkpoint();
  return { ok: true, anchor, ...screened(text.replaced) };
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
