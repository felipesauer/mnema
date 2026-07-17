-- =============================================================================
-- Migration 032: optional `scope` on memories and skills.
--
-- All knowledge lands in one project-wide bucket. In a monorepo that means an
-- agent working `packages/notifier` gets every skill and memory, most of them
-- irrelevant. `scope` lets a memory/skill declare the area it belongs to (a
-- path or package, e.g. `packages/notifier`), so the bootstrap and search can
-- narrow to what matters for the work at hand.
--
-- `scope` — free text, nullable. NULL means project-global (the current
--           behaviour): the entry is always visible, whatever area is in
--           focus. A set scope is an opt-in narrowing signal, never a hard
--           partition — a scoped-out entry is de-prioritised, not hidden.
--
-- ADDITIVE and nullable on both tables; every existing row is `scope IS NULL`
-- and behaves exactly as before.
--
-- Forward-only (see forward-only-migrations memory).
-- =============================================================================

ALTER TABLE memories ADD COLUMN scope TEXT;
ALTER TABLE skills ADD COLUMN scope TEXT;

INSERT INTO schema_migrations (version, applied_at)
VALUES (32, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
