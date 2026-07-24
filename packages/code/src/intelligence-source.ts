/**
 * The event source the INTELLIGENCE reads share: the UNION of a project's trees.
 *
 * The three intelligence derivations (`timeline`, `accountability`,
 * `antipatterns`) are the AUDITOR's view — they answer questions about the whole
 * record, not one tree's slice. A task's story crosses trees (an observation
 * `about` it, or a link whose `target` is it, can live in a different tree from
 * the task itself), so the honest source is every tree's events merged into one
 * deterministic order. That is exactly what {@link orderedEventsAcross} gives:
 * a k-way merge of the present trees, with no cross-tree precedence.
 *
 * This is the ONE thing the intelligence reads do differently from the context
 * and guard reads (`focus`/`resume`/`next-actions`/`guard`), which open a
 * `ProjectionCache` over a SINGLE tree.
 * Intelligence never opens a cache, never rebuilds one to disk, never opens a
 * writer — it reads the tails of the present trees and folds them. Strictly
 * read-only: the only I/O is reading the committed segments.
 *
 * The layouts are the trees a {@link ResolvedTrees} actually names. Outside a
 * project only `global` is present; inside one, `projectPublic`, `projectPrivate`
 * (when it exists on disk), and `global`. `orderedEventsAcross` reads each with
 * {@link listTails}, which returns `[]` for a directory that is absent or empty,
 * so a named-but-unwritten tree simply contributes nothing — a caller may pass
 * every candidate and let the empty ones drop out.
 */

import type { CatalogEvent, ChainLayout, UpcasterRegistry } from '@mnema/chain';
import { orderedEventsAcross, type ResolvedTrees } from '@mnema/core';

/**
 * The chain layouts of every tree `trees` names, in a fixed order (public,
 * private, global). Absent project trees are simply omitted; a named tree whose
 * directory does not exist yet contributes no tails. The order only fixes the
 * tie-break qualifier {@link orderedEventsAcross} applies — it never grants one
 * tree precedence over another.
 */
export function unionLayouts(trees: ResolvedTrees): ChainLayout[] {
  const layouts: ChainLayout[] = [];
  if (trees.projectPublic !== undefined) layouts.push({ root: trees.projectPublic });
  if (trees.projectPrivate !== undefined) layouts.push({ root: trees.projectPrivate });
  layouts.push({ root: trees.global });
  return layouts;
}

/**
 * The union of every present tree's events in one total, deterministic order —
 * the stream the intelligence derivations fold. Read-only: it reads the tails of
 * the present trees and merges them, opening no cache and no writer.
 */
export function unionEvents(trees: ResolvedTrees, upcasters: UpcasterRegistry): CatalogEvent[] {
  return orderedEventsAcross(unionLayouts(trees), upcasters);
}
