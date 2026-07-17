-- mnema:disable-foreign-keys
-- =============================================================================
-- Migration 004: drop the hard-coded CHECK on tasks.state
-- =============================================================================
-- The original schema (001) pinned tasks.state to the seven states of
-- the bundled `default` workflow. The other presets (lean: TODO /
-- DOING / DONE, kanban: BACKLOG / READY / IN_PROGRESS / BLOCKED /
-- DONE, jira-classic: OPEN / IN_PROGRESS / RESOLVED / CLOSED /
-- REOPENED) all clash with that CHECK, so any non-default workflow
-- blew up on the very first task_create.
--
-- SQLite does not support `ALTER TABLE DROP CONSTRAINT`, so we
-- follow the official recipe: build a copy without the CHECK, move
-- the rows, swap the names. The `mnema:disable-foreign-keys` pragma
-- in the header tells the runner to flip `foreign_keys = OFF` for
-- this migration's duration — required because `DROP TABLE tasks`
-- with rows in `transitions`, `notes`, `decision_tasks` still
-- referencing it would otherwise fail. We re-enable FK enforcement
-- as soon as the swap finishes; every existing reference still
-- resolves because we preserve each row's id.
--
-- The state-machine layer is now the only place that validates
-- workflow states; the database is intentionally permissive.

BEGIN;

-- 1. Throwaway copy without the CHECK constraint. Every column,
--    default, and FK declaration is preserved verbatim — only the
--    `CHECK (state IN (...))` clause is gone.
CREATE TABLE tasks_new (
  id                   TEXT PRIMARY KEY,
  key                  TEXT NOT NULL UNIQUE,
  project_id           TEXT NOT NULL REFERENCES projects(id),
  epic_id              TEXT REFERENCES epics(id),
  sprint_id            TEXT REFERENCES sprints(id),

  title                TEXT NOT NULL,
  description          TEXT,
  acceptance_criteria  TEXT NOT NULL DEFAULT '[]',

  state                TEXT NOT NULL DEFAULT 'DRAFT',

  estimate             INTEGER,
  priority             INTEGER NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),

  assignee_id          TEXT REFERENCES actors(id),
  reporter_id          TEXT NOT NULL REFERENCES actors(id),

  reopen_count         INTEGER NOT NULL DEFAULT 0,
  metadata             TEXT NOT NULL DEFAULT '{}',

  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at            TEXT,
  deleted_at           TEXT
);

-- 2. Move the data. Column order matches; we copy every column
--    explicitly so the migration is robust against future column
--    additions (a new column with a default would be NULL otherwise).
INSERT INTO tasks_new (
  id, key, project_id, epic_id, sprint_id,
  title, description, acceptance_criteria,
  state, estimate, priority,
  assignee_id, reporter_id,
  reopen_count, metadata,
  created_at, updated_at, closed_at, deleted_at
)
SELECT
  id, key, project_id, epic_id, sprint_id,
  title, description, acceptance_criteria,
  state, estimate, priority,
  assignee_id, reporter_id,
  reopen_count, metadata,
  created_at, updated_at, closed_at, deleted_at
FROM tasks;

-- 3. Drop triggers/indexes targeting the old table. Use IF EXISTS so
--    a half-applied previous run (where autocommit got past the
--    DROPs but failed during INSERT/RENAME) is safe to retry.
DROP TRIGGER IF EXISTS trg_tasks_updated_at;
DROP TRIGGER IF EXISTS trg_tasks_fts_insert;
DROP TRIGGER IF EXISTS trg_tasks_fts_update;
DROP TRIGGER IF EXISTS trg_tasks_fts_delete;
DROP INDEX IF EXISTS idx_tasks_project;
DROP INDEX IF EXISTS idx_tasks_state;
DROP INDEX IF EXISTS idx_tasks_sprint;
DROP INDEX IF EXISTS idx_tasks_epic;
DROP INDEX IF EXISTS idx_tasks_assignee;

-- 4. Out with the old, in with the new.
DROP TABLE tasks;
ALTER TABLE tasks_new RENAME TO tasks;

-- 5. Restore the indexes (same definitions as 001) and the
--    updated_at trigger.
CREATE INDEX idx_tasks_project ON tasks(project_id);
CREATE INDEX idx_tasks_state ON tasks(state) WHERE deleted_at IS NULL;
CREATE INDEX idx_tasks_sprint ON tasks(sprint_id) WHERE sprint_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_tasks_epic ON tasks(epic_id) WHERE epic_id IS NOT NULL;
CREATE INDEX idx_tasks_assignee ON tasks(assignee_id) WHERE assignee_id IS NOT NULL;

CREATE TRIGGER trg_tasks_updated_at
AFTER UPDATE ON tasks
FOR EACH ROW WHEN OLD.updated_at = NEW.updated_at
BEGIN
  UPDATE tasks SET updated_at = datetime('now') WHERE id = NEW.id;
END;

-- 6. Restore the FTS5 sync triggers (definitions copied from
--    migration 002, identical semantics).
CREATE TRIGGER trg_tasks_fts_insert AFTER INSERT ON tasks BEGIN
  INSERT INTO tasks_fts (task_id, project_id, title, description, acceptance_criteria)
  VALUES (NEW.id, NEW.project_id, NEW.title, COALESCE(NEW.description, ''), NEW.acceptance_criteria);
END;

CREATE TRIGGER trg_tasks_fts_update AFTER UPDATE ON tasks
WHEN OLD.title != NEW.title
  OR COALESCE(OLD.description, '') != COALESCE(NEW.description, '')
  OR OLD.acceptance_criteria != NEW.acceptance_criteria
BEGIN
  DELETE FROM tasks_fts WHERE task_id = OLD.id;
  INSERT INTO tasks_fts (task_id, project_id, title, description, acceptance_criteria)
  VALUES (NEW.id, NEW.project_id, NEW.title, COALESCE(NEW.description, ''), NEW.acceptance_criteria);
END;

CREATE TRIGGER trg_tasks_fts_delete AFTER DELETE ON tasks BEGIN
  DELETE FROM tasks_fts WHERE task_id = OLD.id;
END;

-- 7. Stamp the migration as applied so the runner skips it next time.
INSERT INTO schema_migrations (version) VALUES (4);

COMMIT;
