-- =============================================================================
-- Adds the `audit_state` table that mirrors the audit-log invariants in
-- SQLite so tampering with `.mnema/audit/**.jsonl` becomes detectable.
--
-- The audit log is JSONL on disk. Any process with write access can
-- edit, truncate, reorder, or replay lines silently, so the file alone
-- cannot be trusted as evidence of "who did what".
--
-- This single-row table holds three invariants the audit writer
-- updates on every `write()`:
--
-- - `event_count`: total events written through the writer since the
--   project's first mutation. `mnema doctor` walks every line in
--   `audit/**/*.jsonl` and compares the parsed count against this.
-- - `last_event_at`: the `at` timestamp of the most recent event. A
--   shrinking audit log would leave `last_event_at` behind the
--   newest line on disk.
-- - `chain_head_hash`: the SHA-256 of the most recent audit line
--   (computed before the line was appended). Lets doctor verify the
--   hash chain by walking from the genesis line forward and
--   confirming the tail matches.
--
-- Projects that existed before this migration land with
-- `event_count = 0`, `last_event_at = NULL`, `chain_head_hash = NULL`.
-- Doctor treats that as a "legacy audit log" and skips the integrity
-- check until the first event is written through the new writer
-- (which then starts a fresh chain). The legacy mode is loud — doctor
-- prints a one-line note so users know the integrity check is dormant.
-- =============================================================================

CREATE TABLE audit_state (
  -- Always 1 row (`id = 1`). The CHECK keeps it that way.
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  event_count     INTEGER NOT NULL DEFAULT 0,
  last_event_at   TEXT,
  chain_head_hash TEXT,
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO audit_state (id, event_count) VALUES (1, 0);

INSERT INTO schema_migrations (version, applied_at)
VALUES (11, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
