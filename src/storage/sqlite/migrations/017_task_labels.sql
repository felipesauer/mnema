-- =============================================================================
-- Migration 017: add transversal labels on tasks (`labels` + `task_labels`).
--
-- Epics and sprints organize the backlog along one axis each; labels add
-- the cross-cutting one (area:api, tipo:bug) that neither captures. The
-- model is normalized so a label is a first-class row: counts and
-- GROUP BY per label are a plain SQL query, and renaming a label happens
-- in one place.
--
--   labels       — the catalogue; `name` is unique, case-sensitive as
--                  entered (`area:api` ≠ `Area:API`).
--   task_labels  — the M:N join. ON DELETE CASCADE on both sides so a
--                  removed task or label leaves no dangling pair (tasks
--                  are normally soft-deleted, so this is a safety net for
--                  a genuine hard delete, and the canonical way to clear
--                  a label's links when the label itself is removed).
--
-- This is ADDITIVE: the `tasks` table is untouched and a task with no
-- rows here behaves exactly as before. Labels are opt-in.
--
-- Forward-only (see forward-only-migrations memory).
-- =============================================================================

CREATE TABLE labels (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

  UNIQUE (name)
);

CREATE TABLE task_labels (
  task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  label_id    TEXT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

  PRIMARY KEY (task_id, label_id)
);

CREATE INDEX idx_task_labels_task ON task_labels(task_id);
CREATE INDEX idx_task_labels_label ON task_labels(label_id);

INSERT INTO schema_migrations (version, applied_at)
VALUES (17, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
