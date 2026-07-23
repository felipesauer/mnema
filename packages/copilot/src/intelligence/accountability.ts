/**
 * accountability: who authorized what, and which agent carried it out.
 *
 * This is the derivation the proof exists FOR. Every event carries `who` (the
 * human who AUTHORIZED the fact, an anchor derived from a key — unforgeable) and,
 * when an agent acted, `which` (the agent that EXECUTED it, a free name). The two
 * are distinct identities by construction. accountability folds a stream into a
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
 * of the proof and start inventing a fact the chain never recorded. It reports
 * what the events say; the interpretation is the reader's.
 *
 * The scope is the caller's: it folds exactly the events handed to it (one tree,
 * or the union across trees), narrowed by the optional filters. It reads only the
 * envelope — `who`, `which`, `kind`, `at` — never a payload, so it is blind to
 * WHAT each fact was beyond its kind, which is right: authorship is an envelope
 * property.
 */

import type { CatalogEvent, EventKind } from './events.js';

/** Optional narrowing of the stream before it is aggregated. */
export interface AccountabilityFilter {
  /** Include only events at or after this ISO-8601 instant (inclusive). */
  readonly from?: string;
  /** Include only events at or before this ISO-8601 instant (inclusive). */
  readonly to?: string;
  /** Include only events authorized by this `who` (an anchor id). */
  readonly who?: string;
  /** Include only events executed by this agent (`which`). */
  readonly which?: string;
}

/** One authorizing identity's factual account of authorship over the stream. */
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

/** A factual account of authorship over a stream, within an optional window. */
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
 * Folds `events` into a factual account of authorship, after narrowing by the
 * optional filters. The window is inclusive on both ends and compared on the ISO
 * strings directly (ISO-8601 UTC stamps sort lexically, the same order the chain
 * merges on). An empty stream — or filters that exclude everything — yields a
 * zero account (`total: 0`, empty `byWho`), never an error.
 */
export function accountability(
  events: readonly CatalogEvent[],
  filter: AccountabilityFilter = {},
): Accountability {
  const perWho = new Map<string, WhoAccumulator>();
  let total = 0;
  for (const event of events) {
    if (!inScope(event, filter)) continue;
    total += 1;
    accumulate(perWho, event);
  }
  const byWho = [...perWho.values()].map(finishWho).sort(byTotalThenWho);
  return {
    ...(filter.from !== undefined ? { from: filter.from } : {}),
    ...(filter.to !== undefined ? { to: filter.to } : {}),
    total,
    byWho,
  };
}

/** Mutable per-`who` tallies, finished into a `WhoAccount`. */
interface WhoAccumulator {
  readonly who: string;
  total: number;
  readonly byKind: Map<EventKind, number>;
  readonly byWhich: Map<string | null, number>;
}

/** True if an event passes every provided filter. */
function inScope(event: CatalogEvent, filter: AccountabilityFilter): boolean {
  if (filter.from !== undefined && event.at < filter.from) return false;
  if (filter.to !== undefined && event.at > filter.to) return false;
  if (filter.who !== undefined && event.who !== filter.who) return false;
  if (filter.which !== undefined && event.which !== filter.which) return false;
  return true;
}

/** Adds one event to its author's tallies, creating the author on first sight. */
function accumulate(perWho: Map<string, WhoAccumulator>, event: CatalogEvent): void {
  let acc = perWho.get(event.who);
  if (acc === undefined) {
    acc = { who: event.who, total: 0, byKind: new Map(), byWhich: new Map() };
    perWho.set(event.who, acc);
  }
  acc.total += 1;
  acc.byKind.set(event.kind, (acc.byKind.get(event.kind) ?? 0) + 1);
  const which = event.which ?? null;
  acc.byWhich.set(which, (acc.byWhich.get(which) ?? 0) + 1);
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
