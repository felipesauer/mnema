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
 * events on another's. The order is the SAME k-way merge a projection uses
 * (`(at, tail, seq)`, `seq` inviolable within a tail), so enroll/revoke that
 * race across tails resolve deterministically, the same way state does.
 *
 * One consequence of ordering by `at`: a key's first event must fall AFTER its
 * enrollment in that order, or the fold sees the event before the key is valid
 * and rejects it. In practice `at` provides this — a key can only write once it
 * has been enrolled, which happens earlier in wall-clock time — so a monotonic
 * `at` (the producer's responsibility, as for projections) keeps an enrollment
 * ahead of the events that depend on it. When two tails carry an identical `at`,
 * the tie-break is by tail id, which does not encode causality; the same
 * uniform-`at` discipline the projection order already assumes covers this.
 * A machine that founds its OWN tail (the copy-key and solo cases) is immune:
 * its founding is seq 0 of its own tail, always ahead of its later events.
 *
 * What this canNOT prove, stated plainly: in the residual window (events above
 * the last checkpoint, carrying only the keyless hash chain) a party without any
 * key can still write an event whose envelope NAMES a valid `signerFp`/`who` —
 * the fold accepts it because those fields satisfy membership, exactly as it
 * accepts a legitimate second installation of a copied key. Only a checkpoint
 * binds a range to the key that signed it; `fullySigned` already reports whether
 * any residual exists. This closes the fabricated-tail vector for a key that is
 * NOT enrolled (its events fail membership), which is what a keyless adversary
 * has to reach for.
 *
 * The asymmetry that governs which enrollment facts the fold trusts from that
 * residual window: an ADDITION (`identity.founded`, `key.enrolled`) can only
 * empower events that name the added key, and a keyless party can only forge such
 * events in the residual — which are already untrusted (fullySigned=false). A
 * REVOCATION is the opposite: it removes a key that judges OTHER, possibly
 * checkpointed, events. So a residual `key.revoked` could let a keyless party
 * fabricate a tail under a real enrolled fingerprint (permitted in the residual),
 * revoke another member from it, and thereby flip an HONEST, fully-signed chain
 * to failing — a denial-of-authenticity with no key. To close that, a
 * `key.revoked` takes effect ONLY when it is itself signature-covered (within a
 * verified checkpoint range): a keyless party cannot checkpoint a fabricated tail
 * (a checkpoint needs the tail's private key), so their revocation stays residual
 * and never removes a key. A legitimate revocation is made effective by its owner
 * checkpointing it (the identity operation does so at once). Additions do not need
 * this gate — they cannot invalidate signed history — so an enroll made before a
 * checkpoint still lets its key write in the same residual window.
 */

import { existsSync, readFileSync } from 'node:fs';
import { enrollmentMessage } from '../events/build.js';
import type { CatalogEvent } from '../events/catalog.js';
import type { Entry } from './entry.js';
import {
  deriveAnchor,
  fingerprintOf,
  publicKeyFromPem,
  verify as verifySignature,
} from './keys.js';
import { type ChainLayout, publicKeyPath } from './layout.js';

/** A problem found while resolving identity by enrollment. */
export interface IdentityIssue {
  readonly tail: string;
  readonly seq: number;
  readonly detail: string;
}

/** The result of folding enrollment across the whole chain. */
export interface IdentityResolution {
  readonly issues: readonly IdentityIssue[];
}

/** One tail's entries in proven (`seq`) order, plus a read cursor. */
interface TailCursor {
  readonly tail: string;
  readonly entries: readonly Entry[];
  cursor: number;
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
 * (-1 if none). It gates only `key.revoked`: a revocation removes a key that
 * judges other events, so it must itself be signed to be trusted — see the
 * module doc. Additions (founded/enrolled) are not gated.
 */
export function resolveIdentity(
  layout: ChainLayout,
  entriesByTail: ReadonlyMap<string, readonly Entry[]>,
  checkpointedThroughByTail: ReadonlyMap<string, number>,
): IdentityResolution {
  const order = totalOrder(entriesByTail);
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

  for (const { tail, entry } of order) {
    const event = entry.event;
    const seq = entry.link.seq;
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
        keysOf(event.subject).add(foundingFp);
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
        if (!reverseSignatureOk(layout, anchor, newFp, reverseSig)) {
          issues.push({
            tail,
            seq,
            detail: 'key.enrolled reverse signature does not prove possession of the new key',
          });
          break;
        }
        keysOf(anchor).add(newFp);
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
        break;
      }
      default: {
        // Every other event is authentic only if its signer is a key valid for
        // its anchor at this point — the single identity rule.
        if (!keysOf(event.who).has(event.signerFp)) {
          issues.push({
            tail,
            seq,
            detail: `event signer ${event.signerFp} is not a key enrolled for ${event.who} at this point`,
          });
        }
      }
    }
  }

  return { issues };
}

/**
 * Merges every tail into one total, deterministic order — the same k-way merge
 * a projection uses. Within a tail, `seq` order is inviolable (the hash chain
 * proves it); across tails the head with the smallest `at` goes next, ties
 * broken by tail id. `at` is only ever compared between heads of DIFFERENT
 * tails, never within one, so it can never override the proven order.
 */
function totalOrder(
  entriesByTail: ReadonlyMap<string, readonly Entry[]>,
): Array<{ tail: string; entry: Entry }> {
  const cursors: TailCursor[] = [];
  for (const [tail, entries] of entriesByTail) {
    cursors.push({ tail, entries, cursor: 0 });
  }
  const merged: Array<{ tail: string; entry: Entry }> = [];
  for (;;) {
    const next = pickNext(cursors);
    if (next === undefined) break;
    merged.push({ tail: next.tail, entry: next.entries[next.cursor] as Entry });
    next.cursor += 1;
  }
  return merged;
}

function pickNext(cursors: readonly TailCursor[]): TailCursor | undefined {
  let chosen: TailCursor | undefined;
  for (const c of cursors) {
    if (c.cursor >= c.entries.length) continue;
    if (chosen === undefined || headPrecedes(c, chosen)) chosen = c;
  }
  return chosen;
}

function headPrecedes(a: TailCursor, b: TailCursor): boolean {
  const atA = eventAt(a.entries[a.cursor] as Entry);
  const atB = eventAt(b.entries[b.cursor] as Entry);
  if (atA !== atB) return atA < atB;
  return a.tail < b.tail;
}

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
  layout: ChainLayout,
  anchor: string,
  newFp: string,
  reverseSig: string,
): boolean {
  const path = publicKeyPath(layout, newFp);
  if (!existsSync(path)) return false;
  let publicKey: ReturnType<typeof publicKeyFromPem>;
  try {
    publicKey = publicKeyFromPem(readFileSync(path, 'utf-8'));
  } catch {
    return false;
  }
  if (fingerprintOf(publicKey) !== newFp) return false;
  let signature: Buffer;
  try {
    signature = Buffer.from(reverseSig, 'hex');
  } catch {
    return false;
  }
  try {
    return verifySignature(enrollmentMessage(anchor, newFp), signature, publicKey);
  } catch {
    return false;
  }
}
