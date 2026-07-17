-- =============================================================================
-- Migration 021: index tasks(project_id, title) for title-based dedupe.
--
-- The markdown importer calls findByTitle once per parsed heading:
--   SELECT * FROM tasks WHERE project_id = ? AND title = ? AND deleted_at IS NULL
-- With no index on title, each lookup scanned the project's rows, so a
-- large import was O(headings x tasks). This partial index makes the
-- lookup index-eligible and its WHERE (deleted_at IS NULL) matches the
-- query exactly.
--
-- NON-UNIQUE by design: the repository intentionally allows duplicate
-- titles (findByTitle returns a list). The index only speeds the lookup.
-- Partial on `deleted_at IS NULL` so soft-deleted rows stay out of it,
-- mirroring idx_tasks_state's predicate.
--
-- Index-only DDL, no PRAGMA and no data change; wrapped in a transaction
-- so it applies atomically. better-sqlite3's exec() runs BEGIN/COMMIT as
-- part of the script.
-- =============================================================================

BEGIN;

CREATE INDEX IF NOT EXISTS idx_tasks_title
  ON tasks(project_id, title)
  WHERE deleted_at IS NULL;

-- Each migration records its own version (the runner does not).
INSERT INTO schema_migrations (version, applied_at)
VALUES (21, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

COMMIT;
