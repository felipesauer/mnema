-- =============================================================================
-- Migration 027: add `superseded_by` to memories and skills.
--
-- Only decisions could be superseded (a `superseded_by` FK since the initial
-- schema). Memory and skill had no supersede path — a memory could only be
-- archived, a skill had no retire signal at all. `superseded_by` is that: a
-- pointer to the successor that replaces this row. A superseded memory/skill
-- is excluded from the default listing and from search, but the row and its
-- audit trail survive.
--
-- The two columns carry different references, matching each table's key:
--   * memories.superseded_by -> the successor memory's SLUG (memory is one row
--     per slug).
--   * skills.superseded_by    -> the successor skill row's ID (skill is keyed by
--     (slug, version); versions coexist as rows, so the pointer is a row id,
--     mirroring how decisions store the successor's id). See the ADR.
--
-- ADDITIVE and nullable: every existing row is `superseded_by IS NULL`
-- (active), so behaviour is unchanged until something supersedes.
--
-- Forward-only (see forward-only-migrations memory).
-- =============================================================================

ALTER TABLE memories ADD COLUMN superseded_by TEXT;
ALTER TABLE skills ADD COLUMN superseded_by TEXT;

INSERT INTO schema_migrations (version, applied_at)
VALUES (27, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
