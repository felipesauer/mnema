-- =============================================================================
-- Migration 029: backfill FTS for skills, memories and observations.
--
-- Migration 008 created the three base tables; migration 009 added the FTS
-- virtual tables plus insert/update/delete triggers. But 009 never indexed the
-- rows that already existed when it ran — the triggers only fire on writes made
-- *after* 009. A database that carried skills/memories/observations across the
-- 008 → 009 boundary therefore has un-indexed rows that `SearchService` (which
-- queries FTS with no LIKE fallback) can never surface.
--
-- This backfills those rows using the exact column shape the 009 triggers emit.
-- Idempotent: only rows missing from the FTS side are inserted, so re-running
-- (or running on a fresh DB where the triggers already indexed everything) is a
-- no-op and never double-indexes.
--
-- Forward-only (see forward-only-migrations memory).
-- =============================================================================

INSERT INTO skills_fts (skill_id, slug, version, name, description, content)
SELECT s.id, s.slug, s.version, s.name, s.description, s.content
  FROM skills s
 WHERE s.id NOT IN (SELECT skill_id FROM skills_fts);

INSERT INTO memories_fts (memory_id, slug, title, content)
SELECT m.id, m.slug, m.title, m.content
  FROM memories m
 WHERE m.id NOT IN (SELECT memory_id FROM memories_fts);

INSERT INTO observations_fts (observation_id, content)
SELECT o.id, o.content
  FROM observations o
 WHERE o.id NOT IN (SELECT observation_id FROM observations_fts);

INSERT INTO schema_migrations (version, applied_at)
VALUES (29, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
