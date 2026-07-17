-- mnema:disable-foreign-keys
-- =============================================================================
-- Migration 028: allow 'skill' as a provenance kind.
--
-- provenance_links (migration 019) constrained source_kind/target_kind to
-- ('observation', 'note', 'decision', 'memory') via a CHECK. Skill supersede
-- had no edge because 'skill' was absent from that CHECK, and SQLite cannot
-- ALTER a CHECK — the column constraint can only change by recreating the
-- table. This migration does exactly that, adding 'skill' to both CHECKs so a
-- superseded skill version can link to its successor (skill → skill), the way
-- memory supersede already records memory → memory.
--
-- The recreate is the standard SQLite dance: build the new table, copy every
-- row, drop the old, rename. The UNIQUE constraint and both lookup indexes are
-- restored identically. Existing rows all carry kinds already in the old CHECK,
-- so the copy cannot violate the new (wider) one.
--
-- ADDITIVE in effect: the constraint only widens; no row is dropped or altered.
--
-- The whole rebuild runs inside one transaction, and the header disables
-- foreign keys for its duration — DROP TABLE provenance_links must not fail on,
-- nor orphan, any row that references it, and the pragma cannot toggle inside a
-- transaction. Every statement is idempotent (IF EXISTS / IF NOT EXISTS) so a
-- run that crashed mid-migration — before the version stamp committed — is
-- safe to retry rather than leaving a recreated-but-unstamped table that would
-- brick every future migrate. Same recipe as migrations 004 and 006.
--
-- Forward-only (see forward-only-migrations memory).
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS provenance_links_new (
  id           TEXT PRIMARY KEY,
  source_kind  TEXT NOT NULL CHECK (source_kind IN ('observation', 'note', 'decision', 'memory', 'skill')),
  source_ref   TEXT NOT NULL,
  target_kind  TEXT NOT NULL CHECK (target_kind IN ('observation', 'note', 'decision', 'memory', 'skill')),
  target_ref   TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

  UNIQUE (source_kind, source_ref, target_kind, target_ref)
);

INSERT INTO provenance_links_new (id, source_kind, source_ref, target_kind, target_ref, created_at)
SELECT id, source_kind, source_ref, target_kind, target_ref, created_at FROM provenance_links;

DROP TABLE provenance_links;
ALTER TABLE provenance_links_new RENAME TO provenance_links;

CREATE INDEX IF NOT EXISTS idx_prov_source ON provenance_links(source_kind, source_ref);
CREATE INDEX IF NOT EXISTS idx_prov_target ON provenance_links(target_kind, target_ref);

INSERT INTO schema_migrations (version, applied_at)
VALUES (28, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

COMMIT;
