-- =============================================================================
-- Migration 030: per-version change rationale on skills.
--
-- `mode: new_version` records a fresh version row but captured no reason for
-- the change — and the *why* is what teaches the next agent which version to
-- trust and what shifted. This column stores that rationale on the version it
-- describes, so a skill's history reads as a changelog, not just a stack of
-- bodies.
--
-- `change_rationale` — free text, nullable. Null on version 1 and on any
--                      version recorded without a reason; set when a
--                      new_version (or update) supplies one.
--
-- ADDITIVE: one nullable column on the existing `skills` table; no data
-- rewrite, and a skill that never sets it behaves exactly as before.
--
-- Forward-only (see forward-only-migrations memory).
-- =============================================================================

ALTER TABLE skills ADD COLUMN change_rationale TEXT;

INSERT INTO schema_migrations (version, applied_at)
VALUES (30, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
