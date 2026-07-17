-- =============================================================================
-- Migration 026: add `archived_at` to observations.
--
-- Observations are append-only signals — but a stale or superseded one had
-- nowhere to go, so the newest-first listing and search kept surfacing it
-- forever. `archived_at` is a soft, one-way retirement: an archived
-- observation is excluded from the default listing and from search, but the
-- row and its audit trail survive. This mirrors what `archived_at` already
-- does for memories (migration 018); observations have no slug to re-record,
-- so archival is not reversed by a later write (unlike a memory).
--
-- ADDITIVE and nullable: every existing observation is `archived_at IS NULL`
-- (active), so behaviour is unchanged until something archives.
--
-- Forward-only (see forward-only-migrations memory).
-- =============================================================================

ALTER TABLE observations ADD COLUMN archived_at TEXT;

INSERT INTO schema_migrations (version, applied_at)
VALUES (26, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
