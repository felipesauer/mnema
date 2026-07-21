-- mnema:disable-foreign-keys
--
-- The committed id is the identity of a task, epic, and sprint now (the mirror
-- filename, the wikilink, the cross-entity reference). The sequential `key`
-- (`PROJECT-N`) is gone: it collided by construction the moment two clones
-- minted offline (both produce `PROJECT-1`), and a `UNIQUE NOT NULL key` made
-- that collision a rebuild failure. Dropping the column removes the constraint
-- and the sequence.
--
-- SQLite refuses `ALTER TABLE … DROP COLUMN` on a UNIQUE column, so each table
-- is rebuilt without `key` (a table-copy). Nothing references `key` — no index,
-- trigger, or foreign key — so the dependent objects are re-emitted verbatim.
-- A decision keeps its key (that identity migrates in a later wave), so the
-- decisions table is untouched.

BEGIN;

-- ── tasks ──────────────────────────────────────────────────────────────────
CREATE TABLE tasks_new (
  id                   TEXT PRIMARY KEY,
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
  deleted_at           TEXT,
  context_budget       INTEGER,
  claimed_by           TEXT REFERENCES actors(id),
  lease_expires_at     TEXT,
  git_branch           TEXT,
  git_commits          TEXT NOT NULL DEFAULT '[]',
  git_pr               TEXT
);

INSERT INTO tasks_new (
  id, project_id, epic_id, sprint_id, title, description, acceptance_criteria,
  state, estimate, priority, assignee_id, reporter_id, reopen_count, metadata,
  created_at, updated_at, closed_at, deleted_at, context_budget, claimed_by,
  lease_expires_at, git_branch, git_commits, git_pr
)
SELECT
  id, project_id, epic_id, sprint_id, title, description, acceptance_criteria,
  state, estimate, priority, assignee_id, reporter_id, reopen_count, metadata,
  created_at, updated_at, closed_at, deleted_at, context_budget, claimed_by,
  lease_expires_at, git_branch, git_commits, git_pr
FROM tasks;

DROP TABLE tasks;
ALTER TABLE tasks_new RENAME TO tasks;

CREATE INDEX idx_tasks_assignee ON tasks(assignee_id) WHERE assignee_id IS NOT NULL;
CREATE INDEX idx_tasks_claimed_by ON tasks(claimed_by) WHERE claimed_by IS NOT NULL;
CREATE INDEX idx_tasks_epic ON tasks(epic_id) WHERE epic_id IS NOT NULL;
CREATE INDEX idx_tasks_project ON tasks(project_id);
CREATE INDEX idx_tasks_sprint ON tasks(sprint_id) WHERE sprint_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_tasks_state ON tasks(state) WHERE deleted_at IS NULL;
CREATE INDEX idx_tasks_title
  ON tasks(project_id, title)
  WHERE deleted_at IS NULL;

CREATE TRIGGER trg_tasks_fts_delete AFTER DELETE ON tasks BEGIN
  DELETE FROM tasks_fts WHERE task_id = OLD.id;
END;

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

CREATE TRIGGER trg_tasks_updated_at
AFTER UPDATE ON tasks
FOR EACH ROW WHEN OLD.updated_at = NEW.updated_at
BEGIN
  UPDATE tasks SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

-- The FTS index rows key off task ids, which are unchanged by the copy, so the
-- existing tasks_fts contents stay valid — no reindex needed.

-- ── epics ──────────────────────────────────────────────────────────────────
CREATE TABLE epics_new (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id),
  title       TEXT NOT NULL,
  description TEXT,
  state       TEXT NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN', 'CLOSED')),
  metadata    TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at   TEXT,
  deleted_at  TEXT
);

INSERT INTO epics_new (
  id, project_id, title, description, state, metadata, created_at, closed_at, deleted_at
)
SELECT
  id, project_id, title, description, state, metadata, created_at, closed_at, deleted_at
FROM epics;

DROP TABLE epics;
ALTER TABLE epics_new RENAME TO epics;

CREATE INDEX idx_epics_project ON epics(project_id);
CREATE INDEX idx_epics_state ON epics(state) WHERE deleted_at IS NULL;

-- ── sprints ────────────────────────────────────────────────────────────────
CREATE TABLE sprints_new (
  id          TEXT PRIMARY KEY,
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
  id, project_id, name, goal, state, starts_at, ends_at, capacity, metadata,
  created_at, closed_at, deleted_at, updated_at
)
SELECT
  id, project_id, name, goal, state, starts_at, ends_at, capacity, metadata,
  created_at, closed_at, deleted_at, updated_at
FROM sprints;

DROP TABLE sprints;
ALTER TABLE sprints_new RENAME TO sprints;

CREATE UNIQUE INDEX idx_sprints_active ON sprints(project_id)
  WHERE state = 'ACTIVE' AND deleted_at IS NULL;
CREATE INDEX idx_sprints_project ON sprints(project_id);

INSERT INTO schema_migrations (version, applied_at)
VALUES (2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

COMMIT;
