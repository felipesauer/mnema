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
 * a correctness one: the id stays unique, nothing in the chain is confused, and
 * the id is printed beside the alias wherever the alias appears, so a person who
 * needs certainty already has it. That last clause was an INTENTION when it was
 * written and is now a fact: the four places an alias is emitted are the birth and
 * the move of a task on each of the two surfaces, and until the move echo carried
 * the id it was the one of the four that printed the alias alone. Pinned by
 * `code`'s `cli.writes.golden.txt`, which holds every line the command line writes.
 *
 * There was a second function here — `disambiguate`, which lengthened only the
 * ambiguous aliases of a set shown together, exactly as git does with short SHAs.
 * It is gone, with nothing in its place, because the premise under it was false:
 * nothing ever shows two aliases at once. An alias is emitted in four places, all
 * of them the reply to a write about ONE task (`task` create and `task` move, on
 * each of the two surfaces); every read prints ids. The set it needed never
 * existed, so a short-form collision is simply accepted — `alias.test.ts` pins a
 * real colliding pair rather than leaving that as a claim.
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
 * The number of hex characters in a short alias. Four hex = 16 bits = 65536
 * distinct values, so ~256 ids (per kind) before a coin flip of collision. It is
 * a display default, not a guarantee of uniqueness — the id is that, and it
 * travels with every alias.
 */
export const SHORT_ALIAS_HEX = 4;

/** The full sha256 of an id, as a lowercase hex string. Pure, no I/O. */
function hashOf(id: string): string {
  return createHash('sha256').update(id, 'utf8').digest('hex');
}

/**
 * Derives the short alias for an entity: `<prefix>-<hex>`, where the hex is the
 * first {@link SHORT_ALIAS_HEX} characters of `sha256(id)`. Pure and
 * deterministic — same (kind, id) always yields the same alias, with no I/O.
 *
 * It is best-effort short: two ids can share the prefix, and nothing here
 * resolves that. The alias is a convenience shown next to the id, and the id is
 * always the recoverable truth.
 */
export function deriveAlias(kind: AliasKind, id: string): string {
  return `${ALIAS_PREFIXES[kind]}-${hashOf(id).slice(0, SHORT_ALIAS_HEX)}`;
}
