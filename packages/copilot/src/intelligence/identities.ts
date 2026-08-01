/**
 * Who the record knows: every identity that authorized a fact in it.
 *
 * The smallest derivation in this folder, and it exists because the surface has
 * two questions that must be answered from the SAME set or they disagree with
 * each other. Shortening an anchor for a person to read asks "is this prefix
 * enough to tell it from every other identity here"; accepting one they typed
 * back asks "which identity does this prefix name". Answer the first over a
 * narrower set than the second and the surface prints a form it then refuses.
 *
 * So this is the set, and it is defined by the record rather than by the report:
 * every `who` in every tree the caller can see, whatever it authorized. An
 * identity with one fact counts exactly as one with a thousand — presence is the
 * question, not volume, and the alternative would make a form legible today and
 * ambiguous after someone else's first write.
 *
 * It says nothing about whether an identity is still enrolled, or which keys stand
 * behind it. A `who` in the record is a fact that was authorized; that is all this
 * is, and reading a roster's current membership out of an authorship history would
 * be a different claim under the same name.
 */

import type { ScopedCache } from '../sources.js';

/**
 * Every identity that authorized a fact across `sources`, once each, sorted.
 *
 * Merged as a set rather than concatenated: one identity writing in two trees is
 * one identity, and the same `who` is the same person wherever the fact landed.
 */
export function knownAnchors(sources: readonly ScopedCache[]): string[] {
  const anchors = new Set<string>();
  for (const source of sources) {
    for (const who of source.cache.authors()) anchors.add(who);
  }
  return [...anchors].sort();
}
