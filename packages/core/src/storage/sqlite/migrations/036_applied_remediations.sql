-- =============================================================================
-- Adds the `applied_remediations` table: a lifecycle ledger for the one-shot
-- DATA remediations that `mnema upgrade` runs.
--
-- Those remediations (backfill a field, retrofit a .gitattributes marker,
-- reconcile the audit mirror after a fresh clone) used to run as ad-hoc probes
-- on every upgrade — re-detecting and re-running their check each time. This
-- table gives them the same run-once-and-record lifecycle as
-- `schema_migrations`: a step whose row exists here has already run and is a
-- verifiable no-op forever after.
--
-- Keyed by the step's stable `name` (TEXT), mirroring how `schema_migrations`
-- keys by version — the registry inserts a row on the first successful run and
-- skips any step whose row is already present.
-- =============================================================================

CREATE TABLE applied_remediations (
  name       TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO schema_migrations (version, applied_at)
VALUES (36, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
