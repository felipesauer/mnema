-- =============================================================================
-- Migration 012: add `context_budget` to tasks.
--
-- `context_budget` records the estimated context cost of a task in
-- TOKENS — distinct from `estimate` (story points / human effort) and
-- `priority`. It is the dimension that drives a "split this task into a
-- chain" decision when the work would not fit comfortably in an
-- executor's window. Nullable: most tasks never set it; it is opt-in
-- metadata for the ones whose sizing was reasoned about.
--
-- Forward-only: no down migration (see forward-only-migrations memory).
-- =============================================================================

ALTER TABLE tasks ADD COLUMN context_budget INTEGER;

INSERT INTO schema_migrations (version, applied_at)
VALUES (12, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
