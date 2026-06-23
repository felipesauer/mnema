/**
 * A wikilink extracted from a markdown body.
 *
 * `[[slug]]` → `{ slug, anchor: null, raw: '[[slug]]' }`
 * `[[slug#section]]` → `{ slug, anchor: 'section', raw: '[[slug#section]]' }`
 */
export interface Wikilink {
  readonly slug: string;
  readonly anchor: string | null;
  readonly raw: string;
}

const WIKILINK_RE = /\[\[([^\]\n#]+)(?:#([^\]\n]+))?\]\]/g;

/**
 * Extracts every `[[slug]]` / `[[slug#anchor]]` wikilink from a markdown
 * body. Pure function — no I/O. Slugs and anchors are trimmed; empty
 * slugs (e.g. `[[ ]]`) are skipped.
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
    out.push({
      slug,
      anchor: anchorRaw !== undefined && anchorRaw.length > 0 ? anchorRaw : null,
      raw: match[0],
    });
  }
  return out;
}
