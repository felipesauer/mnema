-- =============================================================================
-- Migration 006: extends `notes.kind` enum to include `scope_change`
-- and `acceptance_addendum` for richer mid-flight task annotations.
--
-- Phase B' (cv-fmt + dev4 via MCP) showed that agents reach for
-- `agent_observation` to log scope deviations. That kind is fine but
-- semantically blurs into "any side observation". Adding two specific
-- kinds gives the audit log clearer intent for a common annotation
-- pattern, without forcing agents to change behaviour (they can keep
-- using `agent_observation` for everything else).
--
-- SQLite cannot alter a CHECK constraint in place, so the table is
-- rebuilt with the recipe used elsewhere in the codebase: drop FK
-- check, build a copy, swap names, restore triggers.
-- =============================================================================

-- mnema:disable-foreign-keys

BEGIN;

-- Drop dependent triggers + indexes before rebuilding the table.
DROP TRIGGER IF EXISTS trg_notes_fts_insert;
DROP TRIGGER IF EXISTS trg_notes_fts_update;
DROP TRIGGER IF EXISTS trg_notes_fts_delete;
DROP INDEX IF EXISTS idx_notes_task;
DROP INDEX IF EXISTS idx_notes_kind;

-- Build the new table shape with the extended enum.
CREATE TABLE notes_new (
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL REFERENCES tasks(id),
  actor_id    TEXT NOT NULL REFERENCES actors(id),

  kind        TEXT NOT NULL CHECK (kind IN (
    'comment',
    'block_reason', 'unblock_reason',
    'review_feedback', 'review_approval',
    'cancel_reason', 'reopen_reason',
    'agent_observation',
    'scope_change',
    'acceptance_addendum'
  )),

  content     TEXT NOT NULL,
  metadata    TEXT NOT NULL DEFAULT '{}',

  at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at  TEXT
);

INSERT INTO notes_new (id, task_id, actor_id, kind, content, metadata, at, deleted_at)
SELECT id, task_id, actor_id, kind, content, metadata, at, deleted_at FROM notes;

DROP TABLE notes;
ALTER TABLE notes_new RENAME TO notes;

-- Recreate indexes.
CREATE INDEX idx_notes_task ON notes(task_id, at);
CREATE INDEX idx_notes_kind ON notes(kind);

-- Recreate FTS sync triggers (mirroring 002_fts_attachments.sql).
CREATE TRIGGER trg_notes_fts_insert AFTER INSERT ON notes BEGIN
  INSERT INTO notes_fts (note_id, task_id, kind, content)
  VALUES (NEW.id, NEW.task_id, NEW.kind, NEW.content);
END;

CREATE TRIGGER trg_notes_fts_update AFTER UPDATE ON notes
WHEN OLD.content != NEW.content
BEGIN
  DELETE FROM notes_fts WHERE note_id = OLD.id;
  INSERT INTO notes_fts (note_id, task_id, kind, content)
  VALUES (NEW.id, NEW.task_id, NEW.kind, NEW.content);
END;

CREATE TRIGGER trg_notes_fts_delete AFTER DELETE ON notes BEGIN
  DELETE FROM notes_fts WHERE note_id = OLD.id;
END;

INSERT INTO schema_migrations (version, applied_at)
VALUES (6, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

COMMIT;
