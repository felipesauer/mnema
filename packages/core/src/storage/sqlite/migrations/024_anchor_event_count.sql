-- =============================================================================
-- Migration 024: anchors.event_count_at — anchor-interval baseline
-- =============================================================================
-- Temporal anchoring honours a configurable interval (audit.anchor.interval:
-- events / seconds). To decide whether enough NEW events have accrued since
-- the last anchor, the scheduler needs the event_count at which each anchor
-- was made — the by-events baseline. `created_at` already gives the by-time
-- baseline; this adds the by-events one.
--
-- Nullable: rows written before this migration (or by a path that doesn't
-- know the count) carry NULL, and the scheduler falls back to the time bound.
--
-- Additive column → runs inside Database.exec's implicit transaction.

ALTER TABLE anchors ADD COLUMN event_count_at INTEGER;

INSERT INTO schema_migrations (version, applied_at)
VALUES (24, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
