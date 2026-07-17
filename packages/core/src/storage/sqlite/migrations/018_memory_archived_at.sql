-- =============================================================================
-- Migration 018: add `archived_at` to memories.
--
-- Staleness (a memory whose cited file:line changed since it was written)
-- is advisory — it never blocks recall. But once a human confirms a
-- flagged memory is obsolete, they need somewhere to put it. `archived_at`
-- is that: a soft, reversible retirement. An archived memory is excluded
-- from the default listing / bootstrap inventory but not deleted — the
-- audit trail and the row survive, and re-recording the same slug
-- (`memory_record`) clears the flag and brings it back.
--
-- ADDITIVE and nullable: every existing memory is `archived_at IS NULL`
-- (active), so behaviour is unchanged until something archives.
--
-- Forward-only (see forward-only-migrations memory).
-- =============================================================================

ALTER TABLE memories ADD COLUMN archived_at TEXT;

INSERT INTO schema_migrations (version, applied_at)
VALUES (18, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
