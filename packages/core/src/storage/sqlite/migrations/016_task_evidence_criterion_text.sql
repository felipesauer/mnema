-- =============================================================================
-- Migration 016: add `criterion_text` to task_evidence.
--
-- Evidence was keyed only by `criterion_index` — a positional pointer into
-- the task's acceptance_criteria array. Reordering the criteria silently
-- re-attributed evidence to whatever criterion now sits at that index.
-- Recording the criterion's TEXT at attach time lets a read reconcile by
-- identity: follow the evidence to the criterion it was attached to, even
-- when the array is reordered, and treat it as a true orphan only when that
-- text no longer exists.
--
-- Nullable: rows written before this migration carry NULL and fall back to
-- the positional behaviour, so the change is additive and drift-tolerant.
--
-- Forward-only (see forward-only-migrations memory).
-- =============================================================================

ALTER TABLE task_evidence ADD COLUMN criterion_text TEXT;

INSERT INTO schema_migrations (version, applied_at)
VALUES (16, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
