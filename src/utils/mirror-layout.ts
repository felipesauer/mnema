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

/** Shared empty set so a default `excludeDirs` arg does not allocate per call. */
const EMPTY_DIR_SET: ReadonlySet<string> = new Set();

/** Curated index filenames that are not entity mirrors and never have a row. */
export const INDEX_FILENAMES: ReadonlySet<string> = new Set(['INDEX.md', 'SKILL.md']);

/** Skill origin subfolders (MNEMA-ADR-51). */
export const SKILL_DEFAULT_DIR = 'default';
export const SKILL_AUTHORED_DIR = 'authored';

/**
 * Memory subfolders that are HUMAN-CURATED sections (their own INDEX, linted as
 * ADRs/notes), NOT memory-row mirrors. A recursive row-mirror scan of the
 * memory dir must skip them, and a memory `scope` must never resolve to one of
 * these names — otherwise a scoped memory row would land among the curated
 * files, be reclassified by the consolidator, and (worse) be treated as an
 * orphan by the prune.
 */
export const CURATED_MEMORY_SUBFOLDERS: ReadonlySet<string> = new Set(['decisions', 'notes']);

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
 *
 * A segment that would collide with a curated memory subfolder
 * ({@link CURATED_MEMORY_SUBFOLDERS}, e.g. `decisions`/`notes`) is suffixed so
 * a scoped memory can never land inside the human-curated ADR/note trees.
 */
export function scopeFolder(scope: string | null | undefined): string | null {
  if (scope === null || scope === undefined) return null;
  const seg = scope
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (seg.length === 0) return null;
  return CURATED_MEMORY_SUBFOLDERS.has(seg) ? `${seg}-scope` : seg;
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
  options: { maxDepth?: number; excludeDirs?: ReadonlySet<string> } = {},
): Array<{ slug: string; filePath: string }> {
  const maxDepth = options.maxDepth ?? 1;
  const excludeDirs = options.excludeDirs ?? EMPTY_DIR_SET;
  if (!existsSync(root)) return [];
  const out: Array<{ slug: string; filePath: string }> = [];
  const walk = (dir: string, depth: number): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Skip curated top-level subfolders (e.g. memory decisions/notes) —
        // their files are not row mirrors and must never be scanned as such.
        if (depth === 0 && excludeDirs.has(entry.name)) continue;
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
 * Every mirror file for `slug` under `root` — usually one, but a partial
 * migration (crash between unlink and write) can leave a flat AND a foldered
 * copy. Returned in traversal order. Callers that must keep exactly one mirror
 * per slug use this to remove ALL stale copies, not just the first found.
 */
export function findAllMirrors(
  root: string,
  slug: string,
  options: { excludeDirs?: ReadonlySet<string> } = {},
): string[] {
  return listMirrorEntries(root, options)
    .filter((e) => e.slug === slug)
    .map((e) => e.filePath);
}

/**
 * Finds a mirror file for `slug` anywhere in the foldered layout under `root`,
 * or `null` when absent. Matches on the file basename, so it locates a mirror
 * regardless of which subfolder it sits in (or if it is still flat). When more
 * than one exists (a partial migration), returns the first in traversal order;
 * use {@link findAllMirrors} to reconcile duplicates.
 */
export function findMirror(
  root: string,
  slug: string,
  options: { excludeDirs?: ReadonlySet<string> } = {},
): string | null {
  return findAllMirrors(root, slug, options)[0] ?? null;
}
