-- =============================================================================
-- Migration 019: add the `provenance_links` table.
--
-- A memory/decision often has a lineage — an observation or note was
-- promoted into a decision, and a memory was later derived from that
-- decision. Until now that lineage lived only as an audit event
-- (`decision_promoted_from_note`), which is append-only and not a
-- queryable relationship. This makes the chain first-class and
-- navigable in BOTH directions.
--
-- A row is one directed edge `source → target`. `*_kind` is the entity
-- type ('observation' | 'note' | 'decision' | 'memory') and `*_ref` is
-- that entity's natural identifier (observation/note id, decision key,
-- memory slug) — refs, not FKs, so an edge survives the referent being
-- rewritten and works uniformly across four tables. The chain is walked
-- by matching a (kind, ref) against either endpoint.
--
-- ADDITIVE: no existing table changes; promotion keeps writing its audit
-- event and now also records an edge here.
--
-- Forward-only (see forward-only-migrations memory).
-- =============================================================================

CREATE TABLE provenance_links (
  id           TEXT PRIMARY KEY,
  source_kind  TEXT NOT NULL CHECK (source_kind IN ('observation', 'note', 'decision', 'memory')),
  source_ref   TEXT NOT NULL,
  target_kind  TEXT NOT NULL CHECK (target_kind IN ('observation', 'note', 'decision', 'memory')),
  target_ref   TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

  UNIQUE (source_kind, source_ref, target_kind, target_ref)
);

CREATE INDEX idx_prov_source ON provenance_links(source_kind, source_ref);
CREATE INDEX idx_prov_target ON provenance_links(target_kind, target_ref);

INSERT INTO schema_migrations (version, applied_at)
VALUES (19, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
