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
 *
 * AHEAD OF THE WRITER TOO, and that is a second promise rather than the same one. They
 * used to run after the caller had OPENED the tree's writer, which appends nothing and
 * still touches the tree: for a key that never wrote there it materializes the key's
 * public half, mints an installation id and gives the tail a directory and a proof.
 * Measured on the binary, a refused `key enroll` left the tree with an untracked `.pub`
 * and an empty tail, and a refused `key revoke` the same. Both operations take a
 * {@link DecideThenWrite} now: handed a deferred context, they decide with the signer
 * and open the writer after their last refusal, so a refusal leaves the tree exactly
 * as it found it (`code/tests/a-refusal-leaves-nothing.test.ts`).
 */

import { committedPublicKey, materializePublicKey } from '@mnema/chain';
import { type ScreenedWrite, screenContent, screened } from '../content/screen.js';
import { oneLine } from '../one-line.js';
import { decideAnchor, enrollKey, revokeKey } from '../workflow/identity-operations.js';
import { type DecideThenWrite, openedContext, signerOfContext } from '../workflow/operations.js';
import { decodeKeyRequest } from './handshake.js';
import { membershipIn, provesConsent, rosterOf } from './membership.js';

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
  | 'CANNOT_VOUCH'
  /** The material would have made a fact no read could accept; nothing was written. */
  | 'UNREADABLE_EVENT';

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
  ctx: DecideThenWrite,
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

  // WHO this machine is here, decided without writing — and without a writer: an
  // anchor already recorded, one the record proves it joined, or the anchor it is
  // about to found.
  const signer = signerOfContext(ctx);
  const decided = decideAnchor({ writer: signer, layout: ctx.layout, upcasters: ctx.upcasters });
  const anchor = decided.anchor;
  const fingerprint = request.key.fingerprint;

  if (!provesConsent(request.key, anchor, request.reverseSig)) {
    return {
      ok: false,
      code: 'UNPROVEN_REQUEST',
      message:
        `that request does not prove the key ${oneLine(fingerprint)} consented to join ${oneLine(anchor)} — ` +
        `a request is made for ONE identity, so check the joining machine asked to join ${oneLine(anchor)} ` +
        'and not some other',
    };
  }

  // The roster as the record proves it now. A tree with no founding yet has an
  // empty one, and this machine is about to become its only member — which is why
  // an unfounded tree may still vouch.
  const roster = rosterOf({ tree: ctx.layout.root, upcasters: ctx.upcasters }, anchor);
  if (decided.source !== 'unfounded' && !roster.has(signer.signerFingerprint)) {
    return {
      ok: false,
      code: 'CANNOT_VOUCH',
      message:
        `this machine's key is not currently valid for ${oneLine(anchor)} — the record retired it, ` +
        'so a vouch it signed would be rejected. Enroll from a machine that is still a member',
    };
  }
  if (roster.has(fingerprint)) {
    return { ok: true, fingerprint, anchor, alreadyMember: true };
  }

  // Every refusal the record can give is behind this line, so only now is the tree touched.
  const write = openedContext(ctx);
  materializePublicKey(write.layout, request.key);
  // The vouch's own refusal is forwarded rather than asserted away: it is the one
  // refusal here that is about the MATERIAL rather than the roster, and it comes
  // back with nothing appended, so the caller can hear it and act.
  const joined = enrollKey(write, { newFp: fingerprint, reverseSig: request.reverseSig });
  if (!joined.ok) return joined;
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
  /**
   * When the retired key is this machine's own: the one identity the record still proves it a
   * member of here, read after the revocation by the reading a `key restore` of that key asks —
   * absent when the record proves it a member of none, or of more than one, where a restore here
   * points this checkout nowhere.
   */
  readonly stillMemberOf?: string;
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
  | 'CONTENT_TOO_LARGE'
  /**
   * A name field of the revocation read as a credential. It cannot be the reason —
   * that is a body and is redacted — so today it is the pinned `run` or the agent
   * name on the envelope, and it is a refusal for the reason those are names.
   */
  | 'NAME_HOLDS_A_SECRET'
  /** The reason came in empty, and no read would have accepted the fact. */
  | 'UNREADABLE_EVENT';

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
  ctx: DecideThenWrite,
  input: RevokeMemberInput,
): RevokeMemberOk | RevokeMemberErr {
  const signer = signerOfContext(ctx);
  const decided = decideAnchor({ writer: signer, layout: ctx.layout, upcasters: ctx.upcasters });
  const anchor = decided.anchor;
  const roster = rosterOf({ tree: ctx.layout.root, upcasters: ctx.upcasters }, anchor);

  if (decided.source !== 'unfounded' && !roster.has(signer.signerFingerprint)) {
    return {
      ok: false,
      code: 'CANNOT_VOUCH',
      message:
        `this machine's key is not currently valid for ${oneLine(anchor)} — the record retired it, ` +
        'so a revocation it signed would have no effect. Revoke from a machine that is still a member',
    };
  }
  if (!roster.has(input.fingerprint)) {
    return {
      ok: false,
      code: 'UNKNOWN_KEY',
      message:
        `the record does not count ${oneLine(input.fingerprint)} as a key of ${oneLine(anchor)} — ` +
        'it was never enrolled here, or it was retired already',
    };
  }
  if (roster.size <= 1) {
    return {
      ok: false,
      code: 'LAST_KEY',
      message:
        `${oneLine(input.fingerprint)} is the only key ${oneLine(anchor)} has — retiring it would leave the ` +
        'identity unable to sign anything again, including a repair. Enroll the replacement ' +
        'first, then retire this one',
    };
  }

  // The reason is free text, and it is screened HERE, before the writer opens: an
  // oversize reason is a refusal like the three above, and it must leave the tree as
  // they do. The mechanism screens it again at the append, which is its own door and
  // stays one; over text this already cleaned it finds nothing, so what was replaced
  // is reported from this screening.
  const text = screenContent({ reason: input.reason });
  if (!text.ok) return text;

  // Forward the append's refusal rather than asserting success: a reason no read would
  // accept is the one refusal left, and it comes back with nothing appended.
  const revoked = revokeKey(openedContext(ctx), {
    revokedFp: input.fingerprint,
    reason: text.fields.reason,
  });
  if (!revoked.ok) return revoked;
  const self = input.fingerprint === signer.signerFingerprint;
  return {
    ok: true,
    fingerprint: input.fingerprint,
    anchor,
    self,
    remaining: roster.size - 1,
    ...(self ? stillProvenIn(ctx, input.fingerprint) : {}),
    ...screened(text.replaced),
  };
}

/**
 * The one identity the record at `ctx` still proves `fingerprint` a member of, read right after
 * its revocation.
 *
 * The checkout that retired its own key goes on recording the identity it left — nothing
 * rereads a recorded anchor — so anything it writes next is signed by a retired key and fails
 * verification for good. Where the record still proves the key in one other identity, `mnema
 * key restore` points the checkout there; this asks the question that restore asks
 * ({@link membershipIn}, over the key's committed half), so the surface never offers a restore
 * the record would refuse.
 */
function stillProvenIn(ctx: DecideThenWrite, fingerprint: string): { stillMemberOf?: string } {
  const key = committedPublicKey(ctx.layout, fingerprint);
  if (key === null) return {};
  const proven = membershipIn({ tree: ctx.layout.root, upcasters: ctx.upcasters }, key);
  return proven.ok ? { stillMemberOf: proven.anchor } : {};
}
