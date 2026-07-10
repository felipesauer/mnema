-- =============================================================================
-- Migration 025: task claim lease — claimed_by / lease_expires_at
-- =============================================================================
-- Optimistic concurrency (updated_at CAS) only catches a lost write AFTER
-- both sides already decided to act. Two sessions reading the same READY
-- task can each conclude "I'll take this" before either writes — the CAS
-- then picks a winner, but the loser already spent the decision. A lease
-- claimed BEFORE work starts closes that window. Whether the start action
-- actually requires an active, non-expired claim by the calling actor is
-- opt-in via the `claims.require_to_start` config flag (default off, so a
-- single-agent flow starts work without claiming first); the flag is
-- enforced in TaskService.transition.
--
-- lease_expires_at makes the lease self-healing: a session that dies without
-- releasing (crash, killed subagent, dropped MCP connection) does not leave
-- the task claimed forever — once the lease has passed, any actor's claim
-- attempt is treated the same as an unclaimed task. This mirrors
-- aging.orphan_run_after_hours, which self-heals a run left running with no
-- agent_run_end.
--
-- Nullable: rows written before this migration carry NULL, which is the same
-- state as "no active claim" — no backfill needed.
--
-- Additive columns → runs inside Database.exec's implicit transaction.

ALTER TABLE tasks ADD COLUMN claimed_by TEXT REFERENCES actors(id);
ALTER TABLE tasks ADD COLUMN lease_expires_at TEXT;

-- Scoped to active claims only, mirroring idx_tasks_assignee — a claim
-- lookup only ever cares about tasks currently held.
CREATE INDEX idx_tasks_claimed_by ON tasks(claimed_by) WHERE claimed_by IS NOT NULL;

INSERT INTO schema_migrations (version, applied_at)
VALUES (25, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
