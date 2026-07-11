import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * The foldered `.md` mirror layout (MNEMA-ADR-51).
 *
 * Memory-row and skill mirrors live in ONE level of PRESENTATIONAL subfolders
 * instead of flat at the root:
 *
 * - memories: `<memoryDir>/<scope-folder>/<slug>.md`, scopeless at the root.
 * - skills:   `<skillsDir>/default/<slug>.md` (tool-shipped seeds) or
 *             `<skillsDir>/authored/<slug>.md` (human/AI-authored).
 *
 * The subfolder name is **presentational only** — it is never parsed back into
 * a scope or an origin. The slug (the file basename) stays the sole key, so
 * every reader resolves a mirror by matching the basename to a known slug via
 * a recursive one-level scan, exactly like the task `backlog/<STATE>/<KEY>.md`
 * nested-orphan pattern. This sidesteps any need for a reversible
 * scope↔folder encoding (scope is free-form and could collide with any
 * encoding), and keeps the recursive scanners bounded and simple.
 */

/** Curated index filenames that are not entity mirrors and never have a row. */
export const INDEX_FILENAMES: ReadonlySet<string> = new Set(['INDEX.md', 'SKILL.md']);

/** Skill origin subfolders (MNEMA-ADR-51). */
export const SKILL_DEFAULT_DIR = 'default';
export const SKILL_AUTHORED_DIR = 'authored';

/** The reserved handle whose skills are the tool-shipped seeds. */
export const SEED_AUTHOR_HANDLE = 'system';

/**
 * Maps a memory `scope` to its presentational folder segment, or `null` for a
 * scopeless memory (which mirrors at the root). A scope like `packages/notifier`
 * becomes a single flattened segment so the tree stays one level deep and the
 * folder name never needs to round-trip back to the scope. `/` and any other
 * path-unsafe character collapses to `-`; the result is lowercased and trimmed
 * of leading/trailing separators. This is lossy BY DESIGN — the slug, not the
 * folder, is the key.
 */
export function scopeFolder(scope: string | null | undefined): string | null {
  if (scope === null || scope === undefined) return null;
  const seg = scope
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return seg.length > 0 ? seg : null;
}

/**
 * The relative directory (under the skills dir) a skill's mirror belongs in,
 * chosen by author: seeds recorded by the reserved `system` handle go to
 * `default/`, everything else to `authored/`.
 *
 * @param createdByHandle - The resolved author handle of the skill's row
 */
export function skillOriginDir(createdByHandle: string): string {
  return createdByHandle === SEED_AUTHOR_HANDLE ? SKILL_DEFAULT_DIR : SKILL_AUTHORED_DIR;
}

/**
 * Walks `root` up to `maxDepth` levels deep and returns every `.md`/`.markdown`
 * entry as `{ slug, filePath }`, where `slug` is the file basename without its
 * extension. Dotfiles and the curated indexes ({@link INDEX_FILENAMES}) are
 * skipped. Returns an empty array when `root` does not exist.
 *
 * `maxDepth = 1` (the default) covers the ADR-51 one-level layout plus any
 * flat files still at the root (so a not-yet-migrated tree still scans). The
 * scan is basename-keyed, so the subfolder name is irrelevant to the result.
 */
export function listMirrorEntries(
  root: string,
  maxDepth = 1,
): Array<{ slug: string; filePath: string }> {
  if (!existsSync(root)) return [];
  const out: Array<{ slug: string; filePath: string }> = [];
  const walk = (dir: string, depth: number): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < maxDepth) walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      if (INDEX_FILENAMES.has(entry.name)) continue;
      const ext = entry.name.endsWith('.markdown')
        ? '.markdown'
        : entry.name.endsWith('.md')
          ? '.md'
          : null;
      if (ext === null) continue;
      out.push({ slug: entry.name.slice(0, -ext.length), filePath: full });
    }
  };
  walk(root, 0);
  return out;
}

/**
 * The canonical `.md` path a mirror belongs at under `root`: inside `subfolder`
 * when given, at the root when `subfolder` is null. The single place that
 * builds a foldered mirror path, so writers and the drift check agree on where
 * a mirror SHOULD live (and thus what counts as "mislocated").
 */
export function canonicalMirrorPath(root: string, slug: string, subfolder: string | null): string {
  return subfolder === null
    ? path.join(root, `${slug}.md`)
    : path.join(root, subfolder, `${slug}.md`);
}

/**
 * Finds the mirror file for `slug` anywhere in the foldered layout under
 * `root`, or `null` when absent. Matches on the file basename, so it locates a
 * mirror regardless of which subfolder it sits in (or if it is still flat).
 */
export function findMirror(root: string, slug: string, maxDepth = 1): string | null {
  const target = `${slug}.md`;
  const targetAlt = `${slug}.markdown`;
  if (!existsSync(root)) return null;
  const walk = (dir: string, depth: number): string | null => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < maxDepth) {
          const found = walk(full, depth + 1);
          if (found !== null) return found;
        }
        continue;
      }
      if (entry.isFile() && (entry.name === target || entry.name === targetAlt)) return full;
    }
    return null;
  };
  return walk(root, 0);
}
