/**
 * The two ends of a readable identity on the command line: the form an anchor is
 * PRINTED in, and what a person may type back.
 *
 * They are one module because they are one promise. An anchor is `mnid:` and 64
 * hex; the reads that audit the record are full of them, and at that width nobody
 * reads them. Shortening is easy. Shortening HONESTLY is the whole problem: a
 * short form that looks like the real value will be pasted where the real value
 * goes, and a surface that prints a value its own next step refuses has not made
 * anything more legible, it has laid a trap. So the same set answers both
 * questions — {@link anchorForms} shortens against the identities the record knows,
 * and {@link resolveTypedAnchor} resolves against that same map's keys.
 *
 * The set is the RECORD's, never the report's. A read that shows two identities
 * shortens them against every identity in the trees it can see, not against the
 * two on screen: a form that is unique among what one report happened to print can
 * still name two identities the moment it is typed into another verb, and the
 * person who copied it did nothing wrong.
 *
 * What is NOT here: any short form for an entity id. That is a different value with
 * a different problem (an alias is a label, not a prefix, and nobody pastes one as
 * an id), and a fingerprint stays whole wherever it appears — `key revoke` names a
 * physical key, and which key a short value means is not a guess to make about key
 * material.
 */

import { knownAnchors, type ScopedCache } from '@mnema/copilot';
import {
  type AnchorResolution,
  type ResolvedTrees,
  resolveAnchorPrefix,
  shortenAnchors,
} from '@mnema/core';
import { oneLine } from './served-patterns.js';
import { withScopedCaches } from './tree-sources.js';

/**
 * How each identity the record knows is written on a line, keyed by its full
 * anchor. An identity not in this map is printed whole — see {@link anchorText}.
 */
export type AnchorForms = ReadonlyMap<string, string>;

/** No identity is known: what a read outside any record shortens against. */
export const NO_ANCHORS: AnchorForms = new Map();

/** The short form of every identity the trees in `sources` know. */
export function anchorForms(sources: readonly ScopedCache[]): AnchorForms {
  return shortenAnchors(knownAnchors(sources));
}

/**
 * How one anchor is written on a line: short when the record knows it, whole when
 * it does not.
 *
 * The fallback is the rule, not a safety net. A short form only means something
 * where it can be resolved, so an identity this record has never seen — the actor
 * of an empty focus, a `who` from a tree not opened here — keeps every character.
 * The reader gets a value they can act on either way, and "is it shortened" and
 * "can it be pasted back" stay the same question.
 */
export function anchorText(forms: AnchorForms, anchor: string): string {
  return forms.get(anchor) ?? anchor;
}

/** What the surface does with a value someone typed where an anchor goes. */
export type TypedAnchor =
  | { readonly ok: true; readonly anchor: string }
  | { readonly ok: false; readonly code: string; readonly message: string };

/**
 * Resolves the anchor a person typed — whole, or by any prefix that names exactly
 * one identity the record knows.
 *
 * A refusal NAMES THE CANDIDATES, in the short form every read prints, because
 * that form is unique across the whole set by construction: the sentence hands
 * back values that work, rather than telling someone to go and find them. The
 * candidates are the anchors that match, so an ambiguous prefix earns the two it
 * could have meant and an unknown one earns the identities there are.
 */
export function resolveTypedAnchor(typed: string, forms: AnchorForms): TypedAnchor {
  const resolved = resolveAnchorPrefix(typed, forms.keys());
  return resolved.ok ? { ok: true, anchor: resolved.anchor } : refuse(typed, resolved, forms);
}

/**
 * Resolves a typed anchor for a verb that has no reason to read the whole record
 * otherwise — and opens the trees only if it has to.
 *
 * A value written WHOLE resolves against nothing, so the verb that was handed one
 * pays nothing: the trees stay closed and the read (or the write) proceeds. Only a
 * prefix needs the set, and then the cost is the convenience's own. `key request`
 * relies on the first half of that — it runs on a machine joining an identity, from
 * a clone whose record may hold no identity to match against, and the whole value it
 * was handed has to keep working there.
 */
export function resolveAnchorInRecord(trees: ResolvedTrees, typed: string): TypedAnchor {
  // Asked of the same function, with nothing known: "is this already whole" is a
  // rule, and a second reading of it here could come to disagree with the first.
  const whole = resolveAnchorPrefix(typed, []);
  if (whole.ok) return { ok: true, anchor: whole.anchor };
  return withScopedCaches(trees, (sources) => resolveTypedAnchor(typed, anchorForms(sources)));
}

/** The sentence a value that named no one identity earns, and the code with it. */
function refuse(
  typed: string,
  resolved: Extract<AnchorResolution, { ok: false }>,
  forms: AnchorForms,
): TypedAnchor {
  const written = (anchors: readonly string[]) =>
    anchors.map((anchor) => anchorText(forms, anchor)).join(', ');
  if (resolved.reason === 'AMBIGUOUS_ANCHOR') {
    return {
      ok: false,
      code: 'AMBIGUOUS_ANCHOR',
      message:
        `"${oneLine(typed)}" names ${resolved.candidates.length} of the identities this ` +
        `record knows — ${written(resolved.candidates)} — so it does not say which; ` +
        'pass one of those, or the whole identity',
    };
  }
  const all = [...forms.keys()];
  if (typed.trim() === '') {
    // Nobody types an empty identity: this is `--actor "$ME"` with the variable
    // unset. Naming the accident is what turns a refusal into a fix — the same
    // sentence the surface gives a `--which` that named no agent.
    return {
      ok: false,
      code: 'UNKNOWN_ANCHOR',
      message:
        'it names no identity — an unset variable, most likely. Name the identity ' +
        `whose record you are asking about${all.length > 0 ? `: ${written(all)}` : ''}`,
    };
  }
  return {
    ok: false,
    code: 'UNKNOWN_ANCHOR',
    // With nothing to match against, the sentence teaches the SHAPE instead of
    // listing an empty set. That is the case a machine joining an identity is in:
    // a fresh clone whose record names nobody, where the only value that can work
    // is the whole one, and a refusal saying "these are the identities: " with
    // nothing after it would send someone looking for a list that does not exist.
    message:
      all.length === 0
        ? `"${oneLine(typed)}" names no identity, and this record holds none to match a ` +
          'prefix against — name the whole identity (`mnid:` and 64 hex, as printed when ' +
          'a project is founded)'
        : `"${oneLine(typed)}" names no identity in this record — these are: ${written(all)}`,
  };
}
