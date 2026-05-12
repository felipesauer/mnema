-- =============================================================================
-- Migration 010: add `updated_at` to decisions and sprints so they
-- can opt into the same optimistic-concurrency check `tasks` already
-- enforces (TaskRepository.updateState `expectedUpdatedAt` path).
--
-- Existing rows are seeded with `at` (decisions) or `created_at`
-- (sprints) so first-touch consumers see a sensible value rather than
-- NULL. New rows use the same column default the rest of the schema
-- uses (`strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`).
-- =============================================================================

ALTER TABLE decisions ADD COLUMN updated_at TEXT;
UPDATE decisions SET updated_at = at WHERE updated_at IS NULL;

ALTER TABLE sprints ADD COLUMN updated_at TEXT;
UPDATE sprints SET updated_at = created_at WHERE updated_at IS NULL;

INSERT INTO schema_migrations (version, applied_at)
VALUES (10, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
