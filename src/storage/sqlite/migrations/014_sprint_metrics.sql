-- =============================================================================
-- Migration 014: add the `sprint_metrics` table.
--
-- A sprint goal is free text; this gives a sprint zero or more
-- MEASURABLE metrics — a name with a baseline, a target, an optional
-- unit and an optional due date. Lets "did we hit the goal?" be an
-- objective question rather than a prose judgement. Additive and
-- opt-in: a sprint with no metric rows behaves exactly as before.
--
-- Mutating sprint metrics is CLI-only, like the rest of the sprint
-- lifecycle (plan/start/close) — choosing targets is human work.
--
-- Forward-only (see forward-only-migrations memory).
-- =============================================================================

CREATE TABLE sprint_metrics (
  id          TEXT PRIMARY KEY,
  sprint_id   TEXT NOT NULL REFERENCES sprints(id),
  name        TEXT NOT NULL,
  baseline    REAL,
  target      REAL NOT NULL,
  unit        TEXT,
  due_date    TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

  UNIQUE (sprint_id, name)
);

CREATE INDEX idx_sprint_metrics_sprint ON sprint_metrics(sprint_id);

INSERT INTO schema_migrations (version, applied_at)
VALUES (14, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
