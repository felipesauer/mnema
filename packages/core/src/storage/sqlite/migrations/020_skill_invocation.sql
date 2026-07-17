-- =============================================================================
-- Migration 020: dynamic skill invocation fields.
--
-- Until now a skill was a passive record — documentation an agent reads.
-- These two columns let a skill declare that it is *invocable* and carry
-- dynamic context: commands whose output is injected when the skill is
-- shown, so e.g. a "pick next task" skill can embed live `mnema tasks
-- ready` output instead of a stale hand-written list.
--
-- `invocable`       — 0/1 flag; 1 means the skill is meant to be run, not
--                     just read. Defaults to 0 so every existing skill
--                     stays passive and unchanged.
-- `dynamic_context` — JSON array of command strings to expand at show
--                     time. Defaults to '[]' (no dynamic context).
--
-- ADDITIVE: two columns with defaults on the existing `skills` table; no
-- data rewrite, and a skill that sets neither behaves exactly as before.
--
-- Forward-only (see forward-only-migrations memory).
-- =============================================================================

ALTER TABLE skills ADD COLUMN invocable INTEGER NOT NULL DEFAULT 0;
ALTER TABLE skills ADD COLUMN dynamic_context TEXT NOT NULL DEFAULT '[]';

INSERT INTO schema_migrations (version, applied_at)
VALUES (20, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
