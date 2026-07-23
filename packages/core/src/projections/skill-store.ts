/**
 * Persisting and querying the skill projection in SQLite.
 *
 * The pure fold ({@link projectSkills}) produces skill state; this module writes
 * it into the `skills` table and reads it back. It is the simplest of the
 * workflow stores — a skill has no relational columns — mirroring the task store
 * with a `body` and a state index for the by-state queries the copilot leans on
 * (the `adopted` skills are the live patterns; `proposed`/`reviewed` are the
 * curation backlog).
 */

import type { SqliteDatabase } from '../db/sqlite.js';
import type { SkillProjection } from './skill.js';

/** The `skills` row shape as stored. */
interface SkillRow {
  readonly id: string;
  readonly name: string;
  readonly body: string;
  readonly state: string;
  readonly created_at: string;
  readonly updated_at: string;
}

/**
 * Inserts the given skill projections. Called during a rebuild after the table
 * has been recreated empty, so every skill is a fresh insert. The caller owns
 * the surrounding transaction.
 */
export function materializeSkills(db: SqliteDatabase, skills: Iterable<SkillProjection>): void {
  const insert = db.prepare(
    `INSERT INTO skills (id, name, body, state, created_at, updated_at)
     VALUES (@id, @name, @body, @state, @createdAt, @updatedAt)`,
  );
  for (const skill of skills) {
    insert.run(skill);
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

function toProjection(row: SkillRow): SkillProjection {
  return {
    id: row.id,
    name: row.name,
    body: row.body,
    state: row.state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
