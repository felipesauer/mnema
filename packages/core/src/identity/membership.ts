/**
 * What a record proves about a signing key: WHICH identity it belongs to, and
 * which keys an identity currently has.
 *
 * This is the one place that reads membership out of the chain, and it exists
 * because two very different moments need exactly the same answer. A key brought
 * back onto a machine must learn which anchor it may sign as (see restore), and a
 * machine writing to a tree for the first time must learn the same thing before
 * its first fact — otherwise it derives its OWN anchor and founds a second
 * identity in a record the team shares. One reading, one verdict: the two cannot
 * disagree about who a key is.
 *
 * Three facts decide it, and they are folded in the chain's own order, so a key
 * enrolled, revoked, and enrolled again ends a member exactly as the verifier
 * would judge it. What is NOT taken on faith is the consent: an enrollment names
 * a fingerprint, and anyone can write a fingerprint down. Only the signature the
 * new key itself made over `enroll:<anchor>:<fp>` proves it agreed to join, so
 * that signature is re-verified here against the key it names — otherwise any
 * repository could hand a key an identity by merely naming it, and the key would
 * sign as an anchor it never joined.
 *
 * A revocation is honored whether or not it is signature-covered, which is
 * deliberately STRICTER than the verifier. The verifier ignores a residual revoke
 * so a keyless party cannot deny an honest chain; here the worst a wrongly-honored
 * revoke can do is refuse an operation the person can retry, while the worst a
 * wrongly-IGNORED one can do is write under a retired key — permanently failing
 * verification, and unappendable-back. The asymmetry decides, not the symmetry.
 */

import {
  type ChainLayout,
  committedPublicKey,
  deriveAnchor,
  enrollmentMessage,
  type PublicHalf,
  type UpcasterRegistry,
  verifySignature,
} from '@mnema/chain';
import { orderedEvents } from '../projections/order.js';

/** Which record to read, and how to read events written under older contracts. */
export interface MembershipQuery {
  /** The chain root whose facts decide — a tree, never a key root. */
  readonly tree: string;
  readonly upcasters: UpcasterRegistry;
}

/** How a record proves a key belongs to the anchor it serves. */
export type Membership =
  /** The key founded this anchor — it is the identity's first key. */
  | 'founded'
  /** A member vouched for the key, and the key's own signature proves it consented. */
  | 'enrolled';

/** Why a record does not name one identity for a key. */
export type MembershipRefusalCode =
  /** Nothing in the record proves this key belongs to any identity. */
  | 'NOT_A_MEMBER'
  /** The record proves the key belonged to an identity and was retired from it. */
  | 'REVOKED_KEY'
  /** The record proves membership in more than one identity — which one is the person's call. */
  | 'AMBIGUOUS_MEMBERSHIP';

/** The record proves this key belongs to exactly one identity. */
export interface MembershipProven {
  readonly ok: true;
  /** The anchor the key authorizes as. */
  readonly anchor: string;
  readonly membership: Membership;
}

/** The record does not name one identity for this key. */
export interface MembershipRefused {
  readonly ok: false;
  readonly code: MembershipRefusalCode;
  /** Plain-language reason, to be reported to the person as-is. */
  readonly message: string;
}

/**
 * Raised when a machine cannot decide WHICH identity it speaks for in a tree, so
 * it refuses to write rather than guess.
 *
 * A thrown refusal, not a returned one, because the decision sits below every
 * gated write: an operation calls it before its first fact, and there is no
 * honest way to continue past "I do not know who I am". A caller that has to
 * choose an identity on the person's behalf has already lost the property the
 * record exists for — one person, one anchor, provably.
 */
export class IdentityUnavailableError extends Error {
  override readonly name = 'IdentityUnavailableError';
  constructor(
    readonly code: MembershipRefusalCode,
    message: string,
  ) {
    super(message);
  }
}

/**
 * The identity this record proves the key currently belongs to.
 *
 * The key is passed as its PUBLIC half so both callers can answer with what they
 * hold: a restore derives the half from the private key it was handed, while a
 * machine about to write reads the half the tree already carries. Either way the
 * half is bound to its fingerprint, so the consent signature is checked against
 * the key the enrollment names and not against whatever a file happens to hold.
 */
export function membershipIn(
  query: MembershipQuery,
  key: PublicHalf,
): MembershipProven | MembershipRefused {
  /** Anchors this key currently belongs to, and how each is proven. */
  const member = new Map<string, Membership>();
  /** Anchors that retired this key and did not take it back. */
  const retired = new Set<string>();

  for (const fact of enrollmentFacts(query)) {
    if (fact.fingerprint !== key.fingerprint) continue;
    switch (fact.kind) {
      case 'founded':
        member.set(fact.anchor, 'founded');
        retired.delete(fact.anchor);
        break;
      case 'enrolled':
        // The part only this key's holder could have produced. Everything else an
        // enrollment asserts, a stranger's record could assert too.
        if (!provesConsent(key, fact.anchor, fact.reverseSig)) break;
        // A founding is the stronger fact about the same anchor; keep it.
        if (!member.has(fact.anchor)) member.set(fact.anchor, 'enrolled');
        retired.delete(fact.anchor);
        break;
      case 'revoked':
        member.delete(fact.anchor);
        retired.add(fact.anchor);
        break;
    }
  }

  const anchors = [...member.keys()];
  if (anchors.length > 1) {
    return {
      ok: false,
      code: 'AMBIGUOUS_MEMBERSHIP',
      message:
        `this key belongs to more than one identity in that record (${anchors.join(', ')}) — ` +
        'which one it should speak for here is not a choice to make on its behalf',
    };
  }
  const anchor = anchors[0];
  if (anchor === undefined) {
    const [retiredFrom] = [...retired];
    if (retiredFrom !== undefined) {
      return {
        ok: false,
        code: 'REVOKED_KEY',
        message:
          `this key was revoked from ${retiredFrom} — a retired key that writes again ` +
          'leaves the whole record failing verification, so it is not brought back',
      };
    }
    return {
      ok: false,
      code: 'NOT_A_MEMBER',
      message:
        `nothing in that record proves the key ${key.fingerprint} belongs to an identity — ` +
        'a key becomes a member where another member vouched for it, while that member still held its key',
    };
  }
  return { ok: true, anchor, membership: member.get(anchor) as Membership };
}

/**
 * The keys currently valid for one anchor in this record — the identity's roster,
 * folded the way the verifier folds it.
 *
 * A key counts only when its membership is PROVEN here and now: a founding that
 * binds its own key, or an enrollment whose consent signature verifies against
 * the committed public key it names. An enrollment the verifier would reject
 * therefore does not inflate the roster — which matters most where the count is
 * load-bearing, because "this is the last key" must never be wrong about a key
 * that cannot actually sign.
 */
export function rosterOf(query: MembershipQuery, anchor: string): Set<string> {
  const valid = new Set<string>();
  const layout: ChainLayout = { root: query.tree };
  for (const fact of enrollmentFacts(query)) {
    if (fact.anchor !== anchor) continue;
    switch (fact.kind) {
      case 'founded':
        valid.add(fact.fingerprint);
        break;
      case 'enrolled': {
        const key = committedPublicKey(layout, fact.fingerprint);
        if (key === null) break;
        if (!provesConsent(key, anchor, fact.reverseSig)) break;
        valid.add(fact.fingerprint);
        break;
      }
      case 'revoked':
        valid.delete(fact.fingerprint);
        break;
    }
  }
  return valid;
}

/** One structurally sound membership fact, in the order the record carries it. */
type EnrollmentFact =
  | { readonly kind: 'founded'; readonly anchor: string; readonly fingerprint: string }
  | {
      readonly kind: 'enrolled';
      readonly anchor: string;
      readonly fingerprint: string;
      readonly reverseSig: string;
    }
  | { readonly kind: 'revoked'; readonly anchor: string; readonly fingerprint: string };

/**
 * Walks the record and yields the membership facts whose ENVELOPE holds up,
 * dropping the malformed ones — an event that fails these bindings is not a
 * decision about a key, it is a broken event, and the verifier reports it as one.
 *
 * The bindings are the verifier's own: a founding must be self-signed by its
 * founding key and name the anchor that derives from it, and every fact must be
 * authorized by the very anchor it concerns. What is deliberately NOT checked
 * here is the consent signature — that depends on which key the caller can prove,
 * so each caller applies it.
 */
function* enrollmentFacts(query: MembershipQuery): Generator<EnrollmentFact> {
  for (const event of orderedEvents({ root: query.tree }, query.upcasters)) {
    const anchor = event.subject;
    if (event.who !== anchor) continue;
    switch (event.kind) {
      case 'identity.founded': {
        const { foundingFp } = event.payload;
        // The two bindings the verifier requires of a founding: the founding key
        // signed it, and the anchor derives from that key.
        if (event.signerFp !== foundingFp) break;
        if (anchor !== deriveAnchor(foundingFp)) break;
        yield { kind: 'founded', anchor, fingerprint: foundingFp };
        break;
      }
      case 'key.enrolled':
        yield {
          kind: 'enrolled',
          anchor,
          fingerprint: event.payload.newFp,
          reverseSig: event.payload.reverseSig,
        };
        break;
      case 'key.revoked':
        yield { kind: 'revoked', anchor, fingerprint: event.payload.revokedFp };
        break;
      default:
        break;
    }
  }
}

/**
 * Whether `reverseSig` is this key's own signature over `enroll:<anchor>:<fp>` —
 * the proof of consent, and the one part of an enrollment only the joining key's
 * holder can produce.
 *
 * Exported because it is checked in two moments that must agree: when a member
 * decides whether to vouch for a request at all, and when the record is later read
 * to decide whose identity that key belongs to. Two readings of one signature is
 * how a tree ends up carrying an enrollment its own verifier rejects.
 */
export function provesConsent(key: PublicHalf, anchor: string, reverseSig: string): boolean {
  try {
    return verifySignature(
      enrollmentMessage(anchor, key.fingerprint),
      Buffer.from(reverseSig, 'hex'),
      key.publicKey,
    );
  } catch {
    return false;
  }
}
