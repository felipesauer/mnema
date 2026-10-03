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
  anchorPath,
  type CatalogEvent,
  type ChainLayout,
  CodedError,
  committedPublicKey,
  deriveAnchor,
  enrollmentMessage,
  type PublicHalf,
  publicKeyPath,
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

/**
 * Why a machine does not write as an identity in a tree: the three answers the record gives about
 * a KEY ({@link MembershipRefusalCode}), and the one it gives about a CHECKOUT.
 */
export type IdentityRefusalCode =
  | MembershipRefusalCode
  /**
   * This checkout recorded the identity it writes as, and the record does not count its key among
   * that identity's keys — it was retired from it, or it never was one of them
   * ({@link staleAnchorRefusal}).
   */
  | 'STALE_ANCHOR'
  /**
   * The key is enrolled in this tree as a CHECKER: it signs check results under its own anchor
   * and nothing else, so founding an identity with it would be a fact the record refuses.
   */
  | 'A_CHECKER_KEY';

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
export class IdentityUnavailableError extends CodedError {
  override readonly name = 'IdentityUnavailableError';
  constructor(
    readonly code: IdentityRefusalCode,
    message: string,
    /**
     * The fingerprint of this machine's key, where the way out the message names is `mnema key
     * restore "<the key file>"` — so the surface can say where that file is. Only a surface can:
     * the key root is read where a writer opens and nowhere else (`openChainForWriting`), and
     * the message is written below it.
     */
    readonly restores?: string,
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

  for (const fact of enrollmentFactsOf(orderedEvents({ root: query.tree }, query.upcasters))) {
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
 * WHERE THE OTHER KEY LIVES WAS SAID FOR ONE PLACE, another machine. The other key can be a copy
 * this machine keeps — the backup key an `init` made is one, and its path is what that `init`
 * printed — and a person who asked for it here without `--key` asked for THIS key instead:
 * measured on the binary, the enrollment answered *already in <identity> — nothing recorded* and
 * the revocation refused `LAST_KEY`. The words name `--key "<its file>"` for that copy now, and the
 * way out done with the backup is followed to the letter in `the-refusal-names-the-way-out.test.ts`.
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
    `in ${member.get(left) === 'founded' ? 'the checkout it founded' : 'a checkout it wrote here as'} ${oneLine(left)} from — which, if it is still there, goes on writing as ${oneLine(left)} — pull the record, enroll the other key with \`mnema key enroll <the line>\` (the line \`mnema key request --anchor ${oneLine(left)}\` prints where that key lives — or, for a copy of a key this machine keeps, as the backup key an \`init\` made is, \`mnema key request --anchor ${oneLine(left)} --key "<its file>"\` on this machine), retire this one with ${revoke} — which, run there, prints where that machine keeps the key file — run \`mnema key restore "<the key file>"\` there before anything else writes, then commit and share the record: a fresh clone then writes as ${oneLine(rest)}`;

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
 * The refusal of a write from a checkout whose recorded identity does not count its key — and the
 * way out the record names, or the words that say what is true instead.
 *
 * THE TRAP IT CLOSES. A checkout records, locally, the identity it writes as, and nothing read
 * that record again: a key that LEFT the identity — retired from its roster by this checkout's
 * own `mnema key revoke`, or by another member and pulled in — went on signing as it, every write
 * exited 0, and `verify` failed on the whole record from then on, for good (*"event signer <K> is
 * not a key enrolled for <I>"*). Measured on the binary with git clones in both shapes, and in the
 * second one with no warning anywhere. The write is refused now, before anything is appended
 * (`ensureFounded`, which asks before every append whether the recorded identity still counts
 * the key).
 *
 * IT IS A REFUSAL, NEVER A REDIRECTION. The anchor is not decided again from the record here, and
 * that is load-bearing: the checkout that founded an identity is the door out of it (the way out
 * {@link ambiguityOf} names runs there), and a checkout that re-decided its anchor by the record
 * mid-way would find the key in two identities, refuse AMBIGUOUS, and close the one door there
 * is. So the words say which command points the checkout elsewhere, and the person runs it.
 *
 * What the record lets it say:
 *   - the key is a member of ONE other identity: `mnema key restore` of this machine's key file
 *     makes the checkout write as it — the restore the way out already ends with, and the file is
 *     printed by the surface, which alone knows the key root ({@link IdentityUnavailableError});
 *   - of NONE: nothing it signs would verify, and the record read is the copy this checkout
 *     holds — a pull may bring the enrollment into the other identity that the restore needs, so
 *     the words say that too, as the revocation of this machine's own key does;
 *   - of MORE THAN ONE: the ambiguity, in the words a fresh clone is given;
 *   - of nothing, EVER — no founding by this key and no enrollment of it: the anchor was recorded
 *     ahead of a founding that never landed, which the code before the anchor followed the
 *     founding left behind, so there is no identity to leave, and the way out is deleting the
 *     file: the next write decides again, from the record, as a first write does;
 *   - and where the tree carries no public half for the key, an enrollment of it cannot be
 *     proven, so a record that names the key is said to lack the half — never answered with the
 *     deletion, after which the next write would found a second identity.
 *
 * `a-stale-anchor-writes-nothing.test.ts` asks each case of the core; the binary's are in
 * `code/tests/the-checkout-a-key-left.test.ts`, followed to the letter. It costs a replay per
 * question it can answer, and it is only ever asked on a refusal.
 */
export function staleAnchorRefusal(
  query: MembershipQuery,
  fingerprint: string,
  anchor: string,
): IdentityUnavailableError {
  const layout: ChainLayout = { root: query.tree };
  // Each sentence is written out whole rather than assembled from shared pieces, so the words a
  // person is shown are the words a search of this file finds.
  const stale = (message: string, restores?: string): IdentityUnavailableError =>
    restores === undefined
      ? new IdentityUnavailableError('STALE_ANCHOR', message)
      : new IdentityUnavailableError('STALE_ANCHOR', message, restores);

  const half = committedPublicKey(layout, fingerprint);
  // No half, no enrollment of this key can be proven — but a founding needs none, and the record
  // may still NAME the key. Only a record that names it nowhere is the anchor recorded ahead of a
  // founding; one that names it lost the half.
  const named =
    half === null &&
    [...enrollmentFactsOf(orderedEvents(layout, query.upcasters))].some(
      (fact) => fact.fingerprint === fingerprint,
    );
  if (named) {
    return stale(
      `this checkout records ${oneLine(anchor)} as the identity it writes as, and the record does not count this key among that identity's keys: this tree does not carry the key's public half (${oneLine(publicKeyPath(layout, fingerprint))}), without which the record cannot prove which identity the key belongs to — it is committed beside the enrollment that brought the key in`,
    );
  }
  const proven = half === null ? undefined : membershipIn(query, half);
  if (proven?.ok === true) {
    return stale(
      `this checkout records ${oneLine(anchor)} as the identity it writes as, and the record does not count this key among that identity's keys — a write signed with it there would leave the whole record failing verification, so none is made. The record proves the key a member of ${oneLine(proven.anchor)}: \`mnema key restore "<the key file>"\` here makes this checkout write as it`,
      fingerprint,
    );
  }
  if (proven?.code === 'REVOKED_KEY') {
    return stale(
      `this checkout records ${oneLine(anchor)} as the identity it writes as, and the record does not count this key among that identity's keys, nor among the keys of any other identity here: it was retired — a write signed with it there would leave the whole record failing verification, so none is made. If the record, once pulled, proves it a member of another identity, \`mnema key restore "<the key file>"\` here makes this checkout write as it`,
      fingerprint,
    );
  }
  if (proven?.code === 'AMBIGUOUS_MEMBERSHIP') {
    return stale(
      `this checkout records ${oneLine(anchor)} as the identity it writes as, and the record does not count this key among that identity's keys; ${proven.message}`,
    );
  }
  // NOT_A_MEMBER, or no half and nothing that names the key: nothing in the record ever held it.
  return stale(
    `this checkout records ${oneLine(anchor)} as the identity it writes as, and nothing in the record founded an identity with this key or enrolled it into one — there is no identity for it to leave: delete ${oneLine(anchorPath(layout, fingerprint))}, and the next write here decides again, from the record, as a first write does`,
  );
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
  return rosterIn(orderedEvents({ root: query.tree }, query.upcasters), query.tree, anchor);
}

/**
 * {@link rosterOf} over events a caller already holds, in the record's order — THE SAME FOLD,
 * so a roster read off a session's retained replay and one read off a fresh replay cannot come
 * to disagree about a key. `tree` is where the public half an enrollment names is read, as it is
 * for a replay.
 *
 * It exists for the one reading that runs before every write: whether the identity a checkout
 * recorded still counts its key ({@link staleAnchorRefusal}). A replay is linear in the record,
 * and a session that already holds the record in order pays only for what arrived since
 * (`ProjectionCache.rosterAsOfNow`).
 */
export function rosterIn(
  events: Iterable<CatalogEvent>,
  tree: string,
  anchor: string,
): Set<string> {
  const valid = new Set<string>();
  const layout: ChainLayout = { root: tree };
  for (const fact of enrollmentFactsOf(events)) {
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
function* enrollmentFactsOf(events: Iterable<CatalogEvent>): Generator<EnrollmentFact> {
  for (const event of events) {
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
