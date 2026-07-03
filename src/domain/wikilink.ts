/**
 * A wikilink extracted from a markdown body.
 *
 * `[[slug]]` → `{ slug, anchor: null, alias: null, raw: '[[slug]]' }`
 * `[[slug#section]]` → `{ slug, anchor: 'section', alias: null, … }`
 * `[[slug|Label]]` → `{ slug, anchor: null, alias: 'Label', … }` (Obsidian
 *   alias: the slug resolves, the label is display-only)
 */
export interface Wikilink {
  readonly slug: string;
  readonly anchor: string | null;
  /** Obsidian display alias (`[[slug|alias]]`), or null when absent. */
  readonly alias: string | null;
  readonly raw: string;
}

// `[` is excluded from the slug/anchor classes so an extra leading bracket
// (`[[[slug]]]`) cannot be swallowed into the slug — the engine instead matches
// the inner `[[slug]]`. `|` is excluded from the slug and anchor so an Obsidian
// alias (`[[slug|Label]]`, `[[slug#anchor|Label]]`) is captured separately in
// group 3 rather than glued onto the slug (which would never resolve). Anchor
// and alias content are `*` (not `+`) so `[[slug#]]` / `[[slug|]]` still match
// and yield null for the empty part.
const WIKILINK_RE = /\[\[([^[\]\n#|]+)(?:#([^[\]\n|]*))?(?:\|([^[\]\n]*))?\]\]/g;

/**
 * Extracts every `[[slug]]` / `[[slug#anchor]]` / `[[slug|alias]]` wikilink
 * from a markdown body. Pure function — no I/O. Slug, anchor and alias are
 * trimmed; empty slugs (e.g. `[[ ]]`, `[[|x]]`) are skipped. For
 * `[[a|b|c]]` the first `|` is the separator, so the alias is `b|c`.
 *
 * @param body - Markdown text to scan
 * @returns The wikilinks in document order (duplicates preserved)
 */
export function extractWikilinks(body: string): Wikilink[] {
  const out: Wikilink[] = [];
  // `matchAll` needs the global flag; reset lastIndex via a fresh regex
  // per call is avoided by using matchAll on a cloned source.
  for (const match of body.matchAll(WIKILINK_RE)) {
    const slug = match[1]?.trim() ?? '';
    if (slug.length === 0) continue;
    const anchorRaw = match[2]?.trim();
    const aliasRaw = match[3]?.trim();
    out.push({
      slug,
      anchor: anchorRaw !== undefined && anchorRaw.length > 0 ? anchorRaw : null,
      alias: aliasRaw !== undefined && aliasRaw.length > 0 ? aliasRaw : null,
      raw: match[0],
    });
  }
  return out;
}
