-- mnema:disable-foreign-keys
--
-- The work graph sheds the fields the model never earned. `priority` and
-- `capacity` were speculative estimation knobs no workflow consumed; the
-- sprint-metric side-table was a burndown feature that never shipped. A
-- dependency is either a hard `blocks` edge or a soft `relates_to` note — the
-- `duplicates`/`parent_of` kinds carried no distinct behaviour, so surviving
-- edges fold into `relates_to`. Epics finally gain an `updated_at` so their
-- state transitions can be optimistically concurrent like tasks and sprints.
--
-- SQLite refuses `ALTER TABLE … DROP COLUMN` on a checked/constrained column,
-- so tasks (drops `priority`) and sprints (drops `capacity`) are rebuilt by
-- table-copy, re-emitting their dependent indexes and triggers verbatim.
-- Ordering is load-bearing: the sprint-metric side-table (a child of sprints)
-- is dropped before sprints is rebuilt, and dependencies (a child of tasks) is
-- rebuilt after tasks so its foreign keys resolve to the final table.

BEGIN;

-- ── sprint_metrics: dropped whole (child of sprints — must go first) ─────────
DROP TABLE sprint_metrics;

-- ── tasks: rebuilt without `priority` ────────────────────────────────────────
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
  state, estimate, assignee_id, reporter_id, reopen_count, metadata,
  created_at, updated_at, closed_at, deleted_at, context_budget, claimed_by,
  lease_expires_at, git_branch, git_commits, git_pr
)
SELECT
  id, project_id, epic_id, sprint_id, title, description, acceptance_criteria,
  state, estimate, assignee_id, reporter_id, reopen_count, metadata,
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

-- The FTS index rows key off task ids, unchanged by the copy, so the existing
-- tasks_fts contents stay valid — no reindex needed.

-- ── sprints: rebuilt without `capacity` ──────────────────────────────────────
CREATE TABLE sprints_new (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id),
  name        TEXT NOT NULL,
  goal        TEXT,
  state       TEXT NOT NULL DEFAULT 'PLANNED' CHECK (state IN ('PLANNED', 'ACTIVE', 'CLOSED', 'CANCELED')),
  starts_at   TEXT,
  ends_at     TEXT,
  metadata    TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at   TEXT,
  deleted_at  TEXT,
  updated_at  TEXT
);

INSERT INTO sprints_new (
  id, project_id, name, goal, state, starts_at, ends_at, metadata,
  created_at, closed_at, deleted_at, updated_at
)
SELECT
  id, project_id, name, goal, state, starts_at, ends_at, metadata,
  created_at, closed_at, deleted_at, updated_at
FROM sprints;

DROP TABLE sprints;
ALTER TABLE sprints_new RENAME TO sprints;

CREATE UNIQUE INDEX idx_sprints_active ON sprints(project_id)
  WHERE state = 'ACTIVE' AND deleted_at IS NULL;
CREATE INDEX idx_sprints_project ON sprints(project_id);

-- ── epics: gain `updated_at`, backfilled from `created_at` ───────────────────
-- ADD COLUMN cannot take a non-constant default, so the column lands nullable
-- and the backfill seeds every existing row with its creation time — a
-- reasonable floor for "last touched" before the app began stamping it.
ALTER TABLE epics ADD COLUMN updated_at TEXT;
UPDATE epics SET updated_at = created_at;

-- ── dependencies: kinds narrowed to blocks + relates_to ──────────────────────
-- The two retired kinds fold into `relates_to`. Fold DURING the table-copy, not
-- with an in-place UPDATE: a pair that already carries both a `relates_to` and
-- a `parent_of`/`duplicates` edge would, after the fold, have two identical
-- (task_id, blocks_task_id, 'relates_to') rows — an in-place UPDATE trips the
-- OLD unique index mid-statement and aborts the whole migration. Projecting the
-- folded kind in the SELECT and copying with INSERT OR IGNORE instead lets the
-- redundant soft edge collapse into one (two soft links between the same pair
-- are semantically one). `blocks` is untouched. Ordering by (created_at, id)
-- keeps which row survives deterministic across clones.
CREATE TABLE dependencies_new (
  id              TEXT PRIMARY KEY,
  task_id         TEXT NOT NULL REFERENCES tasks(id),
  blocks_task_id  TEXT NOT NULL REFERENCES tasks(id),
  kind            TEXT NOT NULL DEFAULT 'blocks' CHECK (kind IN (
    'blocks', 'relates_to'
  )),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),

  CHECK (task_id != blocks_task_id),
  UNIQUE (task_id, blocks_task_id, kind)
);

INSERT OR IGNORE INTO dependencies_new (id, task_id, blocks_task_id, kind, created_at)
SELECT
  id,
  task_id,
  blocks_task_id,
  CASE WHEN kind IN ('duplicates', 'parent_of') THEN 'relates_to' ELSE kind END,
  created_at
FROM dependencies
ORDER BY created_at, id;

DROP TABLE dependencies;
ALTER TABLE dependencies_new RENAME TO dependencies;

CREATE INDEX idx_deps_blocks ON dependencies(blocks_task_id);
CREATE INDEX idx_deps_task ON dependencies(task_id);

INSERT INTO schema_migrations (version, applied_at)
VALUES (3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

COMMIT;
