/**
 * Rebuild: drop the projection cache and replay it from the chain. And ADVANCE:
 * the same replay over an order that only grew, doing the work the growth
 * actually made necessary.
 *
 * This is the operation that PROVES the SQLite database is a cache and not a
 * source. Nothing in it is authored directly — every row comes from replaying
 * events. Drop the tables, recreate the empty schema, fold the chain's ordered
 * events into projections, and materialize them. Run it any time the cache is
 * suspect, stale, or its shape changed: the result is defined entirely by the
 * chain, so a rebuild is always safe and always converges to the same state.
 *
 * Two things keep it all-or-nothing. The chain is read and folded BEFORE the
 * transaction opens, so an unreadable chain (a corrupt line) throws without
 * touching the cache — the previous cache stays intact. Then the drop, recreate,
 * and materialize run in one transaction; SQLite's DDL is transactional, so a
 * failure mid-write rolls back to the old cache rather than leaving a
 * half-rebuilt one.
 *
 * ## Why there are two entry points and not two implementations
 *
 * {@link advance} exists because of a measurement, and the measurement said the
 * folds are not the cost. On a realistic record (207 events, 148 KB) a rebuild is
 * 4.8 ms and its nine folds are 0.06 ms of that — 1%. The cost is READING the
 * chain (1.4 ms) and WRITING the rows (2.5 ms, of which the reference index alone
 * is 1.1 ms and the full-text index 0.55 ms), plus 0.9 ms of DDL that is flat in
 * the record. So the only lever worth pulling is not folding less: it is not
 * re-reading a chain the caller already holds in order, and not rewriting rows the
 * arrivals cannot have changed.
 *
 * Both functions therefore take the ORDER, not the chain, and both fold ALL of it
 * through {@link foldAll} — one fold block, one pass each, over the same ordered
 * stream, exactly as before. What differs is only which materializations run. A
 * projection is a function of the kinds it reads, so a table no arrival feeds is
 * identical either way and rewriting it would buy nothing (`fed-by.ts` holds that
 * table and the two universal readers in it).
 *
 * The one materialization brought forward by APPENDING rather than replacing is the
 * reference index, and it is the same function given a suffix and the position it
 * starts at ({@link materializeReferences}). It is also the expensive one, which is
 * why it is the one that got the treatment.
 */

import type { CatalogEvent } from '@mnema/chain';
import { dropProjections, ensureSchema, type ProjectionTable } from '../db/schema.js';
import type { SqliteDatabase } from '../db/sqlite.js';
import { projectChannelSwitches } from './channel.js';
import { materializeChannelSwitches } from './channel-store.js';
import { projectDecisions } from './decision.js';
import { materializeDecisions } from './decision-store.js';
import {
  projectHandoffs,
  projectKnowledge,
  projectLinks,
  projectObservations,
} from './knowledge.js';
import {
  materializeHandoffs,
  materializeLinks,
  materializeMemories,
  materializeObservations,
} from './knowledge-store.js';
import { materializeReferences } from './reference-store.js';
import { projectRuns } from './run.js';
import { materializeRuns } from './run-store.js';
import { materializeSearch } from './search-store.js';
import { projectSkills } from './skill.js';
import { materializeSkills } from './skill-store.js';
import { projectTasks } from './task.js';
import { materializeTasks } from './task-store.js';

/** Every projection of one ordered stream, folded. */
interface Folded {
  readonly tasks: ReturnType<typeof projectTasks>;
  readonly runs: ReturnType<typeof projectRuns>;
  readonly decisions: ReturnType<typeof projectDecisions>;
  readonly memories: ReturnType<typeof projectKnowledge>;
  readonly observations: ReturnType<typeof projectObservations>;
  readonly handoffs: ReturnType<typeof projectHandoffs>;
  readonly links: ReturnType<typeof projectLinks>;
  readonly skills: ReturnType<typeof projectSkills>;
  readonly switches: ReturnType<typeof projectChannelSwitches>;
}

/**
 * Folds every projection from one ordered stream. THE fold block, called by both
 * entry points: every projection folds the same ordered stream once, so they always
 * agree on what the chain says.
 *
 * It folds all nine even when only some will be written, and that is deliberate: the
 * nine together are 1% of a rebuild (0.06 ms on a realistic record), so folding
 * selectively would buy a rounding error and cost a second reading of which fold
 * belongs to which table.
 */
function foldAll(events: readonly CatalogEvent[]): Folded {
  return {
    tasks: projectTasks(events),
    runs: projectRuns(events),
    decisions: projectDecisions(events),
    memories: projectKnowledge(events),
    observations: projectObservations(events),
    handoffs: projectHandoffs(events),
    links: projectLinks(events),
    skills: projectSkills(events),
    switches: projectChannelSwitches(events),
  };
}

/**
 * Writes one table from the folds. The caller has already emptied it; the
 * reference index is absent here because it is the one fed by the STREAM rather
 * than by a fold (see below).
 */
function materialize(
  db: SqliteDatabase,
  table: Exclude<ProjectionTable, 'refs'>,
  folded: Folded,
): void {
  switch (table) {
    case 'tasks':
      materializeTasks(db, folded.tasks.values());
      return;
    case 'runs':
      materializeRuns(db, folded.runs.values());
      return;
    case 'decisions':
      materializeDecisions(db, folded.decisions.values());
      return;
    case 'memories':
      materializeMemories(db, folded.memories.values());
      return;
    case 'observations':
      materializeObservations(db, folded.observations.values());
      return;
    case 'handoffs':
      materializeHandoffs(db, folded.handoffs.values());
      return;
    case 'links':
      materializeLinks(db, folded.links);
      return;
    case 'skills':
      materializeSkills(db, folded.skills.values());
      return;
    case 'channel_switches':
      materializeChannelSwitches(db, folded.switches.values());
      return;
    case 'record_search':
      // The full-text index is filled from the projections just folded, not from a
      // second pass over the chain: one read, one fold, two views — so the index and
      // the tables cannot come to disagree about what the chain says.
      materializeSearch(db, {
        tasks: folded.tasks.values(),
        decisions: folded.decisions.values(),
        memories: folded.memories.values(),
        observations: folded.observations.values(),
        skills: folded.skills.values(),
      });
      return;
  }
}

/**
 * The tables {@link materialize} writes, in creation order. Written INLINE rather
 * than filtered out of the schema's list, so a table added to the schema does not
 * quietly join a rebuild without anyone deciding it should: the `Exclude` in
 * {@link materialize} is what refuses to compile until it has a case, and this array
 * is what refuses to compile until it is named here too.
 */
const FOLDED_TABLES: readonly Exclude<ProjectionTable, 'refs'>[] = [
  'tasks',
  'runs',
  'decisions',
  'memories',
  'observations',
  'handoffs',
  'links',
  'skills',
  'record_search',
  'channel_switches',
];

/**
 * Drops and replays EVERY projection from an ordered stream, transactionally.
 *
 * The stream is the caller's: whoever holds the order holds the whole input, and
 * a chain that failed to read never reaches here — which is what leaves the
 * existing cache untouched when a line is corrupt.
 */
export function rebuild(db: SqliteDatabase, events: readonly CatalogEvent[]): void {
  const folded = foldAll(events);
  const replace = db.transaction(() => {
    dropProjections(db);
    ensureSchema(db);
    for (const table of FOLDED_TABLES) materialize(db, table, folded);
    // The reference index is the one materialization fed by the STREAM rather
    // than by a fold: it is one row per appearance, not one per entity, so the
    // events themselves are its source. Same read, same order — an index built
    // from a second pass could disagree with the tables about both.
    materializeReferences(db, events);
  });
  replace();
}

/**
 * Brings a cache forward over events that were APPENDED to the order it was built
 * from: replaces the tables those events feed, and appends their rows to the
 * reference index.
 *
 * `events` is the whole order INCLUDING the arrivals — the folds read all of it,
 * because a projection is a fold of the stream and not of a window. `arrived` is the
 * suffix of it that is new, and `from` is where that suffix starts, which is exactly
 * the count of events the cache was previously built from.
 *
 * The caller owes two things, and neither is checkable here: that `arrived` really
 * is the tail of `events` (`events.length === from + arrived.length` is asserted,
 * being free; that the CONTENT lines up is established by whoever read the chain),
 * and that the order before `from` is unchanged. {@link chainArrivals} is what
 * establishes both, and its refusals are the cases where this must not be used.
 *
 * `tables` is what the arrivals feed (`tablesFedBy`). One transaction, like a
 * rebuild: a failure rolls back to the cache as it stood.
 */
export function advance(
  db: SqliteDatabase,
  events: readonly CatalogEvent[],
  arrived: readonly CatalogEvent[],
  from: number,
  tables: ReadonlySet<ProjectionTable>,
): void {
  if (events.length !== from + arrived.length) {
    throw new RangeError('advance was given arrivals that are not the tail of the order');
  }
  const folded = foldAll(events);
  const refold = FOLDED_TABLES.filter((table) => tables.has(table));
  const replace = db.transaction(() => {
    // Only the fed tables are emptied, and the schema is re-ensured for exactly
    // those. Every other table keeps the rows it has, which is not an optimization
    // so much as the theorem: the events that arrived do not appear in their folds,
    // so replaying them would write the rows that are already there.
    dropProjections(db, new Set(refold));
    ensureSchema(db);
    for (const table of refold) materialize(db, table, folded);
    if (tables.has('refs')) materializeReferences(db, arrived, from);
  });
  replace();
}
