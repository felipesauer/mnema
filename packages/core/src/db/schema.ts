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
  // The full-text index. A virtual table, but a projection like any other:
  // dropping it drops the shadow tables FTS5 keeps behind it, so the rebuild
  // wipes the index with the same one line it wipes a relational table.
  'record_search',
  // The reference index: one row per (event, entity, role).
  'refs',
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
  ended_at   TEXT,
  -- 'at' of the most recent event PINNED to this run; NULL when it has none.
  last_fact_at TEXT
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
  -- What was considered and turned down, and why not. NULL when the decision
  -- recorded none: the absence is the fact, so it is never the empty string.
  alternatives  TEXT,
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
  -- What the link points at: an id of another record, or a path in the working
  -- tree under the 'governs' relation. This line said "only an id", and that
  -- relation falsified it. Whatever it is, it is stored as the caller wrote it
  -- and what it names is resolved on read.
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
  -- PROVENANCE: the two acts that put a pattern in front of an agent. A skill's
  -- body is served as instruction, so who proposed it and who adopted it is what
  -- makes that serving visible; for a task or decision the consumer can already
  -- read both from the events themselves.
  --
  -- The agent that proposed it (skill.created's 'which'), or NULL when a person
  -- recorded it directly. NULL is a fact here, never an unknown.
  proposed_by TEXT,
  -- 'at' of the transition into 'adopted', or NULL while it never was adopted.
  -- This column is the PRESENCE marker of the adoption: adopted_by alone could
  -- not tell a pattern a person adopted from one nobody has adopted.
  adopted_at  TEXT,
  -- The agent that adopted it, or NULL when a person did (or when adopted_at is
  -- NULL and there is no adoption to attribute).
  adopted_by  TEXT,
  -- 'at' of skill.created, and of the last transition.
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

-- Speeds the by-state queries: the 'adopted' skills are the live patterns the
-- copilot surfaces; 'proposed'/'reviewed' are the curation backlog.
CREATE INDEX IF NOT EXISTS idx_skills_state ON skills (state);

-- The full-text index over the record: ONE row per searchable entity, holding
-- only the text a PERSON wrote.
--
-- Two columns are indexed and four are not, and that split is the whole design.
-- Indexed: the entity's own title and the prose under it — the words someone
-- chose. NOT indexed: kind, state, the instant, the id. Those are STRUCTURE, and
-- structure is a filter, never a search term: matching an anchor id or a state
-- name as if it were prose would bury the words a person actually looked for,
-- and every structural question already has a reader that answers it exactly
-- (accountability by author, timeline by entity, the by-state lists).
-- An UNINDEXED column is still stored and still selectable, so a filter reads it
-- straight off the row.
--
-- The title is weighted above the body at query time: a term in the name of a
-- thing identifies it, the same term buried in a paragraph only mentions it.
--
-- The tokenizer folds case AND diacritics, so "memoria" finds "memória" — the
-- record is written in whatever language the team works in, and an accent is not
-- a distinction a searcher means to make. No stemmer: it would be one language's
-- rules applied to all of them, and a prefix query covers the common case
-- ("invalida" reaching invalidation and invalidação) without guessing.
CREATE VIRTUAL TABLE IF NOT EXISTS record_search USING fts5(
  title,
  body,
  id UNINDEXED,
  kind UNINDEXED,
  state UNINDEXED,
  at UNINDEXED,
  tokenize = 'unicode61 remove_diacritics 2'
);

-- The reference index: one row per (event, entity, ROLE) — every way an entity
-- appears in a fact.
--
-- Unlike every other table here, this one is not a fold: it is one row per
-- APPEARANCE, so the same event contributes a row for its subject and another
-- for each entity it refers to. That single shape answers the two questions the
-- record is asked from opposite ends — "which events touch this entity" (its
-- history) and "which entities does this entity reach" (the graph) — because an
-- edge between two entities is nothing but two rows of one event: the subject
-- row and a referring one.
--
-- The four roles are the whole graph of the product, and they are not a
-- vocabulary this table invents: each is a field the catalog already proves.
-- The subject role is the envelope's own; about is an observation's; target is
-- a link's; by is the successor a decision's supersede names. That fourth one
-- is the reason the index exists rather than a query over the links table: it
-- lives in a transition payload, so a reader that only knew about links could
-- see that a decision WAS superseded and never that another superseded it.
--
-- ord is the event's position in THIS tree's ordered stream, so ordering by it
-- replays the tree's own proven order without re-sorting by a wall clock. It is
-- also the join key: two rows share an ord exactly when they come from one
-- event.
--
-- The event column carries the fact as written, JSON-encoded. It is what lets a
-- history be answered from the index alone — the typed payload an auditor reads
-- (which action, which state, which relation label) exists nowhere else in the
-- cache. It is duplicated onto the referring rows rather than joined back to
-- the subject row: a referring row is a minority of the table, and a history is
-- the hot read.
CREATE TABLE IF NOT EXISTS refs (
  -- The event's position in this tree's ordered stream. Shared by every row of
  -- one event.
  ord     INTEGER NOT NULL,
  -- The entity this row is about — the one the role names.
  entity  TEXT NOT NULL,
  -- How the entity appears: 'subject', 'about', 'target' or 'by'.
  role    TEXT NOT NULL,
  -- The envelope, denormalized so a history needs no second table.
  at      TEXT NOT NULL,
  kind    TEXT NOT NULL,
  who     TEXT NOT NULL,
  -- The executing agent, or NULL when the human acted directly.
  which   TEXT,
  -- The event's OWN subject, whatever this row's role is. It is what makes an
  -- edge readable off a single referring row: subject → entity.
  subject TEXT NOT NULL,
  -- The event as written, JSON-encoded.
  event   TEXT NOT NULL,
  -- One row per (entity, role, event). The key also indexes the by-entity read,
  -- which is the history query.
  PRIMARY KEY (entity, role, ord)
) STRICT;

-- The join that turns two rows into an edge: given one event's ord, find its
-- other rows. Without it, resolving an edge would scan the table.
CREATE INDEX IF NOT EXISTS idx_refs_ord ON refs (ord, role);
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
