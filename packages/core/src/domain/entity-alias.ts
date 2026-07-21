import { createHash } from 'node:crypto';

/**
 * The kinds of entity that carry a committed id and a derived alias. The alias
 * is display/CLI ergonomics only — NEVER the identity (that is the id). A kind
 * gives the alias its one-letter prefix so a human reading `t-3a9f` knows it is
 * a task without a lookup.
 */
export type AliasKind = 'task' | 'epic' | 'sprint' | 'decision';

const KIND_PREFIX: Record<AliasKind, string> = {
  task: 't',
  epic: 'e',
  sprint: 's',
  decision: 'd',
};

/**
 * How many hex chars of the id hash the DEFAULT alias carries. Long enough that
 * a collision across a project's entities is vanishingly unlikely, short enough
 * to type. The resolver auto-lengthens on the rare clash, git short-SHA style,
 * so this is a display default, not a uniqueness guarantee.
 */
const DEFAULT_ALIAS_LEN = 4;

/**
 * The stable per-id hash the alias is a prefix of. Deriving the alias from a
 * HASH of the id — not the id's own leading chars — matters: a v7 UUID begins
 * with a millisecond timestamp, so two entities created in the same moment
 * share a long prefix and their raw-id aliases would not discriminate. The hash
 * spreads them uniformly.
 */
function aliasHash(id: string): string {
  return createHash('sha256').update(id).digest('hex');
}

/**
 * The default short alias for an entity, e.g. `t-3a9f`. Ergonomic handle for
 * the CLI and display; resolve it back to the id with {@link aliasMatches}.
 *
 * @param kind - The entity kind (sets the one-letter prefix)
 * @param id - The entity's committed id
 * @param length - Hash chars after the prefix (defaults to {@link DEFAULT_ALIAS_LEN})
 */
export function deriveAlias(kind: AliasKind, id: string, length = DEFAULT_ALIAS_LEN): string {
  return `${KIND_PREFIX[kind]}-${aliasHash(id).slice(0, length)}`;
}

/** The id with its hyphens stripped, so a copied id-prefix matches uniformly. */
function idHex(id: string): string {
  return id.toLowerCase().replace(/-/g, '');
}

/**
 * Whether `query` resolves to the entity `{kind, id}`. Accepts, in order:
 * - the full id (`019f76e4-…`) — an exact id match;
 * - a full or PARTIAL alias (`t-3a9f`, `t-3a`) — the kind prefix must match and
 *   the hex tail must be a prefix of this id's alias hash;
 * - a bare hex prefix with no kind (`3a9f`) — matches any kind on either this
 *   id's alias HASH or the id ITSELF (hyphen-insensitive), so a prefix copied
 *   straight off the id-named mirror file resolves too.
 *
 * Partial matching is what lets the resolver behave like `git show <short-sha>`:
 * the caller collects every entity a query matches and only errors when more
 * than one does (ambiguous — the user types more chars). Matching the id's own
 * prefix reintroduces the v7 timestamp collision the alias hash avoids, but the
 * ambiguity path handles it: two same-window ids share a prefix and the caller
 * is told to type more.
 *
 * @param query - The user-typed handle (id, alias, or hash/id prefix)
 * @param kind - The candidate entity's kind
 * @param id - The candidate entity's committed id
 */
export function aliasMatches(query: string, kind: AliasKind, id: string): boolean {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return false;
  if (q === id.toLowerCase()) return true;

  const hash = aliasHash(id);
  const prefix = KIND_PREFIX[kind];
  // `t-3a` → kind prefix + hex tail. The tail may be empty (`t-`), which then
  // matches every id of that kind — the maximally-ambiguous handle the resolver
  // reports so the user types more, exactly like an empty git rev.
  const kinded = q.match(/^([a-z])-([0-9a-f]*)$/);
  if (kinded !== null) {
    return kinded[1] === prefix && hash.startsWith(kinded[2] as string);
  }
  // Bare hex prefix, no kind — matches the alias hash OR the id itself. Compare
  // against the hyphen-stripped id so a prefix copied from the mirror filename
  // resolves whether or not the user includes the dashes.
  if (/^[0-9a-f]+$/.test(q)) return hash.startsWith(q) || idHex(id).startsWith(q);
  // A hyphenated id prefix (`019f77c5-73a9`) copied off a filename.
  if (/^[0-9a-f-]+$/.test(q)) return idHex(id).startsWith(idHex(q));
  return false;
}

/** A resolution candidate: an entity's committed id under a known kind. */
export interface AliasCandidate {
  readonly kind: AliasKind;
  readonly id: string;
}

/**
 * The outcome of resolving a query against a candidate set:
 * - `unique` — exactly one candidate matched; `id` is the resolved entity.
 * - `ambiguous` — more than one matched; `ids` lists every match so the caller
 *   can tell the user to type more chars (git short-SHA style).
 * - `none` — nothing matched.
 */
export type AliasResolution =
  | { readonly status: 'unique'; readonly id: string }
  | { readonly status: 'ambiguous'; readonly ids: readonly string[] }
  | { readonly status: 'none' };

/**
 * Resolves `query` against `candidates` to a single committed id, or reports
 * ambiguity/absence. Pure: the caller supplies the candidate set (usually every
 * live entity of one kind in the project) and decides how to surface each
 * outcome. Matching is {@link aliasMatches}, so a full id, a full or partial
 * alias, and a bare hash prefix all resolve, and a shared prefix auto-lengthens
 * by reporting `ambiguous` until the user types enough to single one out.
 */
export function resolveAlias(
  query: string,
  candidates: readonly AliasCandidate[],
): AliasResolution {
  const matches: string[] = [];
  for (const candidate of candidates) {
    if (aliasMatches(query, candidate.kind, candidate.id)) matches.push(candidate.id);
  }
  if (matches.length === 1) return { status: 'unique', id: matches[0] as string };
  if (matches.length > 1) return { status: 'ambiguous', ids: matches };
  return { status: 'none' };
}
