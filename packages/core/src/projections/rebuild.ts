/**
 * Rebuild: drop the projection cache and replay it from the chain. Its counterpart is
 * `advance.ts`, which brings a cache forward over what ARRIVED and leaves the rest alone.
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
 * The advance exists because of a measurement, and the measurement said the folds are not
 * the cost. On a realistic record (207 events, 148 KB) a rebuild is 4.8 ms and its nine
 * folds are 0.06 ms of that — 1%. The cost is READING the chain (1.4 ms) and WRITING the
 * rows (2.5 ms, of which the reference index alone is 1.1 ms and the full-text index
 * 0.55 ms), plus 0.9 ms of DDL that is flat in the record. So the lever is not folding
 * less: it is not re-reading a chain the cache already holds, and not rewriting rows the
 * arrivals cannot have changed. THAT WAS TRUE OF A RECORD OF 207 EVENTS AND IT STOPPED BEING
 * TRUE BEFORE 100 THOUSAND: the first version of the advance still folded the whole order
 * to write the few rows an arrival changed, and a reading of a record that size measured
 * 0.65-0.73 s for one arrival (`measurements/the-record-at-scale/`), where the fold is the
 * part that grows. The advance now folds the ARRIVALS alone, from the accumulators this
 * file leaves behind.
 *
 * What keeps the two from being two readings of the record is that they share the rule and
 * differ only in where the starting point comes from: every entity fold is an
 * `AccumulatorFold` (`accumulate.ts`), and a rebuild starts each accumulator empty where an
 * advance starts it from the one stored. `advance.test.ts` drives one event of every kind of
 * the catalog through both and requires the same rows.
 */

import type { CatalogEvent } from '@mnema/chain';
import { dropProjections, ensureSchema, type ProjectionTable } from '../db/schema.js';
import type { SqliteDatabase } from '../db/sqlite.js';
import { type Accumulated, accumulate } from './accumulate.js';
import { projectChannelSwitches } from './channel.js';
import { materializeChannelSwitches } from './channel-store.js';
import { type DecisionAccumulator, decisionFold } from './decision.js';
import { materializeDecisions } from './decision-store.js';
import {
  projectHandoffs,
  projectKnowledge,
  edgesOf,
  projectLinkAssertions,
  projectObservations,
} from './knowledge.js';
import {
  materializeHandoffs,
  materializeLinkAssertions,
  materializeLinks,
  materializeMemories,
  materializeObservations,
} from './knowledge-store.js';
import { materializeReferences } from './reference-store.js';
import { runFold } from './run.js';
import { materializeRuns } from './run-store.js';
import { materializeSearch } from './search-store.js';
import { skillFold } from './skill.js';
import { materializeSkills } from './skill-store.js';
import {
  materializeDivergences,
  materializeFoldState,
  materializeMembership,
} from './state-store.js';
import { taskFold } from './task.js';
import { materializeTasks } from './task-store.js';

/** Every projection of one ordered stream, folded — and the accumulators the entity folds left. */
interface Folded {
  readonly events: readonly CatalogEvent[];
  readonly tasks: Accumulated<ReturnType<typeof taskFold.create>, ProjectionOf<typeof taskFold>>;
  readonly runs: Accumulated<ReturnType<typeof runFold.create>, ProjectionOf<typeof runFold>>;
  readonly decisions: Accumulated<DecisionAccumulator, ProjectionOf<typeof decisionFold>>;
  readonly skills: Accumulated<ReturnType<typeof skillFold.create>, ProjectionOf<typeof skillFold>>;
  readonly memories: ReturnType<typeof projectKnowledge>;
  readonly observations: ReturnType<typeof projectObservations>;
  readonly handoffs: ReturnType<typeof projectHandoffs>;
  readonly links: ReturnType<typeof edgesOf>;
  readonly linkAssertions: ReturnType<typeof projectLinkAssertions>;
  readonly switches: ReturnType<typeof projectChannelSwitches>;
}

/** What a fold projects to. */
type ProjectionOf<F> = F extends { finish(id: string, acc: never): infer P }
  ? Exclude<P, undefined>
  : never;

/**
 * Folds every projection from one ordered stream. THE fold block of a replay: every
 * projection folds the same ordered stream once, so they always agree on what the chain
 * says. It folds all of them even when only some will be written — a rebuild writes them all.
 */
function foldAll(events: readonly CatalogEvent[]): Folded {
  // The edges and who still asserts them are ONE fold, so the two tables cannot disagree.
  const linkAssertions = projectLinkAssertions(events);
  return {
    events,
    tasks: accumulate(taskFold, events),
    runs: accumulate(runFold, events),
    decisions: accumulate(decisionFold, events),
    skills: accumulate(skillFold, events),
    memories: projectKnowledge(events),
    observations: projectObservations(events),
    handoffs: projectHandoffs(events),
    links: edgesOf(linkAssertions),
    linkAssertions,
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
      materializeTasks(db, folded.tasks.projections.values());
      return;
    case 'runs':
      materializeRuns(db, folded.runs.projections.values());
      return;
    case 'decisions':
      materializeDecisions(db, folded.decisions.projections.values());
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
    case 'link_assertions':
      materializeLinkAssertions(db, folded.linkAssertions);
      return;
    case 'skills':
      materializeSkills(db, folded.skills.projections.values());
      return;
    case 'record_search':
      // The full-text index is filled from the projections just folded, not from a
      // second pass over the chain: one read, one fold, two views — so the index and
      // the tables cannot come to disagree about what the chain says.
      materializeSearch(db, {
        tasks: folded.tasks.projections.values(),
        decisions: folded.decisions.projections.values(),
        memories: folded.memories.values(),
        observations: folded.observations.values(),
        skills: folded.skills.projections.values(),
      });
      return;
    case 'search_rows':
      // Written by `materializeSearch`, row by row, as the rows it indexes are inserted.
      return;
    case 'channel_switches':
      materializeChannelSwitches(db, folded.switches.values());
      return;
    case 'fold_state':
      materializeFoldState(db, taskFold, folded.tasks.accumulators);
      materializeFoldState(db, runFold, folded.runs.accumulators);
      materializeFoldState(db, decisionFold, folded.decisions.accumulators);
      materializeFoldState(db, skillFold, folded.skills.accumulators);
      return;
    case 'membership_facts':
      materializeMembership(db, folded.events);
      return;
    case 'divergences':
      materializeDivergences(db, folded.events);
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
  'link_assertions',
  'skills',
  'record_search',
  'search_rows',
  'channel_switches',
  'fold_state',
  'membership_facts',
  'divergences',
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
