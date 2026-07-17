-- =============================================================================
-- Migration 013: add the `task_evidence` table.
--
-- Links a task's acceptance criterion (by its 0-based index into the
-- existing `acceptance_criteria` JSON array) to a piece of evidence — a
-- test path, route, commit, doc, or url. This is ADDITIVE: the
-- `acceptance_criteria` column and the `submit` gate are untouched, so
-- every workflow (lean/default/custom) keeps working. Evidence is
-- opt-in; a task with no rows here behaves exactly as before.
--
-- Forward-only (see forward-only-migrations memory).
-- =============================================================================

CREATE TABLE task_evidence (
  id               TEXT PRIMARY KEY,
  task_id          TEXT NOT NULL REFERENCES tasks(id),
  criterion_index  INTEGER NOT NULL,
  kind             TEXT NOT NULL DEFAULT 'other' CHECK (kind IN (
    'test', 'route', 'commit', 'doc', 'url', 'other'
  )),
  ref              TEXT NOT NULL,
  note             TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

  UNIQUE (task_id, criterion_index, kind, ref)
);

CREATE INDEX idx_task_evidence_task ON task_evidence(task_id);

INSERT INTO schema_migrations (version, applied_at)
VALUES (13, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
