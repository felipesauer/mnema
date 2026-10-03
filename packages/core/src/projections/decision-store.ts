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
import { proofColumn, proofFromColumn } from './proof.js';
import { verb } from './upsert.js';

/** The `decisions` row shape as stored. */
interface DecisionRow {
  readonly id: string;
  readonly adr: string;
  readonly title: string;
  readonly rationale: string;
  readonly alternatives: string | null;
  readonly state: string;
  readonly superseded_by: string | null;
  readonly supersedes: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  /** What each move said, JSON-encoded — null when no move said anything. */
  readonly proof: string | null;
  readonly recorded_who: string | null;
  readonly recorded_which: string | null;
  readonly accepted_who: string | null;
  readonly accepted_which: string | null;
}

/** The bound-parameter shape: every column present, optionals as null. */
interface DecisionParams {
  readonly id: string;
  readonly adr: string;
  readonly title: string;
  readonly rationale: string;
  readonly alternatives: string | null;
  readonly state: string;
  readonly supersededBy: string | null;
  readonly supersedes: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly proof: string | null;
  readonly recordedWho: string | null;
  readonly recordedWhich: string | null;
  readonly acceptedWho: string | null;
  readonly acceptedWhich: string | null;
}

/**
 * Inserts the given decision projections. Called during a rebuild after the
 * table has been recreated empty, so every decision is a fresh insert. The
 * caller owns the surrounding transaction.
 *
 * `replacing` is for the one caller that does NOT start from an empty table: an advance
 * writes the rows an arrival changed over the rows that were there, and a row that is already
 * there is then the thing being replaced. A rebuild passes nothing, and keeps the failure that
 * says its table was not emptied.
 */
export function materializeDecisions(
  db: SqliteDatabase,
  decisions: Iterable<DecisionProjection>,
  replacing = false,
): void {
  const insert = db.prepare(
    `${verb(replacing)} INTO decisions (id, adr, title, rationale, alternatives, state, superseded_by, supersedes, created_at, updated_at, proof, recorded_who, recorded_which, accepted_who, accepted_which)
     VALUES (@id, @adr, @title, @rationale, @alternatives, @state, @supersededBy, @supersedes, @createdAt, @updatedAt, @proof, @recordedWho, @recordedWhich, @acceptedWho, @acceptedWhich)`,
  );
  for (const decision of decisions) {
    insert.run(toParams(decision));
  }
}

/** How many decisions are projected — the count the next `ADR-<n>` is numbered from. */
export function countDecisions(db: SqliteDatabase): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM decisions').get() as { n: number }).n;
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
    alternatives: decision.alternatives ?? null,
    state: decision.state,
    supersededBy: decision.supersededBy ?? null,
    supersedes: decision.supersedes ?? null,
    createdAt: decision.createdAt,
    updatedAt: decision.updatedAt,
    proof: proofColumn(decision.proof),
    recordedWho: decision.recordedBy?.who ?? null,
    recordedWhich: decision.recordedBy?.which ?? null,
    acceptedWho: decision.acceptedBy?.who ?? null,
    acceptedWhich: decision.acceptedBy?.which ?? null,
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
  // NULL in the column means the decision recorded none, so the projection gets
  // no key — the round trip preserves absence rather than turning it into ''.
  if (row.alternatives !== null) projection.alternatives = row.alternatives;
  if (row.superseded_by !== null) projection.supersededBy = row.superseded_by;
  if (row.supersedes !== null) projection.supersedes = row.supersedes;
  const said = proofFromColumn(row.proof);
  if (said.proof !== undefined) projection.proof = said.proof;
  if (row.recorded_who !== null) {
    projection.recordedBy = {
      who: row.recorded_who,
      ...(row.recorded_which !== null ? { which: row.recorded_which } : {}),
    };
  }
  if (row.accepted_who !== null) {
    projection.acceptedBy = {
      who: row.accepted_who,
      ...(row.accepted_which !== null ? { which: row.accepted_which } : {}),
    };
  }
  return projection;
}

/** Local helper: build the readonly projection through a mutable shape. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
