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
import { oneLine } from '../one-line.js';
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
  /**
   * The record proves membership in more than one identity — which one is the person's call, and
   * the record takes it only as a revocation by the identity that should not have the key. This
   * said "only as a revocation", and where the key is that identity's last, the revocation is
   * refused until another key has joined it: then the record takes it as an enrollment followed by
   * the revocation, from a checkout that writes as that identity (`ambiguityOf`).
   */
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
      message: ambiguityOf(query, key, member),
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
          `this key was revoked from ${oneLine(retiredFrom)} — a retired key that writes again ` +
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
 * The refusal of a key the record proves in more than one identity — and the ways out of it the
 * record names, or the words that say it names none.
 *
 * IT USED TO STOP AT THE REFUSAL, and the page beside it promised the write was refused "until
 * you say which" — with no command that says which. Measured on the binary, a key leaves an
 * identity in one of two ways, and the record says which one each identity allows:
 *
 *   - an identity that holds another key RETIRES it (`mnema key revoke`, from a machine that
 *     writes here as that identity, committed and shared) — so a key enrolled into two
 *     identities, having founded neither, speaks for either once the other lets it go;
 *   - an identity whose ONLY key it is cannot retire it (`LAST_KEY`), so another key joins it
 *     first — and an installation that writes as such an identity is necessarily one of THIS
 *     key's: the checkout it founded the identity from, or one it wrote as it from. There, with
 *     the record pulled, another key is enrolled, this one retired, and `mnema key restore` points
 *     the checkout at the identity the key is left in, before anything writes as the one it left.
 *
 * THIS SAID THE SECOND WAY DID NOT EXIST, twice. A key that founded an identity by writing and
 * was enrolled into another "can only go back to speaking for" the one it founded, and a key that
 * is the only key of both had "no revocation here" that separates them. The study that simulated
 * both shapes on the binary, with git clones (`the-key-two-identities-cannot-let-go`), took the
 * key out of the identity it founded both times, through the checkout that founded it: its
 * anchor is local, so it goes on writing as that identity, and it is the door. The first
 * rendering of that way out left the pull out, and a checkout that had not pulled the other
 * enrollment refused the restore (`REVOKED_KEY`). The words pull first now, and
 * `the-refusal-names-the-way-out.test.ts` follows them to the letter from a checkout that had
 * not pulled.
 *
 * WHAT IS SAID IS WHAT THE RECORD NAMES, NEVER WHAT IS IMPOSSIBLE. Whether a checkout still
 * writes as an identity is local and cannot be read here — the refusal is only ever given where
 * no anchor is recorded — so the record is asked what it CAN answer: which identities count the
 * key, as their only one or beside another (the roster the revocation checks, and both of its
 * refusals); which one the key founded; and as which the key has written, since a checkout of it
 * that writes as an identity leaves the key's signature under that identity. Where the key has
 * written as neither, the sentence says the record names no checkout that could separate them —
 * not that none exists: a commit in which the key stood alone in one of them, checked out and
 * restored, still makes one, and that is not taught.
 *
 * THE COMMAND IS HANDED OVER WHOLE, and the first version of this sentence did not hand it: it
 * stopped at the fingerprint, while `key revoke` requires `--reason`, so a person who copied the
 * words got the parser's refusal (`mnema key revoke needs --reason <text>`, exit 1) instead of
 * the way out. The words carry `--reason "<why>"` — a marker for what the person writes, quoted
 * because what they write is a sentence — and every other marker says where its value comes
 * from: `<the line>` is what the other key's request prints, and `"<the key file>"` is what the
 * revocation prints when it retires the key a machine signs with, on that machine
 * (`wiring/key.ts`) — quoted too, because a path can hold a space. Nothing here can print it:
 * which directory holds a machine's key is read where a writer opens (`openChainForWriting`) and
 * nowhere else.
 *
 * A record the product wrote cannot hold a key a roster does not count, since a vouch commits
 * the key's public half before it is appended; a tree that LOST that half can, and there the
 * reason is said as what it is — `restore.test.ts` holds that tree. With three identities or
 * more, leaving one whose only key this is still leaves the key in two, where no restore
 * chooses, so no recipe is given there: the rule is, and it is not measured.
 *
 * The key's own installation in a fresh clone cannot run any of it: it has no identity to act as
 * until this is settled. It costs a roster per identity named, and one replay for what the key
 * has written, on a refusal only.
 */
function ambiguityOf(
  query: MembershipQuery,
  key: PublicHalf,
  member: ReadonlyMap<string, Membership>,
): string {
  const anchors = [...member.keys()];
  const opening = `this key belongs to more than one identity in that record (${oneLine(anchors.join(', '))}) — which one it should speak for here is not a choice to make on its behalf`;
  // An identity can retire this key only where its roster counts the key and holds another: the
  // revocation refuses a key it does not count, and the last one.
  const rosters = new Map(anchors.map((anchor) => [anchor, rosterOf(query, anchor)] as const));
  const counts = (anchor: string): boolean => rosters.get(anchor)?.has(key.fingerprint) === true;
  const keeps = anchors.filter(
    (anchor) => !counts(anchor) || (rosters.get(anchor)?.size ?? 0) <= 1,
  );
  const revoke = `\`mnema key revoke ${key.fingerprint} --reason "<why>"\``;
  if (keeps.length === 0) {
    return `${opening}. It speaks for one of them again once the ${anchors.length === 2 ? 'other lets' : 'others let'} it go: a machine whose writes here speak for ${anchors.length === 2 ? 'the identity' : 'each identity'} that should not have it runs ${revoke} inside this project, and commits and shares the record — the key then speaks for the identity left`;
  }

  // An identity whose only key this is has no installation writing as it but this key's own, so
  // what the record can name is where this key has written.
  const wroteAs = new Set<string>();
  for (const event of orderedEvents({ root: query.tree }, query.upcasters)) {
    if (event.signerFp === key.fingerprint) wroteAs.add(event.who);
  }
  const how = (anchor: string): string =>
    member.get(anchor) === 'founded'
      ? 'the identity it founded here'
      : 'an identity it has written here as';
  // The way out of `left` through the checkout that writes as it, when that leaves the key in
  // `rest` alone — the one shape where a restore there points the checkout somewhere.
  const through = (left: string, rest: string): string =>
    `in ${member.get(left) === 'founded' ? 'the checkout it founded' : 'a checkout it wrote here as'} ${oneLine(left)} from — which, if it is still there, goes on writing as ${oneLine(left)} — pull the record, enroll the other key with \`mnema key enroll <the line>\` (the line \`mnema key request --anchor ${oneLine(left)}\` prints where that key lives), retire this one with ${revoke} — which, run there, prints where that machine keeps the key file — run \`mnema key restore "<the key file>"\` there before anything else writes, then commit and share the record: a fresh clone then writes as ${oneLine(rest)}`;

  const [kept] = keeps;
  if (keeps.length === 1 && kept !== undefined) {
    const letsGo = anchors.filter((anchor) => anchor !== kept);
    const first = `${opening}. It speaks for ${oneLine(kept)} again once ${oneLine(letsGo.join(' and '))} ${letsGo.length === 1 ? 'lets' : 'let'} it go: a machine whose writes here speak for ${letsGo.length === 1 ? oneLine(letsGo.join(' and ')) : 'each of them'} runs ${revoke} inside this project, and commits and shares the record`;
    const [other] = letsGo;
    if (letsGo.length !== 1 || other === undefined || !counts(kept) || !wroteAs.has(kept)) {
      return first;
    }
    return `${first}. Or it can leave ${oneLine(kept)} instead — ${how(kept)}, whose only key it is, so another key joins it first: ${through(kept, other)}`;
  }

  const last = keeps.filter(counts);
  const uncounted = keeps.filter((anchor) => !counts(anchor));
  const doors = last.filter((anchor) => wroteAs.has(anchor));
  const shut = last.filter((anchor) => !wroteAs.has(anchor));
  const said: string[] = [];
  if (last.length > 0) {
    said.push(
      `It is the only key ${oneLine(last.join(' and '))} ${last.length === 1 ? 'has' : 'have'}, and an identity's last key cannot be retired, so it leaves ${last.length === 1 ? 'that identity' : 'one of them'} only once another key has joined that one`,
    );
  }
  if (uncounted.length > 0) {
    said.push(
      `The record does not count this key among the keys of ${oneLine(uncounted.join(' and '))}, so no revocation there takes it out`,
    );
  }
  for (const left of anchors.length === 2 ? doors : []) {
    const rest = anchors.find((anchor) => anchor !== left) as string;
    said.push(`It can leave ${oneLine(left)}, ${how(left)}: ${through(left, rest)}`);
  }
  if (doors.length === 0 && shut.length > 1) {
    said.push(
      `This key has not written here as ${shut.length === 2 ? 'either' : 'any of them'}, so the record names no checkout that could separate them`,
    );
  } else {
    for (const closed of shut) {
      said.push(
        `The record names no checkout that could take it out of ${oneLine(closed)}: this key has not written here as ${oneLine(closed)}`,
      );
    }
  }
  return `${opening}. ${said.join('. ')}`;
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
