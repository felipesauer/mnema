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
 * public half. What the record CLAIMS, read for a door; `verify` is what proves it.
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
