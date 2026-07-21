/**
 * Persisting and querying the decision projection in SQLite.
 *
 * The pure fold ({@link projectDecisions}) produces decision state; this module
 * writes it to the `decisions` table and reads it back. The optional link
 * columns (supersededBy, supersedes) bind as SQL NULL when absent, the same
 * boundary handling as the run store.
 */

import type { SqliteDatabase } from '../db/sqlite.js';
import type { DecisionProjection } from './decision.js';

/** The `decisions` row shape as stored. */
interface DecisionRow {
  readonly id: string;
  readonly adr: string;
  readonly title: string;
  readonly rationale: string;
  readonly state: string;
  readonly superseded_by: string | null;
  readonly supersedes: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

/** The bound-parameter shape: every column present, optionals as null. */
interface DecisionParams {
  readonly id: string;
  readonly adr: string;
  readonly title: string;
  readonly rationale: string;
  readonly state: string;
  readonly supersededBy: string | null;
  readonly supersedes: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Inserts the given decision projections. Called during a rebuild after the
 * table has been recreated empty, so every decision is a fresh insert. The
 * caller owns the surrounding transaction.
 */
export function materializeDecisions(
  db: SqliteDatabase,
  decisions: Iterable<DecisionProjection>,
): void {
  const insert = db.prepare(
    `INSERT INTO decisions (id, adr, title, rationale, state, superseded_by, supersedes, created_at, updated_at)
     VALUES (@id, @adr, @title, @rationale, @state, @supersededBy, @supersedes, @createdAt, @updatedAt)`,
  );
  for (const decision of decisions) {
    insert.run(toParams(decision));
  }
}

/** Reads one decision by id, or null if it is not projected. */
export function getDecision(db: SqliteDatabase, id: string): DecisionProjection | null {
  const row = db.prepare('SELECT * FROM decisions WHERE id = ?').get(id) as DecisionRow | undefined;
  return row === undefined ? null : toProjection(row);
}

/** Lists all projected decisions, ordered by id for a stable result. */
export function listDecisions(db: SqliteDatabase): DecisionProjection[] {
  const rows = db.prepare('SELECT * FROM decisions ORDER BY id').all() as DecisionRow[];
  return rows.map(toProjection);
}

/** Lists decisions currently in the given state. */
export function listDecisionsByState(db: SqliteDatabase, state: string): DecisionProjection[] {
  const rows = db
    .prepare('SELECT * FROM decisions WHERE state = ? ORDER BY id')
    .all(state) as DecisionRow[];
  return rows.map(toProjection);
}

/** Binds a projection to parameters: fill every column, optional links as null. */
function toParams(decision: DecisionProjection): DecisionParams {
  return {
    id: decision.id,
    adr: decision.adr,
    title: decision.title,
    rationale: decision.rationale,
    state: decision.state,
    supersededBy: decision.supersededBy ?? null,
    supersedes: decision.supersedes ?? null,
    createdAt: decision.createdAt,
    updatedAt: decision.updatedAt,
  };
}

function toProjection(row: DecisionRow): DecisionProjection {
  const projection: Mutable<DecisionProjection> = {
    id: row.id,
    adr: row.adr,
    title: row.title,
    rationale: row.rationale,
    state: row.state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.superseded_by !== null) projection.supersededBy = row.superseded_by;
  if (row.supersedes !== null) projection.supersedes = row.supersedes;
  return projection;
}

/** Local helper: build the readonly projection through a mutable shape. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
