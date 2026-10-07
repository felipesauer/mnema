/**
 * Enrollment resolution: WHO a signing key speaks for, folded from the chain.
 *
 * An identity is one anchor with N keys enrolled by signature. The membership
 * lives in the chain itself as three facts (see the catalog): `identity.founded`
 * mints an anchor from its founding key, `key.enrolled` brings a new key in
 * (vouched by an existing member, with the new key's own proof-of-possession),
 * and `key.revoked` retires a key from that point forward. Folding those facts
 * in the chain's deterministic order yields, at every point, the set of keys
 * valid for each anchor.
 *
 * The rule this feeds is single and total: an event is authentic only if its
 * `signerFp` is valid for its `who` AT THAT POINT in the fold. There is no
 * degenerate "the anchor is my own key" shortcut — a lone key still founds its
 * anchor with an `identity.founded`, so one key is just a one-member set. That
 * one rule replaces the old `who == deriveAnchor(signerFp)` check: identity is
 * membership, proven on the chain, nothing else.
 *
 * Why the fold runs across ALL tails in one order: enrollment is an identity
 * concern, not a per-tail one — a key enrolled on one machine's tail authorizes
 * events on another's. The order is the SAME merge a projection uses
 * ({@link causalOrder}: `seq` inviolable within a tail, and across tails the
 * smallest `at` among the heads whose citations have been taken), so
 * enroll/revoke that race across tails resolve deterministically, the same way
 * state does.
 *
 * A key's first event must fall AFTER its enrollment in that order, or the fold
 * sees the event before the key is valid and rejects it. `at` alone does not
 * give that: it is the wall clock of each machine, and a second machine whose
 * clock is behind the enroller's stamps its first event before the enrolment —
 * an honest record the fold used to refuse. What gives it is the citation: the
 * new machine's first event cites the head of the enroller's tail it had read,
 * which is at or after the enrolment, so the event cannot be taken before it
 * whatever the two clocks say. Without a citation the order is the one `at`
 * gives, exactly as before citations existed. A machine that founds its OWN
 * tail (the copy-key and solo cases) is immune either way: its founding is seq
 * 0 of its own tail, always ahead of its later events.
 *
 * What this fold does and does not decide, stated plainly: it judges whether an
 * event's `signerFp` is a member of its `who`, not whether the tail the event
 * sits in is genuine. A keyless party who fabricates a tail under a real
 * enrolled fingerprint would name a valid signer and pass THIS check — but that
 * tail is refused earlier by the verifier, which requires every tail to carry a
 * proof that its key signed its own id (see tailproof.ts and verify.ts). So the
 * fold only ever runs over tails whose key owns them; a fabricated sibling never
 * reaches it. A tail under a NON-enrolled fingerprint is caught here too (its
 * events fail membership). Above the last checkpoint the events still rest on
 * the hash chain alone, so `fullySigned` reports the residual honestly.
 *
 * Which enrollment facts the fold trusts from that residual window turns on one
 * question: can the fact alter the validity of SIGNED history? A `key.revoked`
 * plainly can — it removes a key that judges OTHER, possibly checkpointed,
 * events. So a residual `key.revoked` could let a keyless party fabricate a tail
 * under a real enrolled fingerprint (permitted in the residual), revoke a member
 * from it, and flip an HONEST, fully-signed chain to failing — a
 * denial-of-authenticity with no key. To close that, a `key.revoked` takes
 * effect ONLY when it is itself signature-covered (within a verified checkpoint
 * range): a keyless party cannot checkpoint a fabricated tail (a checkpoint needs
 * the tail's private key), so their revocation stays residual and never removes a
 * key. A legitimate revocation is made effective by its owner checkpointing it
 * (the identity operation does so at once).
 *
 * An ADDITION (`identity.founded`, `key.enrolled`) is USUALLY safe ungated — it
 * only empowers events that name the added key, so a keyless residual enroll of
 * a genuine key just recreates that key's own (already-untrusted) window, no
 * different from a benign second install. There is ONE exception, and it is the
 * mirror of the revoke gate: an addition ordered AFTER a signature-covered
 * revoke of the SAME key RESTORES it, re-authorizing that key's later
 * (checkpointed) work — the addition thereby undoes a signed removal. So an
 * addition that would restore a covered-revoked key is gated exactly as the
 * revoke was: it takes effect only when it is itself signature-covered
 * (`addKeyGated`). A first enrollment, or any addition that restores nothing
 * covered, stays ungated. The invariant that keeps this honest is not "forged
 * events stay residual" — a forged event's authorship is signature-checked
 * elsewhere — it is that neither a revoke nor a restoring add can be forged INTO
 * a signature-covered range without the tail's key; consumers must therefore
 * gate trust on whole-chain `fullySigned`, never on a per-tail checkpoint cursor
 * or an event's mere absence from `issues`.
 */

import { checkerEnrollmentMessage, enrollmentMessage } from '../events/build.js';
import type { CatalogEvent } from '../events/catalog.js';
import { oneLine } from '../one-line.js';
import { causalOrder, type OrderKeys } from './causal-order.js';
import type { Entry } from './entry.js';
import { deriveAnchor, verify as verifySignature } from './keys.js';
import type { ChainLayout } from './layout.js';
import { type CommittedKeys, committedKeys } from './store.js';

/** A problem found while resolving identity by enrollment. */
export interface IdentityIssue {
  readonly tail: string;
  readonly seq: number;
  readonly detail: string;
}

/** The result of folding enrollment across the whole chain. */
export interface IdentityResolution {
  readonly issues: readonly IdentityIssue[];
  /**
   * The keys valid for each anchor once the whole chain is folded — what the record proves a
   * member of an identity now, founded or enrolled and not revoked under coverage. The census
   * asks it before calling a key a backup: a registration says what a key was made FOR, and
   * only the record says whether the identity took it in.
   */
  readonly members: ReadonlyMap<string, ReadonlySet<string>>;
  /**
   * Every checker key a signature-covered `checker.retired` took out of the role, by
   * fingerprint: who retired it, where, and how many results it signed BEFORE — results the
   * fold accepted, because the key held the role when it signed, and which the census names,
   * because "before" is placed by the `at` the key itself wrote.
   */
  readonly retiredCheckers: ReadonlyMap<string, RetiredChecker>;
  /**
   * The keys a signature-covered `backup.declared` says are an identity's backup, each with that
   * identity (FORMAT.md section 6.5). A declaration is about how a key with no tail is SAID, so it
   * is kept here for the census and decides nothing about which events are authentic; the census
   * still asks {@link members} whether the key is the identity's at the end of the fold.
   */
  readonly backups: ReadonlyMap<string, string>;
  /** What the order made of the citations the record carries. */
  readonly citations: CitationsRead;
}

/** A checker key the record retired (FORMAT.md section 6.2). */
export interface RetiredChecker {
  /** The identity that retired it. */
  readonly by: string;
  /** Where the retirement sits. */
  readonly tail: string;
  readonly seq: number;
  /** How many `check.passed`/`check.failed` it signed that the fold accepted before it. */
  readonly resultsBefore: number;
}

/**
 * What the order made of the citations a record carries (FORMAT.md, "Reading many tails") —
 * informational, for the census: neither list ever makes an event less authentic.
 */
export interface CitationsRead {
  /** Every citation of an entry hash the record does not hold, which the order ignored. */
  readonly notHeld: readonly {
    readonly tail: string;
    readonly seq: number;
    readonly hash: string;
  }[];
  /**
   * Every event whose `at` is earlier than the `at` of an entry it cites — a writer's clock
   * that ran behind what it had read — with the largest such gap, in milliseconds.
   */
  readonly behind: readonly {
    readonly tail: string;
    readonly seq: number;
    readonly byMs: number;
  }[];
}

/**
 * Folds the enrollment facts across every tail, in deterministic order, and
 * checks that each event's signer is valid for its anchor at its point. Returns
 * the identity issues found (empty when every event's identity resolves).
 *
 * The public keys are needed only to verify a `key.enrolled`'s reverse
 * signature (the new key's proof-of-possession), read from the committed roster.
 *
 * `checkpointedThroughByTail` gives the highest signature-covered seq per tail
 * (-1 if none). It gates any mutation that could alter signed history: a
 * `key.revoked` (removes a key that judges other events), and an addition that
 * would RESTORE a key already revoked under coverage (`addKeyGated`). A first
 * enrollment — restoring nothing covered — is not gated. See the module doc.
 *
 * `keys` is who reads those committed keys, and the verifier hands in its own: the key
 * that proves an enrolment is the key the checkpoints of that machine's tail are checked
 * against, and with a reader of its own this fold opened that file a second time for every
 * `key.enrolled` naming it. Handed the verifier's, it opens nothing the verification has
 * already read — `verify-costs-what-the-record-holds.test.ts` counts one read per key
 * across both. Left out, the fold reads each key itself, once.
 */
export function resolveIdentity(
  layout: ChainLayout,
  entriesByTail: ReadonlyMap<string, readonly Entry[]>,
  checkpointedThroughByTail: ReadonlyMap<string, number>,
  keys: CommittedKeys = committedKeys(layout),
): IdentityResolution {
  const { order, citations } = totalOrder(entriesByTail);
  const isCheckpointed = (tail: string, seq: number): boolean =>
    seq <= (checkpointedThroughByTail.get(tail) ?? -1);
  const validKeys = new Map<string, Set<string>>();
  const issues: IdentityIssue[] = [];

  const keysOf = (anchor: string): Set<string> => {
    let set = validKeys.get(anchor);
    if (set === undefined) {
      set = new Set<string>();
      validKeys.set(anchor, set);
    }
    return set;
  };

  // Keys removed by a signature-covered revocation, as `<anchor>|<fp>`. An
  // addition (founded/enrolled) that would restore such a key takes effect only
  // when it is ITSELF signature-covered — otherwise a keyless party could plant
  // a residual re-enroll ordered after a covered revoke and silently undo it,
  // re-authorizing the removed key's later (checkpointed) work. This mirrors the
  // revoke gate: a mutation that alters the validity of signed history must be
  // signed. An addition that restores nothing covered stays ungated (a first
  // enrollment, a benign copy-key second install).
  const coveredRevoked = new Set<string>();
  const restoreKey = (anchor: string, fp: string): string => `${anchor}|${fp}`;
  const addKeyGated = (anchor: string, fp: string, tail: string, seq: number): void => {
    if (coveredRevoked.has(restoreKey(anchor, fp))) {
      if (!isCheckpointed(tail, seq)) {
        // Residual re-add of a covered-revoked key: ignored, stays residual.
        issues.push({
          tail,
          seq,
          detail: `re-adds ${oneLine(fp)} revoked under signature coverage without being checkpointed itself`,
        });
        return;
      }
      // A signed re-enrollment legitimately supersedes the covered revoke.
      coveredRevoked.delete(restoreKey(anchor, fp));
    }
    keysOf(anchor).add(fp);
  };

  // The keys enrolled as CHECKERS at this point: they sign check results and nothing else.
  const checkers = new Set<string>();
  // How many results each checker key signed that this fold accepted — what a later
  // retirement reports as signed before it.
  const resultsSigned = new Map<string, number>();
  // The keys a signature-covered `checker.retired` took out of the role. A retired key signs
  // NOTHING from then on: not a result, not any other kind, and it is never enrolled again.
  const retired = new Map<string, RetiredChecker>();
  // The keys a covered `backup.declared` names, with the identity that declared them.
  const backups = new Map<string, string>();

  for (const { tail, entry } of order) {
    const event = entry.event;
    const seq = entry.link.seq;
    // The role, both ways. A checker key that signs anything but a check result is refused
    // before the kind is even looked at — its own founding, an enrolment, a decision — so a
    // leaked runner secret can say a check passed and nothing more.
    const isCheckResult = event.kind === 'check.passed' || event.kind === 'check.failed';
    if (retired.has(event.signerFp)) {
      issues.push({
        tail,
        seq,
        detail: `${oneLine(event.kind)} is signed by ${oneLine(event.signerFp)}, a checker key retired at this point, which signs nothing`,
      });
      continue;
    }
    if (!isCheckResult && checkers.has(event.signerFp)) {
      issues.push({
        tail,
        seq,
        detail: `${oneLine(event.kind)} is signed by ${oneLine(event.signerFp)}, a checker key, which signs check results only`,
      });
      continue;
    }
    switch (event.kind) {
      case 'identity.founded': {
        // The anchor must derive from the founding key, and the founding key
        // must sign its own founding — no one founds an identity onto a key they
        // do not hold, and no one invents an anchor unmoored from a key.
        const { foundingFp } = event.payload;
        if (event.signerFp !== foundingFp) {
          issues.push({
            tail,
            seq,
            detail: 'identity.founded is not self-signed by its founding key',
          });
          break;
        }
        if (event.subject !== deriveAnchor(foundingFp)) {
          issues.push({
            tail,
            seq,
            detail: 'identity.founded subject is not the anchor derived from the founding key',
          });
          break;
        }
        if (event.who !== event.subject) {
          issues.push({ tail, seq, detail: 'identity.founded who is not the anchor it founds' });
          break;
        }
        addKeyGated(event.subject, foundingFp, tail, seq);
        break;
      }
      case 'key.enrolled': {
        // The voucher (signerFp) must be valid for the anchor AT THIS POINT, and
        // the new key must prove possession by signing enroll:<anchor>:<newFp>.
        // Both are required: the first stops a stranger self-enrolling, the
        // second stops a member enrolling a key it does not control.
        const anchor = event.subject;
        const { newFp, reverseSig } = event.payload;
        if (event.who !== anchor) {
          issues.push({ tail, seq, detail: 'key.enrolled who is not the anchor it enrolls into' });
          break;
        }
        if (!keysOf(anchor).has(event.signerFp)) {
          issues.push({
            tail,
            seq,
            detail: 'key.enrolled is signed by a key not valid for the anchor at this point',
          });
          break;
        }
        if (!reverseSignatureOk(keys, anchor, newFp, reverseSig)) {
          issues.push({
            tail,
            seq,
            detail: 'key.enrolled reverse signature does not prove possession of the new key',
          });
          break;
        }
        addKeyGated(anchor, newFp, tail, seq);
        break;
      }
      case 'key.revoked': {
        // A peer valid for the anchor at this point removes another key, going
        // forward only. An invalid revoker is an issue and has no effect.
        const anchor = event.subject;
        if (event.who !== anchor) {
          issues.push({ tail, seq, detail: 'key.revoked who is not the anchor it revokes from' });
          break;
        }
        if (!keysOf(anchor).has(event.signerFp)) {
          issues.push({
            tail,
            seq,
            detail: 'key.revoked is signed by a key not valid for the anchor at this point',
          });
          break;
        }
        // A revocation removes a key that judges OTHER events, so it is trusted
        // to take effect only when signature-covered. A residual (uncheckpointed)
        // revoke is ignored — a keyless party cannot sign a checkpoint over a
        // fabricated tail, so this forecloses their revoking a member to flip an
        // honest signed chain to failing. A legitimate revoker checkpoints it.
        if (!isCheckpointed(tail, seq)) break;
        keysOf(anchor).delete(event.payload.revokedFp);
        // Remember this key was removed under coverage: a later addition that
        // would restore it must itself be signature-covered (see addKeyGated).
        coveredRevoked.add(restoreKey(anchor, event.payload.revokedFp));
        break;
      }
      case 'backup.declared': {
        // An identity says one of its OWN keys is kept off the machine, so that key's having no
        // tail is expected. Who may say it is who may enrol: the anchor, by a key in its set now.
        // And the key must be one the anchor holds now — a declaration about another identity's
        // key, or a key never taken in, would silence a warning that is not the declarer's.
        const anchor = event.subject;
        if (event.who !== anchor) {
          issues.push({
            tail,
            seq,
            detail: 'backup.declared who is not the anchor it declares for',
          });
          break;
        }
        if (!keysOf(anchor).has(event.signerFp)) {
          issues.push({
            tail,
            seq,
            detail: 'backup.declared is signed by a key not valid for the anchor at this point',
          });
          break;
        }
        if (!keysOf(anchor).has(event.payload.backupFp)) {
          issues.push({
            tail,
            seq,
            detail:
              'backup.declared names a key that is not a member of its identity at this point',
          });
          break;
        }
        // It quiets the one warning that a removed tail raises, so — like a revocation — it is
        // honoured only when signature-covered: a party with no key can append above the last
        // checkpoint, and must not be able to declare away the tail it took out.
        if (!isCheckpointed(tail, seq)) break;
        backups.set(event.payload.backupFp, anchor);
        break;
      }
      case 'checker.enrolled': {
        // A person vouches (`who`, with a key valid for it now) for a key that will sign
        // check results under its OWN anchor (`subject`), and the key consents to exactly
        // that over `check-enroll:<who>:<checkerFp>`. It joins nobody's identity.
        const { checkerFp, reverseSig } = event.payload;
        if (event.subject !== deriveAnchor(checkerFp)) {
          issues.push({
            tail,
            seq,
            detail: 'checker.enrolled subject is not the anchor derived from the checker key',
          });
          break;
        }
        if (!keysOf(event.who).has(event.signerFp)) {
          issues.push({
            tail,
            seq,
            detail: 'checker.enrolled is signed by a key not valid for its who at this point',
          });
          break;
        }
        if (
          !consentOk(keys, checkerEnrollmentMessage(event.who, checkerFp), checkerFp, reverseSig)
        ) {
          issues.push({
            tail,
            seq,
            detail: 'checker.enrolled reverse signature does not prove the checker consented',
          });
          break;
        }
        if (retired.has(checkerFp)) {
          // A retired key does not come back: the leak it was retired for is still a leak.
          // A new key is enrolled instead.
          issues.push({
            tail,
            seq,
            detail: `checker.enrolled names ${oneLine(checkerFp)}, a checker key retired at this point, which is never enrolled again`,
          });
          break;
        }
        checkers.add(checkerFp);
        break;
      }
      case 'checker.retired': {
        // Any identity takes the role away, as any identity grants it: `who`, with a key valid
        // for it now. The checker key is not asked — a leaked key is what this is for.
        const { checkerFp } = event.payload;
        if (event.subject !== deriveAnchor(checkerFp)) {
          issues.push({
            tail,
            seq,
            detail: 'checker.retired subject is not the anchor derived from the checker key',
          });
          break;
        }
        if (!keysOf(event.who).has(event.signerFp)) {
          issues.push({
            tail,
            seq,
            detail: 'checker.retired is signed by a key not valid for its who at this point',
          });
          break;
        }
        // It refuses the key's LATER results, which are other, possibly checkpointed, events —
        // so, like a revocation, it takes effect only when signature-covered. A keyless party
        // cannot checkpoint, so an appended retirement cannot fail an honest runner's results.
        if (!isCheckpointed(tail, seq)) break;
        checkers.delete(checkerFp);
        if (!retired.has(checkerFp)) {
          retired.set(checkerFp, {
            by: event.who,
            tail,
            seq,
            resultsBefore: resultsSigned.get(checkerFp) ?? 0,
          });
        }
        break;
      }
      case 'check.passed':
      case 'check.failed': {
        // A check result is authentic only under a key enrolled as a checker at this point,
        // and only under the anchor that key derives: a machine speaks for itself.
        if (!checkers.has(event.signerFp)) {
          issues.push({
            tail,
            seq,
            detail: `${event.kind} is signed by ${oneLine(event.signerFp)}, which is not enrolled as a checker at this point`,
          });
          break;
        }
        if (event.who !== deriveAnchor(event.signerFp)) {
          issues.push({
            tail,
            seq,
            detail: `${event.kind} who is not the anchor of the checker key that signed it`,
          });
          break;
        }
        resultsSigned.set(event.signerFp, (resultsSigned.get(event.signerFp) ?? 0) + 1);
        break;
      }
      default: {
        // Every other event is authentic only if its signer is a key valid for
        // its anchor at this point — the single identity rule.
        if (!keysOf(event.who).has(event.signerFp)) {
          issues.push({
            tail,
            seq,
            detail: `event signer ${oneLine(event.signerFp)} is not a key enrolled for ${oneLine(event.who)} at this point`,
          });
        }
      }
    }
  }

  return { issues, members: validKeys, retiredCheckers: retired, backups, citations };
}

/**
 * Merges every tail into one total, deterministic order — the order every reader of many
 * tails folds ({@link causalOrder}): `seq` within a tail, and across tails the smallest `at`
 * among the heads whose citations have been taken, ties broken by tail id.
 *
 * It answers what the order made of the citations too, because the fold is the one reading
 * of the record that has every tail in hand: which citations named nothing the record holds,
 * and which events were stamped by a clock behind what they cite.
 */
function totalOrder(entriesByTail: ReadonlyMap<string, readonly Entry[]>): {
  readonly order: Array<{ tail: string; entry: Entry }>;
  readonly citations: CitationsRead;
} {
  const tails = [...entriesByTail].map(([tail, entries]) => ({ tree: 0, tail, entries }));
  const merged = causalOrder(tails, ENTRY_KEYS);
  const cursors = tails.map(() => 0);
  const order: Array<{ tail: string; entry: Entry }> = [];
  for (const step of merged.steps) {
    const { tail, entries } = tails[step] as (typeof tails)[number];
    order.push({ tail, entry: entries[cursors[step] as number] as Entry });
    cursors[step] = (cursors[step] as number) + 1;
  }
  const at = (tail: number, position: number): Entry =>
    (tails[tail] as (typeof tails)[number]).entries[position] as Entry;
  const notHeld = merged.notHeld.map((citation) => ({
    tail: (tails[citation.tail] as (typeof tails)[number]).tail,
    seq: at(citation.tail, citation.position).link.seq,
    hash: citation.hash,
  }));
  const behind: CitationsRead['behind'][number][] = [];
  for (const citation of merged.held) {
    const citing = at(citation.tail, citation.position);
    const cited = at(citation.citedTail, citation.citedPosition);
    const byMs = Date.parse(eventAt(cited)) - Date.parse(eventAt(citing));
    if (!(byMs > 0)) continue;
    const tail = (tails[citation.tail] as (typeof tails)[number]).tail;
    const last = behind[behind.length - 1];
    // One entry per citing event: the largest gap among what it cites.
    if (last !== undefined && last.tail === tail && last.seq === citing.link.seq) {
      if (byMs > last.byMs) behind[behind.length - 1] = { ...last, byMs };
      continue;
    }
    behind.push({ tail, seq: citing.link.seq, byMs });
  }
  return { order, citations: { notHeld, behind } };
}

/** What {@link causalOrder} reads of an entry. */
const ENTRY_KEYS: OrderKeys<Entry> = {
  at: (entry) => eventAt(entry),
  hash: (entry) => entry.link.hash,
  after: (entry) => (entry.event as CatalogEvent).after,
};

function eventAt(entry: Entry): string {
  return (entry.event as CatalogEvent).at;
}

/**
 * Verifies a `key.enrolled`'s reverse signature: the new key's Ed25519
 * signature over `enroll:<anchor>:<newFp>`. The public key is the committed one
 * named by `newFp`; a key with no committed public key cannot be proven to have
 * consented, so the enrollment fails.
 *
 * The committed `.pub` is bound to `newFp` by re-deriving its fingerprint — the
 * same fingerprint-binding the checkpoint verifier applies. Without it, swapping
 * `keys/<newFp>.pub` for an attacker's key would let a reverse signature they
 * made verify against the swapped file while the fold still records `newFp` as
 * the enrolled member; the enrollment must be proven with the key it names, not
 * whatever the file now holds.
 */
function reverseSignatureOk(
  keys: CommittedKeys,
  anchor: string,
  newFp: string,
  reverseSig: string,
): boolean {
  return consentOk(keys, enrollmentMessage(anchor, newFp), newFp, reverseSig);
}

/**
 * Whether `reverseSig` is the signature of the committed key `fp` names over `message`, with
 * that key's fingerprint recomputed — the proof of possession both enrolments carry.
 */
function consentOk(
  keys: CommittedKeys,
  message: Uint8Array,
  newFp: string,
  reverseSig: string,
): boolean {
  const committed = keys(newFp);
  if (committed === null) return false;
  if (committed.fingerprint() !== newFp) return false;
  let signature: Buffer;
  try {
    signature = Buffer.from(reverseSig, 'hex');
  } catch {
    return false;
  }
  try {
    return verifySignature(message, signature, committed.key);
  } catch {
    return false;
  }
}
