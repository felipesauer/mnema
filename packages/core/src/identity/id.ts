/**
 * The canonical form of an entity id reference (a `subject`, or a `by` that
 * names another entity). One rule, in one place, so a reference is compared and
 * looked up in exactly the form the chain will store — validation and the
 * signed bytes never drift.
 *
 * An id is NOT an identity. Unlike a `who`/`which` it is:
 *   - NOT trimmed — the chain does not trim, so trimming here would produce a
 *     key that no stored subject matches (an id never carries meaningful
 *     whitespace anyway; treating it verbatim keeps the reference and the
 *     stored subject byte-aligned).
 *   - NFC-normalized, because the chain NFC-normalizes every string into the
 *     bytes it serializes, so a reference read back from disk is always NFC.
 *     Comparing or looking up a reference in any other composition would
 *     false-miss against the projection, which keys on the NFC-from-disk form.
 *   - refused when the chain cannot canonicalize it (a lone surrogate), so the
 *     gate never authorizes a move the writer would then throw on appending.
 *
 * This is the id counterpart of {@link canonicalIdentity}: same agreement with
 * the chain, without the identity-only whitespace policy.
 */

import { CanonicalizationError, canonicalStringify } from '@mnema/chain';

/**
 * The canonical form of an id reference (NFC, chain-representable), or undefined
 * when the value is none — not a string, empty, or a string the chain cannot
 * canonicalize deterministically.
 */
export function canonicalId(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  const canonical = value.normalize('NFC');
  if (canonical.length === 0) return undefined;
  try {
    canonicalStringify(canonical);
  } catch (error) {
    if (error instanceof CanonicalizationError) return undefined;
    throw error;
  }
  return canonical;
}
