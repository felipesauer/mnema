-- =============================================================================
-- Migration 015: add `impacts` to decisions.
--
-- Records which artefacts a decision (ADR) affects — a JSON array of
-- paths or keys (e.g. ["src/services/foo.ts", "MNEMA-42"]). This lets
-- the reverse question be answered: "which decision touched this
-- artefact?". Nullable/defaulted to an empty array; opt-in.
--
-- Forward-only (see forward-only-migrations memory).
-- =============================================================================

ALTER TABLE decisions ADD COLUMN impacts TEXT NOT NULL DEFAULT '[]';

INSERT INTO schema_migrations (version, applied_at)
VALUES (15, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
