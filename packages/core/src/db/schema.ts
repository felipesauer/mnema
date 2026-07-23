/**
 * The projection cache schema — one flat baseline, never a chain of migrations.
 *
 * Because the cache is derived from the chain and thrown away when its shape
 * changes, the schema is an implementation detail, not a durable contract.
 * There is no version table and no upgrade path: the tables are created if
 * absent, and a shape change is a drop-and-replay, not a migration. Adding a
 * column means editing the CREATE below and rebuilding.
 *
 * Every table here is a PROJECTION of events. It holds current state for fast
 * relational queries; the events remain the source of truth in the chain.
 */

import type { SqliteDatabase } from './sqlite.js';

/**
 * The projection tables, in the order they are created and the reverse order
 * they are dropped. Listing them here is what lets a rebuild wipe the cache
 * without dropping anything the chain did not put there.
 */
export const PROJECTION_TABLES = [
  'tasks',
  'runs',
  'decisions',
  'memories',
  'observations',
  'handoffs',
  'links',
  'skills',
] as const;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tasks (
  -- The task's id (the event subject). One row per task.
  id         TEXT PRIMARY KEY NOT NULL,
  -- The title from task.created.
  title      TEXT NOT NULL,
  -- Current state: the 'to' of the task's last transition.
  state      TEXT NOT NULL,
  -- 'at' of the birth (task.created), and of the last transition.
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_tasks_state ON tasks (state);

CREATE TABLE IF NOT EXISTS runs (
  -- The run's id (the event subject). One row per run.
  id         TEXT PRIMARY KEY NOT NULL,
  -- The agent the run is for (the 'which' of its actions).
  agent      TEXT NOT NULL,
  -- The human who authorized the session (the root of authority).
  who        TEXT NOT NULL,
  -- The stated goal, if any (from run.started).
  goal       TEXT,
  -- The outcome note, if any (from run.ended).
  outcome    TEXT,
  -- 1 while the run has no run.ended, else 0 (STRICT has no boolean type).
  open       INTEGER NOT NULL,
  -- 'at' of run.started, and of run.ended when it has ended.
  started_at TEXT NOT NULL,
  ended_at   TEXT
) STRICT;

CREATE INDEX IF NOT EXISTS idx_runs_open ON runs (open);

CREATE TABLE IF NOT EXISTS decisions (
  -- The decision's id (the event subject). One row per decision.
  id            TEXT PRIMARY KEY NOT NULL,
  -- The citable 'ADR-<n>' label, frozen at write time. NOT identity; a
  -- collision across offline clones is a label clash, reported not enforced.
  adr           TEXT NOT NULL,
  title         TEXT NOT NULL,
  -- The why — the whole value of the record.
  rationale     TEXT NOT NULL,
  -- Current state: the 'to' of the decision's last transition.
  state         TEXT NOT NULL,
  -- The successor's id when this decision was superseded, else NULL.
  superseded_by TEXT,
  -- The id this decision superseded when it is a successor, else NULL.
  supersedes    TEXT,
  -- 'at' of decision.recorded, and of the last transition.
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_decisions_state ON decisions (state);
-- The adr label is not unique (a collision is possible and reported), so this
-- index speeds the collision scan and by-label lookups, not a uniqueness guard.
CREATE INDEX IF NOT EXISTS idx_decisions_adr ON decisions (adr);

CREATE TABLE IF NOT EXISTS memories (
  -- The memory's id (the event subject). One row per captured memory.
  id          TEXT PRIMARY KEY NOT NULL,
  -- The captured content, straight from memory.captured.
  content     TEXT NOT NULL,
  -- The anchor that captured it (the authorizing 'who').
  who         TEXT NOT NULL,
  -- 'at' of the capture. A memory has no state and no updated_at: it is a single
  -- immutable point-in-time fact, never moved.
  captured_at TEXT NOT NULL
) STRICT;

CREATE INDEX IF NOT EXISTS idx_memories_who ON memories (who);

CREATE TABLE IF NOT EXISTS observations (
  -- The observation's OWN id (the event subject). One row per observation.
  id          TEXT PRIMARY KEY NOT NULL,
  -- The id of the entity observed (a task, decision, …), resolved on read.
  about       TEXT NOT NULL,
  -- A short topic label for the observation.
  topic       TEXT NOT NULL,
  -- The observation text.
  text        TEXT NOT NULL,
  -- The anchor that recorded it (the authorizing 'who').
  who         TEXT NOT NULL,
  -- 'at' of the observation. Like a memory, an observation has no state and no
  -- updated_at: it is one immutable point-in-time fact.
  recorded_at TEXT NOT NULL
) STRICT;

-- Speeds "the observations about entity X" — the natural query on an observation.
CREATE INDEX IF NOT EXISTS idx_observations_about ON observations (about);

CREATE TABLE IF NOT EXISTS handoffs (
  -- The task the handoff is about (the event subject). NOT a primary key: a task
  -- may have many handoffs, so the row is a list entry, not one-per-task.
  task        TEXT NOT NULL,
  -- The agent handing off.
  from_agent  TEXT NOT NULL,
  -- The agent taking over (may equal from_agent: a chat restart).
  to_agent    TEXT NOT NULL,
  -- The anchor that recorded it (the authorizing 'who').
  who         TEXT NOT NULL,
  -- 'at' of the handoff.
  recorded_at TEXT NOT NULL
) STRICT;

-- Speeds "the handoffs on task X" and keeps the list ordered by time.
CREATE INDEX IF NOT EXISTS idx_handoffs_task ON handoffs (task, recorded_at);

CREATE TABLE IF NOT EXISTS links (
  -- The entity that originates the link (the event subject).
  subject   TEXT NOT NULL,
  -- The entity linked to. Only an id; its kind is resolved on read.
  target    TEXT NOT NULL,
  -- The relation label — an open literal string.
  rel       TEXT NOT NULL,
  -- The anchor that recorded it (the authorizing 'who').
  who       TEXT NOT NULL,
  -- 'at' of the link.
  linked_at TEXT NOT NULL,
  -- The edge is idempotent: one row per (subject, target, rel). A repeated
  -- assertion (e.g. two offline clones) collapses to one, so the union never
  -- double-counts the same relation.
  PRIMARY KEY (subject, target, rel)
) STRICT;

-- Both directions of the N:N relation are answerable: the primary key indexes
-- the subject side; this index indexes the target side, so "what links into X"
-- is as fast as "what links out of X" — the bidirectional reachability the
-- supersede's two columns give, generalized to an edge set.
CREATE INDEX IF NOT EXISTS idx_links_target ON links (target);

CREATE TABLE IF NOT EXISTS skills (
  -- The skill's id (the event subject). One row per skill.
  id         TEXT PRIMARY KEY NOT NULL,
  -- The short title of the pattern, from skill.created.
  name       TEXT NOT NULL,
  -- The reusable pattern itself, from skill.created.
  body       TEXT NOT NULL,
  -- Current state: the 'to' of the skill's last transition. A skill is not
  -- relational (no supersede columns) — replacement between skills is a link.
  state      TEXT NOT NULL,
  -- 'at' of skill.created, and of the last transition.
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

-- Speeds the by-state queries: the 'adopted' skills are the live patterns the
-- copilot surfaces; 'proposed'/'reviewed' are the curation backlog.
CREATE INDEX IF NOT EXISTS idx_skills_state ON skills (state);
`;

/** Creates the projection tables if they are absent. Idempotent. */
export function ensureSchema(db: SqliteDatabase): void {
  db.exec(SCHEMA);
}

/**
 * Drops every projection table. The counterpart to {@link ensureSchema}: a
 * rebuild drops, recreates, and replays. Dropping only the listed tables keeps
 * the operation scoped to the cache's own projections.
 */
export function dropProjections(db: SqliteDatabase): void {
  for (let i = PROJECTION_TABLES.length - 1; i >= 0; i -= 1) {
    db.exec(`DROP TABLE IF EXISTS ${PROJECTION_TABLES[i]};`);
  }
}
