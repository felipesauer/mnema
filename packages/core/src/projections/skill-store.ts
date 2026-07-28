/**
 * Persisting and querying the skill projection in SQLite.
 *
 * The pure fold ({@link projectSkills}) produces skill state; this module writes
 * it into the `skills` table and reads it back. It is the simplest of the
 * workflow stores — a skill has no relational columns — mirroring the task store
 * with a `body` and a state index for the by-state queries the copilot leans on
 * (the `adopted` skills are the live patterns; `proposed`/`reviewed` are the
 * curation backlog).
 *
 * The three provenance columns bind as SQL NULL when absent, the same boundary
 * handling as the decision store's link columns — and `adopted_at` is what
 * carries the difference between "a person adopted it" (NULL `adopted_by`) and
 * "nobody has" (NULL on both) across the round trip.
 */

import type { SqliteDatabase } from '../db/sqlite.js';
import type { SkillProjection } from './skill.js';

/** The `skills` row shape as stored. */
interface SkillRow {
  readonly id: string;
  readonly name: string;
  readonly body: string;
  readonly state: string;
  readonly proposed_by: string | null;
  readonly adopted_at: string | null;
  readonly adopted_by: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

/** The bound-parameter shape: every column present, optionals as null. */
interface SkillParams {
  readonly id: string;
  readonly name: string;
  readonly body: string;
  readonly state: string;
  readonly proposedBy: string | null;
  readonly adoptedAt: string | null;
  readonly adoptedBy: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Inserts the given skill projections. Called during a rebuild after the table
 * has been recreated empty, so every skill is a fresh insert. The caller owns
 * the surrounding transaction.
 */
export function materializeSkills(db: SqliteDatabase, skills: Iterable<SkillProjection>): void {
  const insert = db.prepare(
    `INSERT INTO skills (id, name, body, state, proposed_by, adopted_at, adopted_by, created_at, updated_at)
     VALUES (@id, @name, @body, @state, @proposedBy, @adoptedAt, @adoptedBy, @createdAt, @updatedAt)`,
  );
  for (const skill of skills) {
    insert.run(toParams(skill));
  }
}

/** Reads one skill by id, or null if it is not projected. */
export function getSkill(db: SqliteDatabase, id: string): SkillProjection | null {
  const row = db.prepare('SELECT * FROM skills WHERE id = ?').get(id) as SkillRow | undefined;
  return row === undefined ? null : toProjection(row);
}

/** Lists all projected skills, ordered by id for a stable result. */
export function listSkills(db: SqliteDatabase): SkillProjection[] {
  const rows = db.prepare('SELECT * FROM skills ORDER BY id').all() as SkillRow[];
  return rows.map(toProjection);
}

/** Lists skills currently in the given state. */
export function listSkillsByState(db: SqliteDatabase, state: string): SkillProjection[] {
  const rows = db
    .prepare('SELECT * FROM skills WHERE state = ? ORDER BY id')
    .all(state) as SkillRow[];
  return rows.map(toProjection);
}

/** Binds a projection to parameters: fill every column, absent actors as null. */
function toParams(skill: SkillProjection): SkillParams {
  return {
    id: skill.id,
    name: skill.name,
    body: skill.body,
    state: skill.state,
    proposedBy: skill.proposedBy ?? null,
    adoptedAt: skill.adoption?.at ?? null,
    adoptedBy: skill.adoption?.by ?? null,
    createdAt: skill.createdAt,
    updatedAt: skill.updatedAt,
  };
}

function toProjection(row: SkillRow): SkillProjection {
  const projection: Mutable<SkillProjection> = {
    id: row.id,
    name: row.name,
    body: row.body,
    state: row.state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.proposed_by !== null) projection.proposedBy = row.proposed_by;
  // The instant reconstitutes the adoption; the agent joins it only when one
  // acted, so a person's adoption comes back as an adoption with no agent.
  if (row.adopted_at !== null) {
    projection.adoption =
      row.adopted_by === null ? { at: row.adopted_at } : { at: row.adopted_at, by: row.adopted_by };
  }
  return projection;
}

/** Local helper: build the readonly projection through a mutable shape. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
