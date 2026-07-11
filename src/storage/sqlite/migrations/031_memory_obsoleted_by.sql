-- =============================================================================
-- Migration 031: add `obsoleted_by` to memories (the "contradicts" relation).
--
-- Supersede is a hard, one-way replacement: the old memory drops out of
-- listing and search entirely. But a NEW memory that *contradicts* an old one
-- is different — the contradiction is itself informative, and the old memory
-- should stay visible yet clearly marked obsolete so the next agent knows
-- which is current. `superseded_by` cannot express that (it hides the row);
-- `obsoleted_by` is the softer typed relation for it.
--
-- `obsoleted_by` — the SLUG of the memory that contradicts/obsoletes this one
--                  (memory is one row per slug, so the pointer is a slug, like
--                  `superseded_by`). NULL for every memory not contradicted.
--                  The obsoleted memory stays listed but is annotated and
--                  de-ranked; it is NOT filtered out (that is supersede's job).
--
-- ADDITIVE and nullable: every existing row is `obsoleted_by IS NULL` and
-- behaves exactly as before.
--
-- Forward-only (see forward-only-migrations memory).
-- =============================================================================

ALTER TABLE memories ADD COLUMN obsoleted_by TEXT;

INSERT INTO schema_migrations (version, applied_at)
VALUES (31, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
