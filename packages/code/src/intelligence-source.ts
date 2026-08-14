/**
 * WHICH trees an intelligence read covers, and HOW each one takes them.
 *
 * The two intelligence derivations that fold RAW EVENTS — `antipatterns` (which looks
 * for a SHAPE, `payload.action`, that no projection keys) and `exposure` (which needs
 * the TEXT of every fact, which no projection keeps) — are the auditor's view of the
 * record rather than of one tree's slice. A task's story crosses trees (an observation
 * `about` it, or a link whose `target` is it, can live in a different tree from the task
 * itself), so the honest source is every tree's events in one deterministic order. That
 * is exactly what {@link orderedEventsOfRecord} gives: a k-way merge of the present trees,
 * with no cross-tree precedence. The other reads of the record reach the same trees
 * through their projection caches; what differs is the mechanism, never the coverage.
 *
 * Neither of these opens a cache, rebuilds one to disk, or opens a writer — they read
 * the tails of the present trees and fold them. Strictly read-only: the only I/O is
 * reading the committed segments. A tree that is named but has never been written
 * contributes nothing and is left absent on disk, because `listTails` returns `[]` for a
 * directory that is missing or empty — so a caller may pass every candidate and let the
 * empty ones fall out of the answer rather than out of the account of where it looked.
 *
 * Two axes decide the sources, and they are independent:
 *
 *   WHICH TREES. {@link recordTrees} lists one record's trees — the ONE place that
 *   walks the scopes and the one place that decides a tree's project label. Every
 *   read of the record composes from it, including the ones that ask a projection
 *   cache, so "which trees, and whose" is answered identically however the answer is
 *   then computed.
 *
 *   HOW THEY ARE TAKEN. A question about the record as a whole wants them MERGED
 *   ({@link recordEvents}, {@link projectEventsOf}); a question whose answer has to
 *   say which tree wants them SEPARATE ({@link scopedEvents},
 *   {@link scopedEventsOf}). A report about credentials is the second case: a fact in
 *   the public tree is committed and clones to everyone, and the same fact in the
 *   global tree is on one disk — the same finding, two situations, and a merge is
 *   exactly what would lose the difference.
 *
 *   THE FIRST TWO CARRY BOTH, and that is not a third axis. A record's shapes are
 *   counted over the merge, and the one `ADR-<n>` question is asked of each chain
 *   alone — one answer, two views of the same reading, rather than a caller choosing.
 *   Which is why they hand over a record and not a stream: the two views are read
 *   together, so they cannot come from different trees.
 *
 * The `*Of` pair takes an explicit tree list, which is what lets one session reach
 * every project of a workspace; the two that take a {@link ResolvedTrees} are the ones
 * asked about the trees of ONE record, which is what `cwd` resolves to.
 *
 * THE SECOND HALF OF THAT SENTENCE USED TO SAY *"the command line's, where there is no
 * workspace to span"*, AND THE COMMAND LINE HAS ONE NOW: `mnema verify --workspace`
 * covers every project the caller names. It does not reach these functions — a verdict
 * replays chains rather than folding events — so what the pair is remains exactly what
 * it was, and what is false is only the claim that no CLI reading crosses projects.
 */

import type { ChainLayout, UpcasterRegistry } from '@mnema/chain';
import type { ProjectEvents, RecordEvents, ScopedEvents } from '@mnema/copilot';
import {
  chainRootForScope,
  orderedEvents,
  orderedEventsOfRecord,
  type ResolvedTrees,
  type Scope,
} from '@mnema/core';

/** The order the trees of one record are listed in — a role at a time, fixed. */
const SCOPE_ORDER = ['public', 'private', 'global'] as const;

/**
 * One tree of the record: the role it plays, where its chain lives, and whose it is.
 *
 * The identity half of a read source, with no reader attached — the same three facts
 * a `ScopedCache` carries beside its cache, which is why a cache is built by adding
 * one to a tree of this list rather than by walking the scopes a second time.
 */
export interface ScopedTree {
  /** The tree's role — the scope every answer from it carries. */
  readonly scope: Scope;
  /**
   * Where the tree's chain lives on disk — the tree's IDENTITY, and the only thing
   * here that names one tree and no other. The scope does not: two `public` trees are
   * two repositories, so a read spanning projects dedupes on THIS.
   */
  readonly chainRoot: string;
  /**
   * The project the tree belongs to, when it belongs to one. Absent for the
   * machine-global tree — see {@link recordTrees}, the one place that decides it.
   */
  readonly project?: string;
}

/**
 * The trees a {@link ResolvedTrees} names, in a fixed order, each labelled with the
 * project it belongs to. Outside a project that is the global tree alone; inside one it
 * is public, private and global — the team's record, this machine's, and the personal
 * cross-project one. NAMED, not necessarily present: a tree nothing has been written to
 * yet has no directory, and it contributes no events rather than being left out here.
 *
 * THE LABEL IS DROPPED FOR `global` HERE, at this one place, so no caller can attach
 * it: a personal cross-project note reported as coming from whichever project a read
 * reached it through would be a false claim about where the fact lives, and the tree
 * is shared, so every project would make that claim differently.
 *
 * The order does not reach an answer — every reader over these sorts by a property of
 * the CONTENT, precisely so the order the trees are read in cannot reshuffle what a
 * caller sees.
 */
export function recordTrees(trees: ResolvedTrees, project: string | undefined): ScopedTree[] {
  const listed: ScopedTree[] = [];
  for (const scope of SCOPE_ORDER) {
    const root = chainRootForScope(trees, scope);
    if (root === undefined) continue;
    listed.push({
      scope,
      chainRoot: root,
      ...(scope !== 'global' && project !== undefined ? { project } : {}),
    });
  }
  return listed;
}

/**
 * The chain layouts of every tree `trees` names, in {@link recordTrees}' order. The
 * order only fixes the tie-break qualifier {@link orderedEventsOfRecord} applies — it
 * never grants one tree precedence over another.
 */
export function unionLayouts(trees: ResolvedTrees): ChainLayout[] {
  return recordTrees(trees, undefined).map((tree) => ({ root: tree.chainRoot }));
}

/**
 * One record, both ways: every present tree's events in one total, deterministic
 * order, and each tree's chain on its own.
 *
 * The union is what a question about the record as a whole folds. The chains are
 * what a question whose answer is a property of ONE chain folds — the `ADR-<n>`
 * label, whose number is minted from the writer's view of a single chain and means
 * nothing across two. Both come from ONE reading of the tails, so the second view
 * costs a merge rather than a second parse of every segment.
 *
 * Read-only: it reads the tails of the present trees, opening no cache and no writer.
 */
export function recordEvents(trees: ResolvedTrees, upcasters: UpcasterRegistry): RecordEvents {
  const { chains, across } = orderedEventsOfRecord(unionLayouts(trees), upcasters);
  return { events: across, chains };
}

/**
 * The same present trees, but each tree's events kept SEPARATE and tagged with the
 * scope they came from — one record's worth, with no project label, which is what the
 * intelligence reads of the command line are asked about (one project, from `cwd`).
 *
 * It used to end *"no workspace to span"*, which is no longer a fact about this
 * surface: `mnema verify --workspace` spans one. It is a fact about these readings,
 * which are handed one record and no set.
 */
export function scopedEvents(
  trees: ResolvedTrees,
  upcasters: UpcasterRegistry,
): readonly ScopedEvents[] {
  return scopedEventsOf(recordTrees(trees, undefined), upcasters);
}

/**
 * Each of the given trees read on its own, tagged with the scope AND the project it
 * belongs to — the source of a report that has to say where to go and rotate.
 *
 * The list is the caller's: hand it one record's trees and the answer is about that
 * record, hand it every project's and the answer spans the workspace. Read-only, like
 * the union.
 */
export function scopedEventsOf(
  trees: readonly ScopedTree[],
  upcasters: UpcasterRegistry,
): readonly ScopedEvents[] {
  return trees.map((tree) => ({
    scope: tree.scope,
    ...(tree.project !== undefined ? { project: tree.project } : {}),
    events: orderedEvents({ root: tree.chainRoot }, upcasters),
  }));
}

/**
 * The given trees grouped into RECORDS — one merged, deterministically ordered stream
 * per project, plus one for the machine-global tree — the source of a read that
 * answers about the record as a whole and must not add two records together.
 *
 * The merge happens per group, so each stream is a k-way merge of exactly the tails of
 * one record: the same order that record's own session would fold. Groups are in
 * first-seen order, which the caller fixed.
 *
 * Each record also arrives as its CHAINS, for the same reason and at the same cost as
 * in {@link recordEvents}: the merged stream cannot say which chain an event came from,
 * and a label that is numbered inside one chain has no meaning across two.
 */
export function projectEventsOf(
  trees: readonly ScopedTree[],
  upcasters: UpcasterRegistry,
): readonly ProjectEvents[] {
  const grouped = new Map<string | undefined, ChainLayout[]>();
  for (const tree of trees) {
    const layouts = grouped.get(tree.project);
    if (layouts === undefined) grouped.set(tree.project, [{ root: tree.chainRoot }]);
    else layouts.push({ root: tree.chainRoot });
  }
  return [...grouped.entries()].map(([project, layouts]) => {
    const { chains, across } = orderedEventsOfRecord(layouts, upcasters);
    return {
      ...(project !== undefined ? { project } : {}),
      events: across,
      chains,
    };
  });
}
