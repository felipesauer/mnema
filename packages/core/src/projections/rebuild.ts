/**
 * Rebuild: drop the projection cache and replay it from the chain.
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
 */

import type { ChainLayout, UpcasterRegistry } from '@mnema/chain';
import { dropProjections, ensureSchema } from '../db/schema.js';
import type { SqliteDatabase } from '../db/sqlite.js';
import { projectDecisions } from './decision.js';
import { materializeDecisions } from './decision-store.js';
import { projectKnowledge } from './knowledge.js';
import { materializeMemories } from './knowledge-store.js';
import { orderedEvents } from './order.js';
import { projectRuns } from './run.js';
import { materializeRuns } from './run-store.js';
import { projectTasks } from './task.js';
import { materializeTasks } from './task-store.js';

/** Drops and replays every projection from the chain, transactionally. */
export function rebuild(
  db: SqliteDatabase,
  layout: ChainLayout,
  upcasters: UpcasterRegistry,
): void {
  // Read and fold outside the transaction: a chain that fails to read leaves
  // the existing cache untouched. Every projection folds the same ordered
  // stream once, so they always agree on what the chain says.
  const events = orderedEvents(layout, upcasters);
  const tasks = projectTasks(events);
  const runs = projectRuns(events);
  const decisions = projectDecisions(events);
  const memories = projectKnowledge(events);

  const replace = db.transaction(() => {
    dropProjections(db);
    ensureSchema(db);
    materializeTasks(db, tasks.values());
    materializeRuns(db, runs.values());
    materializeDecisions(db, decisions.values());
    materializeMemories(db, memories.values());
  });
  replace();
}
