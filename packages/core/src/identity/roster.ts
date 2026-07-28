/**
 * Operating an identity's roster: bringing a key in, and taking one out.
 *
 * The mechanisms these sit on already existed (`enrollKey` / `revokeKey` append
 * the facts and sign a checkpoint over them). What this adds is the part that
 * cannot live in a mechanism: the JUDGEMENT of whether the fact should exist at
 * all. An enrollment fact is append-only, so one whose proof does not check out
 * leaves the tree permanently failing verification, with no way to take it back —
 * and a revocation of the last key leaves an identity with nothing able to extend
 * its own history. Both are refused here, while refusing is still free.
 *
 * Every refusal below has the same shape of reason: it is cheaper than the state
 * it prevents. That is the whole argument for putting them ahead of the write.
 */

import { materializePublicKey } from '@mnema/chain';
import type { ScreenedWrite } from '../content/screen.js';
import { decideAnchor, enrollKey, revokeKey } from '../workflow/identity-operations.js';
import type { WriteContext } from '../workflow/operations.js';
import { decodeKeyRequest } from './handshake.js';
import { provesConsent, rosterOf } from './membership.js';

/** What enrolling a requested key needs. */
export interface EnrollRequestInput {
  /** The request line the joining machine produced (see the handshake). */
  readonly request: string;
}

/** The key is a member of this machine's identity. */
export interface EnrollRequestOk {
  readonly ok: true;
  /** The joining key's fingerprint, derived from the key the request carried. */
  readonly fingerprint: string;
  /** The identity it now belongs to — this machine's own. */
  readonly anchor: string;
  /**
   * True when the record ALREADY proved this key a member, so nothing was
   * appended. Reported rather than treated as an error: the person asked for a
   * state that holds, and a second enrollment fact would say nothing new.
   */
  readonly alreadyMember: boolean;
}

/** Why a key was not enrolled. */
export type EnrollRequestErrorCode =
  /** The text is not a key request, or the key inside it cannot be read. */
  | 'MALFORMED_REQUEST'
  /** The request does not prove the key consented to join THIS identity. */
  | 'UNPROVEN_REQUEST'
  /** This machine's own key is not currently valid for its identity, so it cannot vouch. */
  | 'CANNOT_VOUCH';

/** The enrollment was refused; nothing was written. */
export interface EnrollRequestErr {
  readonly ok: false;
  readonly code: EnrollRequestErrorCode;
  /** Plain-language reason, to be reported to the person as-is. */
  readonly message: string;
}

/**
 * Enrolls the key a request carries into THIS machine's identity: commits the
 * key's public half into the tree, then appends the vouch.
 *
 * The consent signature is checked against this machine's OWN anchor, never
 * against an anchor the request names. A request is made for one identity, and a
 * signature over `enroll:<other>:<fp>` is not consent to join this one — appending
 * it would leave the tree carrying an enrollment its own verifier rejects, for
 * good. So a request made for someone else is refused here, where refusing costs
 * nothing.
 *
 * The public half is materialized BEFORE the fact is appended, the same order a
 * tree's own founding uses: a crash between the two leaves a harmless committed
 * key with no event, while the reverse would leave an event whose proof is missing
 * from the disk it must be proven against.
 */
export function enrollFromRequest(
  ctx: WriteContext,
  input: EnrollRequestInput,
): EnrollRequestOk | EnrollRequestErr {
  const request = decodeKeyRequest(input.request);
  if (request === null) {
    return {
      ok: false,
      code: 'MALFORMED_REQUEST',
      message:
        'that is not a key request — hand over the whole line the joining machine ' +
        'printed, unedited, with nothing added or trimmed',
    };
  }

  // WHO this machine is here, decided without writing: an anchor already recorded,
  // one the record proves it joined, or the anchor it is about to found.
  const decided = decideAnchor(ctx);
  const anchor = decided.anchor;
  const fingerprint = request.key.fingerprint;

  if (!provesConsent(request.key, anchor, request.reverseSig)) {
    return {
      ok: false,
      code: 'UNPROVEN_REQUEST',
      message:
        `that request does not prove the key ${fingerprint} consented to join ${anchor} — ` +
        `a request is made for ONE identity, so check the joining machine asked to join ${anchor} ` +
        'and not some other',
    };
  }

  // The roster as the record proves it now. A tree with no founding yet has an
  // empty one, and this machine is about to become its only member — which is why
  // an unfounded tree may still vouch.
  const roster = rosterOf({ tree: ctx.layout.root, upcasters: ctx.upcasters }, anchor);
  if (decided.source !== 'unfounded' && !roster.has(ctx.writer.signerFingerprint)) {
    return {
      ok: false,
      code: 'CANNOT_VOUCH',
      message:
        `this machine's key is not currently valid for ${anchor} — the record retired it, ` +
        'so a vouch it signed would be rejected. Enroll from a machine that is still a member',
    };
  }
  if (roster.has(fingerprint)) {
    return { ok: true, fingerprint, anchor, alreadyMember: true };
  }

  materializePublicKey(ctx.layout, request.key);
  enrollKey(ctx, { newFp: fingerprint, reverseSig: request.reverseSig });
  return { ok: true, fingerprint, anchor, alreadyMember: false };
}

/** What retiring a key needs. */
export interface RevokeMemberInput {
  /** The full fingerprint of the key to retire. */
  readonly fingerprint: string;
  /** Why it is being retired — recorded in the fact. */
  readonly reason: string;
}

/** The key was retired from this machine's identity, from this point forward. */
export interface RevokeMemberOk extends ScreenedWrite {
  readonly ok: true;
  readonly fingerprint: string;
  /** The identity it was retired from. */
  readonly anchor: string;
  /** True when the retired key is the one this machine signs with. */
  readonly self: boolean;
  /** How many keys the identity has left. */
  readonly remaining: number;
}

/** Why a key was not retired. */
export type RevokeMemberErrorCode =
  /** The record does not currently count this key as a member of the identity. */
  | 'UNKNOWN_KEY'
  /** It is the identity's last key: retiring it would leave nothing able to extend the record. */
  | 'LAST_KEY'
  /** This machine's own key is not currently valid for its identity, so it cannot revoke. */
  | 'CANNOT_VOUCH'
  /** The reason given was over the per-field size limit. */
  | 'CONTENT_TOO_LARGE';

/** The revocation was refused; nothing was written. */
export interface RevokeMemberErr {
  readonly ok: false;
  readonly code: RevokeMemberErrorCode;
  /** Plain-language reason, to be reported to the person as-is. */
  readonly message: string;
}

/**
 * Retires a key from THIS machine's identity, from this point forward. Events the
 * key signed before stay valid — a revocation is prospective, never retroactive,
 * so past work does not become unattributable because a key was later rotated out.
 *
 * The last key is refused. An identity whose every key is retired has no key able
 * to sign another enrollment, so its history can never be extended again and no
 * command can repair it — the one state in the roster with no way back. The order
 * that works is the reverse: bring the replacement in first, and retire the old
 * key once the record proves the new one a member.
 */
export function revokeMember(
  ctx: WriteContext,
  input: RevokeMemberInput,
): RevokeMemberOk | RevokeMemberErr {
  const decided = decideAnchor(ctx);
  const anchor = decided.anchor;
  const roster = rosterOf({ tree: ctx.layout.root, upcasters: ctx.upcasters }, anchor);

  if (decided.source !== 'unfounded' && !roster.has(ctx.writer.signerFingerprint)) {
    return {
      ok: false,
      code: 'CANNOT_VOUCH',
      message:
        `this machine's key is not currently valid for ${anchor} — the record retired it, ` +
        'so a revocation it signed would have no effect. Revoke from a machine that is still a member',
    };
  }
  if (!roster.has(input.fingerprint)) {
    return {
      ok: false,
      code: 'UNKNOWN_KEY',
      message:
        `the record does not count ${input.fingerprint} as a key of ${anchor} — ` +
        'it was never enrolled here, or it was retired already',
    };
  }
  if (roster.size <= 1) {
    return {
      ok: false,
      code: 'LAST_KEY',
      message:
        `${input.fingerprint} is the only key ${anchor} has — retiring it would leave the ` +
        'identity unable to sign anything again, including a repair. Enroll the replacement ' +
        'first, then retire this one',
    };
  }

  // The reason is free text, so the mechanism screens it at the append. Forward
  // its refusal rather than asserting success: this is the one refusal here that
  // is about the CONTENT rather than the roster, and it is still free (nothing has
  // been appended by the time it comes back).
  const revoked = revokeKey(ctx, { revokedFp: input.fingerprint, reason: input.reason });
  if (!revoked.ok) return revoked;
  return {
    ok: true,
    fingerprint: input.fingerprint,
    anchor,
    self: input.fingerprint === ctx.writer.signerFingerprint,
    remaining: roster.size - 1,
    ...(revoked.replaced !== undefined ? { replaced: revoked.replaced } : {}),
  };
}
