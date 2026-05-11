-- =============================================================================
-- Migration 008: skills, memories and observations.
--
-- Agents can record reusable procedures (skills), durable project facts
-- (memories) and append-only context notes (observations) without going
-- through a human-authored markdown file first. Skills and memories also
-- mirror to `.mnema/skills/<slug>.md` and `.mnema/memory/<slug>.md` so
-- humans see the same content; observations are SQLite-only to keep noise
-- out of the working tree.
-- =============================================================================

CREATE TABLE skills (
  id            TEXT PRIMARY KEY,
  slug          TEXT NOT NULL,
  name          TEXT NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1,
  description   TEXT NOT NULL,
  content       TEXT NOT NULL,
  tools_used    TEXT NOT NULL DEFAULT '[]',
  usage_count   INTEGER NOT NULL DEFAULT 0,
  last_used_at  TEXT,
  created_by    TEXT NOT NULL REFERENCES actors(id),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(slug, version)
);

CREATE INDEX idx_skills_slug ON skills(slug, version DESC);

CREATE TABLE memories (
  id          TEXT PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  content     TEXT NOT NULL,
  topics      TEXT NOT NULL DEFAULT '[]',
  created_by  TEXT NOT NULL REFERENCES actors(id),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_memories_slug ON memories(slug);

CREATE TABLE observations (
  id               TEXT PRIMARY KEY,
  content          TEXT NOT NULL,
  topics           TEXT NOT NULL DEFAULT '[]',
  related_task_id  TEXT REFERENCES tasks(id),
  created_by       TEXT NOT NULL REFERENCES actors(id),
  at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_observations_at ON observations(at);
CREATE INDEX idx_observations_task ON observations(related_task_id);

INSERT INTO schema_migrations (version, applied_at)
VALUES (8, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
