-- =============================================================================
-- Migration 005: padroniza timestamps em ISO8601 (`YYYY-MM-DDTHH:MM:SS.fffZ`)
--
-- Antes: datetime('now') / datetime('now','subsec') gravava `2026-05-08 14:33:02`
-- (com espaço, sem TZ), que não parseia consistentemente em JS engines e
-- diverge do formato ISO usado no audit log JSONL.
--
-- Mudanças:
-- 1. Normaliza dados existentes em todas as colunas *_at para ISO8601 com Z.
-- 2. Recria triggers que usavam datetime('now') para usar strftime ISO.
-- 3. CREATE TABLE defaults também migram para strftime ISO (apenas safety net —
--    repos sempre passam timestamp explícito via binding desde esta migration).
-- =============================================================================

-- Wrapped in a single transaction so the temporary drop of
-- trg_transitions_no_update (below) and its recreation apply atomically:
-- a crash mid-migration must never leave `transitions` mutable with the
-- append-only guard gone. This migration sets no PRAGMAs (unlike 001), so
-- an explicit transaction is safe. better-sqlite3's exec() runs the
-- BEGIN/COMMIT as part of the script.
BEGIN;

-- =============================================================================
-- 1. Normalização de timestamps existentes
-- Replace ' ' por 'T' e append 'Z' quando ausente.
-- Idempotente: a ` ` LIKE filter evita re-aplicar em strings já normalizadas.
-- =============================================================================

UPDATE projects
   SET created_at = replace(created_at, ' ', 'T') || 'Z'
 WHERE created_at LIKE '% %' AND created_at NOT LIKE '%Z';

UPDATE actors
   SET created_at = replace(created_at, ' ', 'T') || 'Z'
 WHERE created_at LIKE '% %' AND created_at NOT LIKE '%Z';

UPDATE epics
   SET created_at = replace(created_at, ' ', 'T') || 'Z'
 WHERE created_at LIKE '% %' AND created_at NOT LIKE '%Z';
UPDATE epics
   SET closed_at = replace(closed_at, ' ', 'T') || 'Z'
 WHERE closed_at LIKE '% %' AND closed_at NOT LIKE '%Z';

UPDATE sprints
   SET created_at = replace(created_at, ' ', 'T') || 'Z'
 WHERE created_at LIKE '% %' AND created_at NOT LIKE '%Z';
UPDATE sprints
   SET closed_at = replace(closed_at, ' ', 'T') || 'Z'
 WHERE closed_at LIKE '% %' AND closed_at NOT LIKE '%Z';

UPDATE tasks
   SET created_at = replace(created_at, ' ', 'T') || 'Z'
 WHERE created_at LIKE '% %' AND created_at NOT LIKE '%Z';
UPDATE tasks
   SET updated_at = replace(updated_at, ' ', 'T') || 'Z'
 WHERE updated_at LIKE '% %' AND updated_at NOT LIKE '%Z';
UPDATE tasks
   SET closed_at = replace(closed_at, ' ', 'T') || 'Z'
 WHERE closed_at LIKE '% %' AND closed_at NOT LIKE '%Z';
UPDATE tasks
   SET deleted_at = replace(deleted_at, ' ', 'T') || 'Z'
 WHERE deleted_at LIKE '% %' AND deleted_at NOT LIKE '%Z';

-- Transitions are append-only; the trg_transitions_no_update trigger
-- vetoes any UPDATE. Drop temporarily, normalize, recreate.
DROP TRIGGER IF EXISTS trg_transitions_no_update;
UPDATE transitions
   SET at = replace(at, ' ', 'T') || 'Z'
 WHERE at LIKE '% %' AND at NOT LIKE '%Z';
CREATE TRIGGER trg_transitions_no_update
BEFORE UPDATE ON transitions
BEGIN
  SELECT RAISE(ABORT, 'transitions are append-only');
END;

UPDATE notes
   SET at = replace(at, ' ', 'T') || 'Z'
 WHERE at LIKE '% %' AND at NOT LIKE '%Z';
UPDATE notes
   SET deleted_at = replace(deleted_at, ' ', 'T') || 'Z'
 WHERE deleted_at LIKE '% %' AND deleted_at NOT LIKE '%Z';

UPDATE dependencies
   SET created_at = replace(created_at, ' ', 'T') || 'Z'
 WHERE created_at LIKE '% %' AND created_at NOT LIKE '%Z';

UPDATE decisions
   SET at = replace(at, ' ', 'T') || 'Z'
 WHERE at LIKE '% %' AND at NOT LIKE '%Z';
UPDATE decisions
   SET deleted_at = replace(deleted_at, ' ', 'T') || 'Z'
 WHERE deleted_at LIKE '% %' AND deleted_at NOT LIKE '%Z';

UPDATE attachments
   SET at = replace(at, ' ', 'T') || 'Z'
 WHERE at LIKE '% %' AND at NOT LIKE '%Z';
UPDATE attachments
   SET deleted_at = replace(deleted_at, ' ', 'T') || 'Z'
 WHERE deleted_at LIKE '% %' AND deleted_at NOT LIKE '%Z';

UPDATE agent_runs
   SET started_at = replace(started_at, ' ', 'T') || 'Z'
 WHERE started_at LIKE '% %' AND started_at NOT LIKE '%Z';
UPDATE agent_runs
   SET ended_at = replace(ended_at, ' ', 'T') || 'Z'
 WHERE ended_at LIKE '% %' AND ended_at NOT LIKE '%Z';

UPDATE agent_plans
   SET created_at = replace(created_at, ' ', 'T') || 'Z'
 WHERE created_at LIKE '% %' AND created_at NOT LIKE '%Z';
UPDATE agent_plans
   SET started_at = replace(started_at, ' ', 'T') || 'Z'
 WHERE started_at LIKE '% %' AND started_at NOT LIKE '%Z';
UPDATE agent_plans
   SET completed_at = replace(completed_at, ' ', 'T') || 'Z'
 WHERE completed_at LIKE '% %' AND completed_at NOT LIKE '%Z';
UPDATE agent_plans
   SET archived_at = replace(archived_at, ' ', 'T') || 'Z'
 WHERE archived_at LIKE '% %' AND archived_at NOT LIKE '%Z';

UPDATE schema_migrations
   SET applied_at = replace(applied_at, ' ', 'T') || 'Z'
 WHERE applied_at LIKE '% %' AND applied_at NOT LIKE '%Z';

-- =============================================================================
-- 2. Recria triggers que usam datetime('now') para usar strftime ISO
-- =============================================================================

DROP TRIGGER IF EXISTS trg_tasks_updated_at;
CREATE TRIGGER trg_tasks_updated_at
AFTER UPDATE ON tasks
FOR EACH ROW WHEN OLD.updated_at = NEW.updated_at
BEGIN
  UPDATE tasks SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

DROP TRIGGER IF EXISTS trg_archive_plans_on_run_end;
CREATE TRIGGER trg_archive_plans_on_run_end
AFTER UPDATE ON agent_runs
FOR EACH ROW
WHEN NEW.status IN ('completed', 'failed', 'aborted')
     AND OLD.status NOT IN ('completed', 'failed', 'aborted')
BEGIN
  UPDATE agent_plans
     SET archived_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
   WHERE agent_run_id = NEW.id AND archived_at IS NULL;
END;

INSERT INTO schema_migrations (version, applied_at)
VALUES (5, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

COMMIT;
