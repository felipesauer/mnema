-- =============================================================================
-- Adds an optional `task_id` FK on `agent_plans` linking a plan to the
-- task it implements.
--
-- Without this column agents encode the task key inside
-- `agent_plans.content` ("CVF-1: implement schema") because there is
-- no structural link. That works but needs manual parsing during
-- audit reconstruction via `mnema agent inspect`. The FK makes the
-- linkage queryable and lets `agent inspect` render the plan tree
-- alongside the matching task transitions automatically.
-- =============================================================================

ALTER TABLE agent_plans ADD COLUMN task_id TEXT REFERENCES tasks(id);

CREATE INDEX idx_plans_task ON agent_plans(task_id) WHERE task_id IS NOT NULL;

INSERT INTO schema_migrations (version, applied_at)
VALUES (7, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
