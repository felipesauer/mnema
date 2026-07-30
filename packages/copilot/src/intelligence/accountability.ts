/**
 * accountability: who authorized what, and which agent carried it out.
 *
 * This is the derivation the proof exists FOR. Every event carries `who` (the
 * human who AUTHORIZED the fact, an anchor derived from a key — unforgeable) and,
 * when an agent acted, `which` (the agent that EXECUTED it, a free name). The two
 * are distinct identities by construction. accountability folds the record into a
 * factual account of authorship: per authorizing `who`, how many facts, of which
 * kinds, and which agents acted under that authority. The human authorized; the
 * agent executed — kept visibly separate, because that separation is the whole
 * point of recording both.
 *
 * It COUNTS, it does not JUDGE. There is no "X did too much", no "Y is
 * suspicious", no valued ranking — a count is a count. The rows are ordered by
 * count only so the output is deterministic and stable, NOT as a verdict of
 * importance; a reader who wants a different order sorts the rows themselves. The
 * moment this said "excessive" or "concerning" it would stop being a derivation
 * of the proof and start inventing a fact the chain never recorded.
 *
 * ## One account, or one per project
 *
 * A count is about a RECORD, so how far it reaches is part of what it says.
 * {@link accountability} folds whatever it is given into one account, which is the
 * answer when the trees are one record. {@link accountabilityByProject} keeps a
 * workspace's projects apart — one account each, never a sum — because a total over
 * several codebases answers a different question under the same name. The second is
 * the derivation, not a variant: it calls the same fold, once per record.
 *
 * ## Counted in SQL, not in a scan
 *
 * The counting happens in the REFERENCE INDEX, one grouped query per tree, and
 * the trees' tallies are summed here. It counts subject rows, of which every
 * event has exactly one — so an event that refers to three entities is still one
 * fact, and the total is a count of events, not of references.
 *
 * The two breakdowns (by kind, by agent) come from ONE grouping, summed along
 * different axes. Deriving them from a single tally is what keeps them from
 * disagreeing: they cannot report different totals for the same author, because
 * they are two sums of the same cells.
 *
 * It reads only the envelope — `who`, `which`, `kind`, `at` — never a payload, so
 * it is blind to WHAT each fact was beyond its kind, which is right: authorship
 * is an envelope property.
 */

import type { AuthorshipFilter, AuthorshipTally } from '@mnema/core';
import type { ScopedCache } from '../sources.js';
import type { EventKind } from './events.js';

/** Optional narrowing of the record before it is aggregated. */
export type AccountabilityFilter = AuthorshipFilter;

/** One authorizing identity's factual account of authorship over the record. */
export interface WhoAccount {
  /** The authorizing human (an anchor id). */
  readonly who: string;
  /** How many facts this human authorized in scope. */
  readonly total: number;
  /**
   * The count of facts by kind, one entry per kind present, kind-sorted for a
   * stable shape. The counts sum to `total`.
   */
  readonly byKind: readonly KindCount[];
  /**
   * The agents that executed facts under this authority, each with its count —
   * the who≠which distinction made explicit. A fact with no agent (a human
   * acting directly) is counted under the `null` agent. Sorted by count then
   * name for a stable shape.
   */
  readonly byWhich: readonly WhichCount[];
}

/** A count of facts of one kind. */
export interface KindCount {
  readonly kind: EventKind;
  readonly count: number;
}

/** A count of facts executed by one agent (or none). */
export interface WhichCount {
  /** The executing agent's name, or null when the human acted with no agent. */
  readonly which: string | null;
  readonly count: number;
}

/** A factual account of authorship over the record, within an optional window. */
export interface Accountability {
  /** The `from` filter applied, echoed back for the reader (undefined if none). */
  readonly from?: string;
  /** The `to` filter applied, echoed back for the reader (undefined if none). */
  readonly to?: string;
  /** Total facts in scope, across all authors. */
  readonly total: number;
  /** One account per authorizing `who`, most facts first (then who-sorted). */
  readonly byWho: readonly WhoAccount[];
}

/**
 * The account of authorship across `sources`, after narrowing by the optional
 * filter. The window is inclusive on both ends and compared on the ISO strings
 * directly (ISO-8601 UTC stamps sort lexically, the same order the chain merges
 * on). An empty record — or filters that exclude everything — yields a zero
 * account (`total: 0`, empty `byWho`), never an error.
 *
 * ONE account over whatever it is given, which is the right answer when the sources
 * are one record: a project's trees, or a single tree. Given the trees of several
 * PROJECTS it would sum them into a number that answers a different question under
 * this name — {@link accountabilityByProject} is that read.
 */
export function accountability(
  sources: readonly ScopedCache[],
  filter: AccountabilityFilter = {},
): Accountability {
  return {
    ...(filter.from !== undefined ? { from: filter.from } : {}),
    ...(filter.to !== undefined ? { to: filter.to } : {}),
    ...fold(sources, filter),
  };
}

/** One record's account of authorship, and which record it is. */
export interface ProjectAccount {
  /**
   * The project whose trees this counts — absent for the machine-global tree, which
   * belongs to no project and is the same tree for all of them.
   */
  readonly project?: string;
  /** Total facts in this record, across all authors. */
  readonly total: number;
  /** One account per authorizing `who`, most facts first (then who-sorted). */
  readonly byWho: readonly WhoAccount[];
}

/** The records of a workspace accounted for side by side, never added together. */
export interface WorkspaceAccountability {
  /** The `from` filter applied, echoed back for the reader (undefined if none). */
  readonly from?: string;
  /** The `to` filter applied, echoed back for the reader (undefined if none). */
  readonly to?: string;
  /**
   * One account per record: each project of the workspace, and the machine-global
   * tree. Projects in the order the caller listed their trees, the projectless entry
   * last.
   *
   * A record that matched nothing is still HERE, at zero. An entry missing from this
   * list would be indistinguishable from a project the read never opened, and the
   * whole point of the list is that it says where it looked.
   *
   * There is deliberately NO total beside it. See {@link accountabilityByProject}.
   */
  readonly byProject: readonly ProjectAccount[];
}

/**
 * The account of authorship of EACH record in `sources`, grouped by the project whose
 * trees hold it, with the same filter applied to every one.
 *
 * This is where an aggregate parts from an index. Merging hits across projects widens
 * a list and changes nothing in it; merging COUNTS produces a number that means
 * something else. "Who authorized what here" summed over three codebases answers "who
 * authorized what in this workspace" while still being called the first thing, and a
 * reader takes the larger number for the smaller question with nothing in the answer
 * to warn them. Every count here means exactly what it meant when the project was the
 * only one open — which is the property that makes the answer usable at all.
 *
 * And NOT decomposing is not the safe alternative, which is what settles it: these
 * reads take no project argument, by the same rule that keeps a flag off the id-keyed
 * ones. An account locked to the session's own project leaves an agent with no way to
 * ask about the others at all — the blindness that a routed write already fixed for
 * writing, left in place for auditing.
 *
 * So: no total across the entries, not even beside them. A workspace figure offered
 * next to the decomposition is the same misleading number with an excuse, and the one
 * a hurried reader takes. Adding them up is the reader's act, on the reader's
 * question.
 *
 * The machine-global tree gets ONE entry, whatever the project count, because every
 * project resolves the same tree: folding it into each project's account would count
 * one personal note three times, and giving it to one project arbitrarily would say a
 * cross-project note belongs to a codebase.
 *
 * The entries are NOT ordered by count. `byWho` inside one is, for a stable shape and
 * explicitly not as a verdict; ordering the records that way would rank the projects,
 * which is the one thing this read must not do. Source order is already deterministic
 * and it carries a fact instead — the session's own project comes first.
 */
export function accountabilityByProject(
  sources: readonly ScopedCache[],
  filter: AccountabilityFilter = {},
): WorkspaceAccountability {
  const grouped = new Map<string | undefined, ScopedCache[]>();
  for (const source of sources) {
    const group = grouped.get(source.project);
    if (group === undefined) grouped.set(source.project, [source]);
    else group.push(source);
  }
  const byProject = [...grouped.entries()]
    .map(([project, group]) => ({
      ...(project !== undefined ? { project } : {}),
      ...fold(group, filter),
    }))
    .sort(projectlessLast);
  return {
    ...(filter.from !== undefined ? { from: filter.from } : {}),
    ...(filter.to !== undefined ? { to: filter.to } : {}),
    byProject,
  };
}

/**
 * The one fold: every tree's grouped counts summed into a total and a per-author
 * breakdown.
 *
 * Both reads above call THIS, so a single account and one entry of a decomposition
 * cannot come to disagree about what a count is — the same reason the two breakdowns
 * inside an author come from one grouping.
 */
function fold(
  sources: readonly ScopedCache[],
  filter: AccountabilityFilter,
): { total: number; byWho: readonly WhoAccount[] } {
  const perWho = new Map<string, WhoAccumulator>();
  let total = 0;
  for (const source of sources) {
    for (const cell of source.cache.authorship(filter)) {
      total += cell.count;
      accumulate(perWho, cell);
    }
  }
  return { total, byWho: [...perWho.values()].map(finishWho).sort(byTotalThenWho) };
}

/** Keeps the projectless record after the projects, leaving their order untouched. */
function projectlessLast(a: ProjectAccount, b: ProjectAccount): number {
  if (a.project === b.project) return 0;
  if (a.project === undefined) return 1;
  if (b.project === undefined) return -1;
  return 0;
}

/** Mutable per-`who` tallies, finished into a `WhoAccount`. */
interface WhoAccumulator {
  readonly who: string;
  total: number;
  readonly byKind: Map<EventKind, number>;
  readonly byWhich: Map<string | null, number>;
}

/**
 * Adds one tally cell to its author's totals, creating the author on first
 * sight. The same cell feeds both breakdowns, which is why they always agree.
 */
function accumulate(perWho: Map<string, WhoAccumulator>, cell: AuthorshipTally): void {
  let acc = perWho.get(cell.who);
  if (acc === undefined) {
    acc = { who: cell.who, total: 0, byKind: new Map(), byWhich: new Map() };
    perWho.set(cell.who, acc);
  }
  acc.total += cell.count;
  acc.byKind.set(cell.kind, (acc.byKind.get(cell.kind) ?? 0) + cell.count);
  acc.byWhich.set(cell.which, (acc.byWhich.get(cell.which) ?? 0) + cell.count);
}

/** Finishes an accumulator into an immutable, stably-ordered account. */
function finishWho(acc: WhoAccumulator): WhoAccount {
  const byKind = [...acc.byKind.entries()]
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));
  const byWhich = [...acc.byWhich.entries()]
    .map(([which, count]) => ({ which, count }))
    .sort(byCountThenWhich);
  return { who: acc.who, total: acc.total, byKind, byWhich };
}

/** Accounts by count descending, then by `who` ascending — stable, not a verdict. */
function byTotalThenWho(a: WhoAccount, b: WhoAccount): number {
  if (a.total !== b.total) return b.total - a.total;
  return a.who < b.who ? -1 : a.who > b.who ? 1 : 0;
}

/** Agent counts by count descending, then by name — `null` (no agent) last. */
function byCountThenWhich(a: WhichCount, b: WhichCount): number {
  if (a.count !== b.count) return b.count - a.count;
  if (a.which === b.which) return 0;
  if (a.which === null) return 1;
  if (b.which === null) return -1;
  return a.which < b.which ? -1 : 1;
}
