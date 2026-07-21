/**
 * The alias: a short, human-facing name for an entity, derived purely from its
 * id. It is a display convenience, never an identity — the id is the only
 * identity, and it is always recoverable. An alias is NEVER stored: the entity
 * carries its id, events stamp the id, and the alias is computed at the edge
 * only when something is shown to a human.
 *
 * Derivation is `sha256(id)` prefixed by the entity's kind: `t-3a9f` for a task,
 * `e-3a9f` for an epic, `s-3a9f` for a sprint. The hash is used, not the id's
 * own prefix, because an id is a v7 UUID that begins with a timestamp — two ids
 * minted close together would share a leading run and collide on sight. The
 * hash spreads them uniformly.
 *
 * Because the alias is display-only, a collision is a LEGIBILITY problem, never
 * a correctness one: the id stays unique, nothing in the chain is confused. When
 * two ids shown together happen to share a short prefix, the edge lengthens only
 * the ambiguous ones (`t-3a9f7` vs `t-3a9fb`), exactly as git does with short
 * SHAs. That lengthening needs the whole set of ids on screen, so it lives in
 * {@link disambiguate}; {@link deriveAlias} alone gives the standard short form.
 */

import { createHash } from 'node:crypto';

/** The kinds of entity that carry an alias, each with its one-letter prefix. */
export const ALIAS_PREFIXES = {
  task: 't',
  epic: 'e',
  sprint: 's',
} as const;

/** An entity kind that has a human-facing alias. */
export type AliasKind = keyof typeof ALIAS_PREFIXES;

/**
 * The default number of hex characters in a short alias. Four hex = 16 bits =
 * 65536 distinct values, so ~256 ids shown together (per kind) before a coin
 * flip of collision — comfortably legible for a work board, and {@link
 * disambiguate} is the safety net that lengthens any real clash. It is a
 * display default, not a guarantee of uniqueness (the id is that).
 */
export const SHORT_ALIAS_HEX = 4;

/** The full sha256 of an id, as a lowercase hex string. Pure, no I/O. */
function hashOf(id: string): string {
  return createHash('sha256').update(id, 'utf8').digest('hex');
}

/**
 * Derives the standard short alias for an entity: `<prefix>-<hex>`, where the
 * hex is the first {@link SHORT_ALIAS_HEX} characters of `sha256(id)`. Pure and
 * deterministic — same (kind, id) always yields the same alias, with no I/O.
 *
 * On its own, out of any display context, this is best-effort short: two ids
 * could share the prefix. That is fine — the alias is a convenience, the id is
 * always the recoverable truth. When a set is shown together and legibility
 * matters, use {@link disambiguate} instead.
 */
export function deriveAlias(kind: AliasKind, id: string): string {
  return `${ALIAS_PREFIXES[kind]}-${hashOf(id).slice(0, SHORT_ALIAS_HEX)}`;
}

/** An entity to be shown, identified by its kind and id. */
export interface AliasSubject {
  readonly kind: AliasKind;
  readonly id: string;
}

/**
 * Given a set of entities shown together, returns the shortest alias for each
 * that still distinguishes it from every other — the git short-SHA model. All
 * aliases in one call share a floor of {@link SHORT_ALIAS_HEX} hex (so the
 * common case stays uniformly short), and only genuinely-ambiguous ids grow,
 * each just far enough to be unique within the set.
 *
 * The returned map is keyed by id. A duplicate id in the input maps once (it is
 * the same entity). Two ids of different kinds never collide — the kind prefix
 * already separates `t-` from `e-` — so disambiguation runs per (kind, hash).
 * If two DISTINCT ids ever share a full sha256 (a 256-bit collision, which does
 * not happen), they would map to the same full-length alias; the id remains the
 * arbiter of identity regardless.
 */
export function disambiguate(subjects: Iterable<AliasSubject>): Map<string, string> {
  // Collapse to unique ids per kind, remembering each id's full hash once.
  const byId = new Map<string, { kind: AliasKind; hash: string }>();
  for (const { kind, id } of subjects) {
    if (!byId.has(id)) byId.set(id, { kind, hash: hashOf(id) });
  }

  // Group the hashes sharing a (kind, prefix) family so we can find, per group,
  // the shortest hex length that separates everyone in it.
  const result = new Map<string, string>();
  for (const [id, { kind, hash }] of byId) {
    const prefix = ALIAS_PREFIXES[kind];
    let length = SHORT_ALIAS_HEX;
    // Grow until this id's prefix is unique among all OTHER ids of the same
    // kind, or the whole hash is exhausted (identical hashes — see docstring).
    while (length < hash.length) {
      const mine = hash.slice(0, length);
      let clashes = false;
      for (const [otherId, other] of byId) {
        if (otherId === id || other.kind !== kind) continue;
        if (other.hash.slice(0, length) === mine) {
          clashes = true;
          break;
        }
      }
      if (!clashes) break;
      length += 1;
    }
    result.set(id, `${prefix}-${hash.slice(0, length)}`);
  }
  return result;
}
