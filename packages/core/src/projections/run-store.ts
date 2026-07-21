/**
 * Persisting and querying the run projection in SQLite.
 *
 * The pure fold ({@link projectRuns}) produces run state; this module writes it
 * to the `runs` table and reads it back. Two shape mismatches are handled at
 * this boundary: the projection's optional fields (goal, outcome, endedAt) are
 * bound as SQL NULL when absent, and the `open` boolean is stored as 0/1
 * because a STRICT table has no boolean type.
 */

import type { SqliteDatabase } from '../db/sqlite.js';
import type { RunProjection } from './run.js';

/** The `runs` row shape as stored. */
interface RunRow {
  readonly id: string;
  readonly agent: string;
  readonly who: string;
  readonly goal: string | null;
  readonly outcome: string | null;
  readonly open: number;
  readonly started_at: string;
  readonly ended_at: string | null;
}

/** The bound-parameter shape: every column present, optionals as null. */
interface RunParams {
  readonly id: string;
  readonly agent: string;
  readonly who: string;
  readonly goal: string | null;
  readonly outcome: string | null;
  readonly open: number;
  readonly startedAt: string;
  readonly endedAt: string | null;
}

/**
 * Inserts the given run projections. Called during a rebuild after the table
 * has been recreated empty, so every run is a fresh insert. The caller owns the
 * surrounding transaction.
 */
export function materializeRuns(db: SqliteDatabase, runs: Iterable<RunProjection>): void {
  const insert = db.prepare(
    `INSERT INTO runs (id, agent, who, goal, outcome, open, started_at, ended_at)
     VALUES (@id, @agent, @who, @goal, @outcome, @open, @startedAt, @endedAt)`,
  );
  for (const run of runs) {
    insert.run(toParams(run));
  }
}

/** Reads one run by id, or null if it is not projected. */
export function getRun(db: SqliteDatabase, id: string): RunProjection | null {
  const row = db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as RunRow | undefined;
  return row === undefined ? null : toProjection(row);
}

/** Lists all projected runs, ordered by id for a stable result. */
export function listRuns(db: SqliteDatabase): RunProjection[] {
  const rows = db.prepare('SELECT * FROM runs ORDER BY id').all() as RunRow[];
  return rows.map(toProjection);
}

/** Lists the currently open runs (no `run.ended` yet). */
export function listOpenRuns(db: SqliteDatabase): RunProjection[] {
  const rows = db.prepare('SELECT * FROM runs WHERE open = 1 ORDER BY id').all() as RunRow[];
  return rows.map(toProjection);
}

/** Binds a projection to parameters: fill every column, optionals as null. */
function toParams(run: RunProjection): RunParams {
  return {
    id: run.id,
    agent: run.agent,
    who: run.who,
    goal: run.goal ?? null,
    outcome: run.outcome ?? null,
    open: run.open ? 1 : 0,
    startedAt: run.startedAt,
    endedAt: run.endedAt ?? null,
  };
}

function toProjection(row: RunRow): RunProjection {
  const projection: Mutable<RunProjection> = {
    id: row.id,
    agent: row.agent,
    who: row.who,
    open: row.open === 1,
    startedAt: row.started_at,
  };
  if (row.goal !== null) projection.goal = row.goal;
  if (row.outcome !== null) projection.outcome = row.outcome;
  if (row.ended_at !== null) projection.endedAt = row.ended_at;
  return projection;
}

/** Local helper: build the readonly projection through a mutable shape. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
