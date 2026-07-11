-- =============================================================================
-- Migration 033: first-class git link on tasks (MNEMA-ADR-49).
--
-- The task↔branch↔PR↔commit link was manual (commit evidence attached by
-- hand) and not queryable. These columns make the graph first-class so an
-- opt-in git-observing `mnema watch --git` can populate it and task_show can
-- surface it.
--
-- `git_branch`  — the branch this task's work lives on, or NULL.
-- `git_commits` — JSON array of {sha, subject} for commits linked to the task.
--                 Defaults to '[]'.
-- `git_pr`      — JSON object {url, state} for the task's PR, or NULL.
--
-- ADDITIVE and nullable/defaulted: every existing task reads exactly as
-- before (no branch, empty commits, no PR). Populated only when the opt-in
-- observer runs; the feature is off by default (ADR-49).
--
-- Forward-only (see forward-only-migrations memory).
-- =============================================================================

ALTER TABLE tasks ADD COLUMN git_branch TEXT;
ALTER TABLE tasks ADD COLUMN git_commits TEXT NOT NULL DEFAULT '[]';
ALTER TABLE tasks ADD COLUMN git_pr TEXT;

INSERT INTO schema_migrations (version, applied_at)
VALUES (33, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
