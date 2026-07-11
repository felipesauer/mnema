-- mnema:disable-foreign-keys
-- =============================================================================
-- Migration 034: allow CANCELED as a sprint state
-- =============================================================================
-- The 001 schema pinned sprints.state to CHECK (state IN ('PLANNED',
-- 'ACTIVE', 'CLOSED')). A planned sprint that is superseded (its tasks
-- delivered by another sprint) had no way to be retired — the domain now
-- models a CANCELED terminal state (`mnema sprint cancel`), so the CHECK
-- must admit it.
--
-- SQLite has no `ALTER TABLE DROP CONSTRAINT`, so we follow the same recipe
-- as migration 004: build a copy with the widened CHECK, move the rows, swap
-- the names. The `mnema:disable-foreign-keys` header lets `DROP TABLE sprints`
-- succeed while `tasks.sprint_id` and `sprint_metrics.sprint_id` still
-- reference it — every id is preserved, so those references still resolve.
--
-- Columns are the 001 set plus `updated_at` (added by migration 010). Copied
-- explicitly so a future column addition can't be silently dropped.

BEGIN;

CREATE TABLE sprints_new (
  id          TEXT PRIMARY KEY,
  key         TEXT NOT NULL UNIQUE,
  project_id  TEXT NOT NULL REFERENCES projects(id),
  name        TEXT NOT NULL,
  goal        TEXT,
  state       TEXT NOT NULL DEFAULT 'PLANNED' CHECK (state IN ('PLANNED', 'ACTIVE', 'CLOSED', 'CANCELED')),
  starts_at   TEXT,
  ends_at     TEXT,
  capacity    INTEGER,
  metadata    TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at   TEXT,
  deleted_at  TEXT,
  updated_at  TEXT
);

INSERT INTO sprints_new (
  id, key, project_id, name, goal, state,
  starts_at, ends_at, capacity, metadata,
  created_at, closed_at, deleted_at, updated_at
)
SELECT
  id, key, project_id, name, goal, state,
  starts_at, ends_at, capacity, metadata,
  created_at, closed_at, deleted_at, updated_at
FROM sprints;

DROP INDEX IF EXISTS idx_sprints_project;
DROP INDEX IF EXISTS idx_sprints_active;

DROP TABLE sprints;
ALTER TABLE sprints_new RENAME TO sprints;

-- Restore the indexes (same definitions as 001, including the partial
-- unique index that enforces at most one ACTIVE sprint per project).
CREATE INDEX idx_sprints_project ON sprints(project_id);
CREATE UNIQUE INDEX idx_sprints_active ON sprints(project_id)
  WHERE state = 'ACTIVE' AND deleted_at IS NULL;

INSERT INTO schema_migrations (version) VALUES (34);

COMMIT;
