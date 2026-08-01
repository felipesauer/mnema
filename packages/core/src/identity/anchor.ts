/**
 * The readable form of an anchor, and the way back from it.
 *
 * An anchor is `mnid:` and sixty-four hex characters — sixty-nine on a line, and
 * it appears in the reads a person opens to audit the record: who authorized each
 * event, who each account belongs to, whose runs are open. At that width the
 * value is not read, it is skipped, and an audit nobody reads is not an audit.
 *
 * THE SHORT FORM IS A PREFIX OF THE VALUE ITSELF, never a hash of it. That is the
 * whole difference from {@link deriveAlias}, which hashes an id because an id is a
 * v7 UUID whose leading characters are a timestamp. An anchor's characters are
 * already a hash, so they are already spread; and a prefix is CHECKABLE — anyone
 * holding the full value can see the short one at the front of it, with no lookup
 * and no trust in this code. A hashed label could not be checked, and it could not
 * be typed back in, which is the second half of what makes this honest:
 *
 * WHAT THE OUTPUT SHORTENS, THE INPUT ACCEPTS. A short form that looks like the
 * real value WILL be pasted where the real value goes — that is what it is for.
 * So {@link shortenAnchors} and {@link resolveAnchorPrefix} are two halves of one
 * contract, and they must be given the SAME set: a form shortened against the
 * anchors the record knows resolves against the anchors the record knows, and the
 * round trip closes by construction. Shortening against a narrower set (the few
 * anchors one report happens to show) would print a value the input then refuses.
 *
 * A value the set does not hold is never shortened — it is printed in full. So the
 * short form exists only where it can be resolved, and "is this shortened" and "can
 * this be pasted back" are the same question.
 */

import { ANCHOR_PREFIX } from '@mnema/chain';

/** How many hex characters of an anchor the short form carries by default.
 *
 * Eight, where an entity's alias takes four ({@link SHORT_ALIAS_HEX}), and the
 * difference is not taste: an alias is only ever SHOWN, so a clash there costs a
 * moment of confusion, while an anchor is shown AND typed back — into a filter over
 * an audit, and into the request that consents to join an identity. The floor is
 * therefore set by what a wrong resolution costs, not by what fits on a line. Eight
 * hex is thirty-two bits, in the same territory as git's short SHA, which is the
 * precedent for a hash a person copies from output into input; it costs four
 * characters and saves fifty-six.
 *
 * It is a FLOOR and not a guarantee: {@link shortenAnchors} lengthens any form that
 * two anchors in the same set would share, exactly as {@link disambiguate} does.
 */
export const SHORT_ANCHOR_HEX = 8;

/** Whether a value has the full shape of an anchor: `mnid:` and 64 hex. */
export function isAnchorId(value: string): boolean {
  if (!value.startsWith(ANCHOR_PREFIX)) return false;
  return /^[0-9a-f]{64}$/.test(value.slice(ANCHOR_PREFIX.length));
}

/**
 * The short form of every anchor in `anchors`, keyed by the full value.
 *
 * Each is `mnid:` plus the first {@link SHORT_ANCHOR_HEX} hex characters of the
 * anchor, lengthened — only for the ones that need it — until no two anchors in the
 * set share a form. The whole set moves together no further than it has to: one
 * clash lengthens the two that clash, not everyone.
 *
 * A value that is not shaped like an anchor is skipped rather than shortened. The
 * set comes from the record, and every `who` in the record is derived from a key,
 * so this cannot happen through the door the callers use; skipping is what keeps a
 * malformed row in a corrupted cache from producing a "short form" of something
 * that was never an anchor.
 */
export function shortenAnchors(anchors: Iterable<string>): Map<string, string> {
  const hexes = new Map<string, string>();
  for (const anchor of anchors) {
    if (!isAnchorId(anchor) || hexes.has(anchor)) continue;
    hexes.set(anchor, anchor.slice(ANCHOR_PREFIX.length));
  }
  const short = new Map<string, string>();
  for (const [anchor, hex] of hexes) {
    let length = SHORT_ANCHOR_HEX;
    while (length < hex.length) {
      const mine = hex.slice(0, length);
      let clashes = false;
      for (const [other, otherHex] of hexes) {
        if (other === anchor) continue;
        if (otherHex.slice(0, length) === mine) {
          clashes = true;
          break;
        }
      }
      if (!clashes) break;
      length += 1;
    }
    short.set(anchor, ANCHOR_PREFIX + hex.slice(0, length));
  }
  return short;
}

/** What a typed anchor turned out to name. */
export type AnchorResolution =
  | { readonly ok: true; readonly anchor: string }
  | {
      readonly ok: false;
      readonly reason: 'AMBIGUOUS_ANCHOR' | 'UNKNOWN_ANCHOR';
      /** The anchors the value could have meant — several, or none. */
      readonly candidates: readonly string[];
    };

/**
 * Resolves what a person typed into the anchor it names, given the anchors the
 * record knows.
 *
 * Three answers, in this order:
 *
 *   - A value with the FULL shape of an anchor is that anchor, whether or not the
 *     record knows it. This is what keeps the full value working everywhere: a
 *     machine joining an identity runs `key request` from a fresh clone, where the
 *     record holds nothing to match against, and the value it was handed must still
 *     be accepted. An unknown full anchor is a legitimate thing to name.
 *   - Otherwise it is a PREFIX, and it resolves when exactly one known anchor
 *     starts with it. The `mnid:` is optional either way, because both are pasted:
 *     the reads print it, and a person retyping from memory drops it.
 *   - Anything else is refused, and the refusal carries what it could have meant.
 *     Several candidates is `AMBIGUOUS_ANCHOR` — the value is real, it just does not
 *     say which. None is `UNKNOWN_ANCHOR`: a prefix nobody here answers to. Neither
 *     is silently passed through, because both would then be used as a filter that
 *     matches nothing and come back as an empty answer — a lie with no shape.
 *
 * AN EMPTY VALUE NAMES NOBODY, and is refused before the matching starts. Read as a
 * prefix it matches EVERYONE, which in a record with one identity would quietly
 * resolve to that identity — and the way an empty value actually arrives is
 * `--actor "$ME"` with the variable unset, which is the same accident the surface
 * already refuses to read as an agent's name.
 */
export function resolveAnchorPrefix(typed: string, known: Iterable<string>): AnchorResolution {
  const value = typed.trim();
  if (isAnchorId(value)) return { ok: true, anchor: value };
  const hex = value.startsWith(ANCHOR_PREFIX) ? value.slice(ANCHOR_PREFIX.length) : value;
  if (hex === '') return { ok: false, reason: 'UNKNOWN_ANCHOR', candidates: [] };
  const candidates = [...new Set(known)]
    .filter((anchor) => isAnchorId(anchor) && anchor.slice(ANCHOR_PREFIX.length).startsWith(hex))
    .sort();
  const only = candidates[0];
  if (only !== undefined && candidates.length === 1) return { ok: true, anchor: only };
  return {
    ok: false,
    reason: candidates.length > 1 ? 'AMBIGUOUS_ANCHOR' : 'UNKNOWN_ANCHOR',
    candidates,
  };
}
