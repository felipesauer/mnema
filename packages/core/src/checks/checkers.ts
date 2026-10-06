/**
 * Which keys a tree enrolls as CHECKERS — keys that sign check results and nothing else — read
 * for the doors that must not let such a key write anything else, and for the checker's own
 * run. What the record CLAIMS, each consent checked against the committed key; `verify` is what
 * proves it (FORMAT.md section 6.2).
 */

import {
  type ChainLayout,
  checkerEnrollmentMessage,
  committedPublicKey,
  type PublicHalf,
  type UpcasterRegistry,
  verifySignature,
} from '@mnema/chain';
import { orderedEvents } from '../projections/order.js';

/** Whether `reverseSig` is the key's consent to check for `anchor`. */
export function consentsToCheck(key: PublicHalf, anchor: string, reverseSig: string): boolean {
  try {
    return verifySignature(
      checkerEnrollmentMessage(anchor, key.fingerprint),
      Buffer.from(reverseSig, 'hex'),
      key.publicKey,
    );
  } catch {
    return false;
  }
}

/**
 * The keys this tree enrolls as checkers, each one's consent checked against its committed
 * public half — a key since retired included, because a retired key still signs nothing but a
 * result, and no result either ({@link retiredCheckersIn}). What the record CLAIMS, read for a
 * door; `verify` is what proves it.
 */
export function checkersIn(layout: ChainLayout, upcasters: UpcasterRegistry): Set<string> {
  const checkers = new Set<string>();
  for (const event of orderedEvents(layout, upcasters)) {
    if (event.kind !== 'checker.enrolled') continue;
    const key = committedPublicKey(layout, event.payload.checkerFp);
    if (key === null) continue;
    if (consentsToCheck(key, event.who, event.payload.reverseSig)) checkers.add(key.fingerprint);
  }
  return checkers;
}

/** A checker key the record retired, and the identity that retired it. */
export interface CheckerRetirement {
  readonly by: string;
  readonly reason: string;
}

/**
 * The checker keys this tree retires (`checker.retired`), by fingerprint, with the first
 * retirement of each. What the record CLAIMS, read for a door: a retired key runs no check and
 * is never enrolled again. Whether a retirement took effect — signed by a key valid for its
 * `who`, and covered by a checkpoint — is `verify`'s to prove (FORMAT.md section 6.2).
 */
export function retiredCheckersIn(
  layout: ChainLayout,
  upcasters: UpcasterRegistry,
): Map<string, CheckerRetirement> {
  const retired = new Map<string, CheckerRetirement>();
  for (const event of orderedEvents(layout, upcasters)) {
    if (event.kind !== 'checker.retired') continue;
    if (retired.has(event.payload.checkerFp)) continue;
    retired.set(event.payload.checkerFp, { by: event.who, reason: event.payload.reason });
  }
  return retired;
}
