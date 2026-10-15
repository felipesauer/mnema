/**
 * Advance: bring a cache forward over events that were APPENDED to the order it was built
 * from, doing the work the arrivals made necessary and nothing that grows with the record.
 *
 * `rebuild.ts` replays the whole order into empty tables; this takes the cache as it stands
 * and the events that came after, and leaves it where a replay of the whole order would have
 * put it (`advance.test.ts` asserts exactly that, one event of every kind of the catalog at a
 * time, over every table). It does so by folding the ARRIVALS alone:
 *
 *   - an entity fold (a task, a run, a decision, a skill) starts each accumulator from the one
 *     the cache stored for that entity and steps it over the arrivals that name it, writes the
 *     accumulator back, and writes the entity's row if it is complete. The entities an arrival
 *     does not name are not read — which is the property: the work is the arrivals' and the
 *     entities they touch, and a record ten times larger costs the same;
 *   - the folds that keep no accumulator (a memory, an observation, a handoff, a link, a
 *     switch) are one event each, and the rule of each is the function the replay applies
 *     (`memoryOf`, `linkOf`, …), and a link retraction is folded by the rule the replay
 *     applies (`withdraws`);
 *   - the full-text index replaces the rows of the entities that changed, by rowid;
 *   - the reference index appends, as it always did; the facts about identity append;
 *   - the moves that diverged are read again for the entities an arrival moved, from the
 *     reference index just written.
 *
 * Which of these an arrival needs is `fed-by.ts`'s question, and it is asked once, of the
 * kinds that arrived: a table no arrival feeds is not opened.
 *
 * A MOVE IS JUDGED HERE AGAINST THE STATE THE CACHE HOLDS (FORMAT.md §6.7), because the
 * arrivals alone are not the history a move is judged against. The judgment a replay makes
 * needs, for a move the state at that point does not admit, the moves its writer saw — where
 * its tail's citations reach — and this file holds no tail or citation. So an arrival is
 * advanced over only when every move among the arrivals is admitted by the state the stored
 * accumulators give: born, a row of the table, from the state the subject is in. Anything else
 * — a divergence, a move the workflow does not allow — is rare, and {@link advance} answers
 * false without writing, so the cache reads the record again and the replay judges it. That is
 * also what keeps the divergences this file indexes again the replay's: a move the state admits
 * leaves a subject's divergences as they were.
 *
 * WHAT THE CALLER OWES, and none of it is checkable here: that `arrived` really is what
 * follows the order the cache was built from, at position `from` — the count of events the
 * cache covered. `chainArrivals` is what establishes it, and its refusals are the cases where
 * this must not be used. A wrong `from` writes a reference index pointing at the wrong
 * events, quietly (`reference-store.ts`).
 */

import {
  type CatalogEvent,
  isMove,
  judgeMove,
  RUN_ENDED,
  RUN_OPEN,
  stateAfter,
} from '@mnema/chain';
import type { ProjectionTable } from '../db/schema.js';
import { inTransaction, type SqliteDatabase } from '../db/sqlite.js';
import type { AccumulatorFold } from './accumulate.js';
import { switchOf } from './channel.js';
import { materializeChannelSwitches } from './channel-store.js';
import { decisionFold } from './decision.js';
import { materializeDecisions } from './decision-store.js';
import { tablesFedBy } from './fed-by.js';
import {
  handoffOf,
  memoryOf,
  type NoteRetraction,
  observationOf,
  retractionOf,
  retractionsOf,
} from './knowledge.js';
import {
  advanceLinks,
  getMemory,
  getObservation,
  materializeHandoffs,
  materializeMemories,
  materializeObservations,
} from './knowledge-store.js';
import { materializeReferences } from './reference-store.js';
import { runFold } from './run.js';
import { materializeRuns } from './run-store.js';
import { reindexSearch, type SearchKind } from './search-store.js';
import { skillFold } from './skill.js';
import { materializeSkills } from './skill-store.js';
import { materializeMembership, reindexDivergences } from './state-store.js';
import { taskFold } from './task.js';
import { materializeTasks } from './task-store.js';

/** What an entity fold brought forward: the entities the arrivals touched that are complete. */
type Advanced<P> = readonly P[];

/**
 * Steps one entity fold over the arrivals, from the accumulators the cache stored, and
 * writes both the accumulators and the rows of the entities it touched.
 */
function advanceFold<A, P>(
  db: SqliteDatabase,
  fold: AccumulatorFold<A, P>,
  arrived: readonly CatalogEvent[],
  write: (db: SqliteDatabase, projections: Iterable<P>, replacing: boolean) => void,
): Advanced<P> {
  const select = db.prepare('SELECT acc FROM fold_state WHERE fold = ? AND key = ?');
  const loaded = new Map<string, A>();
  const of = (id: string): A => {
    let acc = loaded.get(id);
    if (acc === undefined) {
      const stored = select.get(fold.name, id) as { acc: string } | undefined;
      acc = stored === undefined ? fold.create() : fold.decode(stored.acc);
      loaded.set(id, acc);
    }
    return acc;
  };
  for (const event of arrived) fold.step(of, event);

  const put = db.prepare('INSERT OR REPLACE INTO fold_state (fold, key, acc) VALUES (?, ?, ?)');
  const projections: P[] = [];
  for (const [id, acc] of loaded) {
    put.run(fold.name, id, fold.encode(acc));
    const projected = fold.finish(id, acc);
    if (projected !== undefined) projections.push(projected);
  }
  // Over rows that are there already, which is what the arrival changed.
  write(db, projections, true);
  return projections;
}

/** A fold with no accumulator: the last row an arrival wrote for each id, in arrival order. */
function lastOf<P>(
  arrived: readonly CatalogEvent[],
  rowOf: (event: CatalogEvent) => P | undefined,
  idOf: (row: P) => string,
): P[] {
  const last = new Map<string, P>();
  for (const event of arrived) {
    const row = rowOf(event);
    if (row !== undefined) last.set(idOf(row), row);
  }
  return [...last.values()];
}

/**
 * The notes an arrival changed: the ones it brought, and the ones it took back, each with the
 * retraction the replay gives it. A note a retraction names but that is neither in the batch
 * nor a row of the other note table is not this table's, and is left alone.
 */
function withRetractions<
  P extends { readonly id: string; readonly who: string; readonly retracted?: NoteRetraction },
>(
  brought: readonly P[],
  retractions: ReadonlyMap<string, readonly NoteRetraction[]>,
  stored: (id: string) => P | null,
): P[] {
  const result = new Map(brought.map((note) => [note.id, note]));
  for (const [id, named] of retractions) {
    const note = result.get(id) ?? stored(id);
    if (note === null || note === undefined || note.retracted !== undefined) continue;
    const retracted = retractionOf(note, named);
    if (retracted === undefined) continue;
    result.set(id, { ...note, retracted });
  }
  return [...result.values()];
}

const TRANSITIONS = ['task.transitioned', 'decision.transitioned', 'skill.transitioned'] as const;

/** Where each move kind's subject keeps its state in the cache, and how to read it there. */
const STATE_OF = {
  decision: { fold: decisionFold.name, now: (acc: string) => decisionFold.decode(acc).state },
  task: { fold: taskFold.name, now: (acc: string) => taskFold.decode(acc).state },
  skill: { fold: skillFold.name, now: (acc: string) => skillFold.decode(acc).state },
  run: {
    fold: runFold.name,
    now: (acc: string): string | undefined => {
      const run = runFold.decode(acc);
      if (run.startedAt === undefined) return undefined;
      return run.endedAt === undefined ? RUN_OPEN : RUN_ENDED;
    },
  },
} as const;

/** The workflow a move kind, or a run's start, keeps its subject's state in. */
function familyOf(kind: CatalogEvent['kind']): keyof typeof STATE_OF | undefined {
  if (kind === 'run.started' || kind === 'run.ended') return 'run';
  if (kind === 'decision.transitioned') return 'decision';
  if (kind === 'task.transitioned') return 'task';
  if (kind === 'skill.transitioned') return 'skill';
  return undefined;
}

/** What {@link admitted} throws when a move asks what its writer saw: this file cannot say. */
const ASKS_WHAT_WAS_SEEN = Symbol('asks what its writer saw');

/**
 * Whether every move among `arrived` is admitted by the state the cache holds, stepped forward
 * over the arrivals before it — the replay's judgment wherever this one can answer (see the
 * module comment). A successor is born when the cache holds its state or an arrival is its birth,
 * which is exactly "the record holds its birth", the cache covering everything before.
 */
function admitted(db: SqliteDatabase, arrived: readonly CatalogEvent[]): boolean {
  const select = db.prepare('SELECT acc FROM fold_state WHERE fold = ? AND key = ?');
  const now = new Map<string, string | undefined>();
  const stateOf = (family: keyof typeof STATE_OF, id: string): string | undefined => {
    const key = `${family} ${id}`;
    if (!now.has(key)) {
      const stored = select.get(STATE_OF[family].fold, id) as { acc: string } | undefined;
      now.set(key, stored === undefined ? undefined : STATE_OF[family].now(stored.acc));
    }
    return now.get(key);
  };
  const births = new Set<string>();
  for (const event of arrived) {
    if (event.kind === 'decision.transitioned' && event.payload.from === null) {
      births.add(event.subject);
    }
  }
  try {
    for (const event of arrived) {
      const family = familyOf(event.kind);
      if (family === undefined) continue;
      const key = `${family} ${event.subject}`;
      if (event.kind === 'run.started') {
        if (stateOf(family, event.subject) === undefined) now.set(key, RUN_OPEN);
        continue;
      }
      if (!isMove(event)) continue;
      const ruling = judgeMove(event, {
        now: stateOf(family, event.subject),
        seen: () => {
          throw ASKS_WHAT_WAS_SEEN;
        },
        born: (id) => births.has(id) || stateOf('decision', id) !== undefined,
      });
      if (ruling !== undefined) return false;
      now.set(key, stateAfter(event));
    }
  } catch (thrown) {
    if (thrown === ASKS_WHAT_WAS_SEEN) return false;
    throw thrown;
  }
  return true;
}

/**
 * Brings a cache forward over `arrived`, the events that now follow the `from` it covered.
 * One transaction, like a rebuild: a failure rolls back to the cache as it stood.
 *
 * Returns false, having written nothing, when a move among the arrivals is one the state the
 * cache holds cannot judge alone ({@link admitted}): the caller reads the record again.
 *
 * `fed` is what the arrivals feed, and it is worked out from their kinds. It is a parameter
 * so that a test can hand over ONE kind's row alone and prove that row is sufficient
 * (`advance.test.ts`); no production caller passes it.
 */
export function advance(
  db: SqliteDatabase,
  arrived: readonly CatalogEvent[],
  from: number,
  fed: ReadonlySet<ProjectionTable> = tablesFedBy(arrived.map((event) => event.kind)),
): boolean {
  return inTransaction(db, () => {
    // The one thing about `from` that can be checked here, and it is the direction that
    // corrupts: a position the reference index already covers would be indexed twice, under
    // events that are not the ones it holds. A `from` that is too LARGE leaves a gap nothing
    // here can see, and is `chainArrivals`' to prevent.
    if (db.prepare('SELECT 1 FROM refs WHERE ord >= ? LIMIT 1').get(from) !== undefined) {
      throw new RangeError('advance was given arrivals at a position the cache already covers');
    }
    if (!admitted(db, arrived)) return false;
    // The reference index first: the moves that diverged are read back from it.
    if (fed.has('refs')) materializeReferences(db, arrived, from);

    const tasks = fed.has('tasks') ? advanceFold(db, taskFold, arrived, materializeTasks) : [];
    if (fed.has('runs')) advanceFold(db, runFold, arrived, materializeRuns);
    const decisions = fed.has('decisions')
      ? advanceFold(db, decisionFold, arrived, materializeDecisions)
      : [];
    const skills = fed.has('skills') ? advanceFold(db, skillFold, arrived, materializeSkills) : [];

    // A retraction changes a note that may already be a row, or that arrived in this very
    // batch: either way the note is projected again with the retraction the replay would
    // have given it, and written over the row it was.
    const retractions = retractionsOf(arrived);
    const memories = fed.has('memories')
      ? withRetractions(
          lastOf(arrived, memoryOf, (memory) => memory.id),
          retractions,
          (id) => getMemory(db, id),
        )
      : [];
    materializeMemories(db, memories, true);
    const observations = fed.has('observations')
      ? withRetractions(
          lastOf(arrived, observationOf, (observation) => observation.id),
          retractions,
          (id) => getObservation(db, id),
        )
      : [];
    materializeObservations(db, observations, true);

    // A handoff has no id and every one is a row, in the order it arrived.
    if (fed.has('handoffs')) {
      materializeHandoffs(db, [arrived.flatMap((event) => handoffOf(event) ?? [])]);
    }
    // A repeated edge keeps its FIRST assertion standing; a retraction withdraws its own
    // identity's, one event at a time and in order, as the replay does.
    if (fed.has('links')) advanceLinks(db, arrived);
    if (fed.has('channel_switches')) {
      materializeChannelSwitches(
        db,
        lastOf(arrived, switchOf, (state) => state.channel),
        true,
      );
    }

    if (fed.has('record_search')) {
      const touched: { kind: SearchKind; id: string }[] = [
        ...tasks.map((task) => ({ kind: 'task' as const, id: task.id })),
        ...decisions.map((decision) => ({ kind: 'decision' as const, id: decision.id })),
        ...skills.map((skill) => ({ kind: 'skill' as const, id: skill.id })),
        ...memories.map((memory) => ({ kind: 'memory' as const, id: memory.id })),
        ...observations.map((observation) => ({
          kind: 'observation' as const,
          id: observation.id,
        })),
      ];
      reindexSearch(db, touched, { tasks, decisions, memories, observations, skills });
    }

    if (fed.has('membership_facts')) materializeMembership(db, arrived, from);
    if (fed.has('divergences')) {
      const moved = new Set<string>();
      for (const event of arrived) {
        if ((TRANSITIONS as readonly string[]).includes(event.kind)) moved.add(event.subject);
      }
      reindexDivergences(db, moved);
    }
    return true;
  });
}
