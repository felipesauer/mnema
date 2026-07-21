/**
 * The canonical form of an identity — the `who` (the human who authorized) and
 * the `which` (the agent that executed). One rule, in one place, used both to
 * VALIDATE an identity and to decide what gets WRITTEN, so the two never drift:
 * what the gate accepted is exactly what the event records, byte for byte.
 *
 * The rule normalizes two things and two only:
 *
 *   1. WHITESPACE — trim. This resolves the real, common accident (a stray
 *      leading or trailing space spelling one person as several) without ever
 *      fusing two people. Stronger normalization (case folding, mapping a
 *      handle to a canonical identity) is NOT done here: in an immutable proof
 *      log a false MERGE (two distinct people collapsed into one) is permanent
 *      and severe, while a false SPLIT (one person seen as several) is
 *      reversible once a real identity model exists. So `Felipe` and `felipe`
 *      stay distinct on purpose, reconcilable later.
 *
 *   2. UNICODE COMPOSITION — NFC, and refuse what cannot be canonicalized. This
 *      is NOT a policy choice; it is agreement with the chain. The chain
 *      NFC-normalizes every string into the bytes it hashes and signs, so an
 *      identity validated in one composition but recorded in another would let
 *      an agent that "differs" from the human at the gate become byte-identical
 *      to it in the signed fact — defeating the who != which invariant the gate
 *      exists to hold. Canonicalizing to the SAME form the chain will impose,
 *      here, keeps validation and the signed bytes in lockstep.
 */

import { CanonicalizationError, canonicalStringify } from '@mnema/chain';

/**
 * The canonical form of an identity, or undefined when the value is none — not
 * a string at all (junk forwarded from an untrusted surface), empty once
 * trimmed (whitespace is no identity), or a string the chain cannot canonicalize
 * deterministically (e.g. a lone surrogate). The returned form is NFC-normalized
 * and trimmed: it is both what identity comparison uses and what the event
 * records, so "José" (NFC) and "José" (NFD) are recognized as the same person
 * and cannot be played off against each other, and a value the gate accepts is
 * always a value the chain can seal (no accept-then-throw at append time).
 */
export function canonicalIdentity(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  // NFC before trim so composition is settled the way the chain will store it;
  // trimming an NFC string stays NFC (it only removes ASCII whitespace ends).
  const canonical = value.normalize('NFC').trim();
  if (canonical.length === 0) return undefined;
  // Agree with the chain on what is representable: if it cannot canonicalize
  // the string, it is not a usable identity, and refusing here means the gate
  // never authorizes a move the writer would then throw on.
  try {
    canonicalStringify(canonical);
  } catch (error) {
    if (error instanceof CanonicalizationError) return undefined;
    throw error;
  }
  return canonical;
}
