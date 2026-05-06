-- =============================================================================
-- Migration 002: FTS5, anexos e ajustes para multi-projeto
-- =============================================================================

-- =============================================================================
-- Workspace mode: tabela de configuração global
-- Quando o banco é compartilhado entre projetos, essa tabela define o modo
-- =============================================================================
CREATE TABLE workspace_config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO workspace_config (key, value) VALUES 
  ('mode', 'single'),                  -- 'single' (1 projeto) ou 'multi'
  ('schema_version', '2');

-- =============================================================================
-- Attachments: arquivos anexados a tasks, notas ou decisões
-- =============================================================================
CREATE TABLE attachments (
  id           TEXT PRIMARY KEY,
  
  -- Polimórfico: aponta pra task OR note OR decision
  parent_kind  TEXT NOT NULL CHECK (parent_kind IN ('task', 'note', 'decision')),
  parent_id    TEXT NOT NULL,
  
  filename     TEXT NOT NULL,             -- nome original do arquivo
  path         TEXT NOT NULL,             -- path relativo dentro de .app/attachments/
  mime         TEXT NOT NULL,
  size         INTEGER NOT NULL CHECK (size >= 0),
  hash         TEXT NOT NULL,             -- SHA-256, permite dedup
  
  uploaded_by  TEXT NOT NULL REFERENCES actors(id),
  metadata     TEXT NOT NULL DEFAULT '{}',
  
  at           TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at   TEXT
);

CREATE INDEX idx_attach_parent ON attachments(parent_kind, parent_id);
CREATE INDEX idx_attach_hash ON attachments(hash);

-- =============================================================================
-- Full-Text Search (FTS5)
-- Tabelas virtuais sincronizadas via triggers
-- =============================================================================

-- FTS para tasks: title + description + acceptance_criteria
CREATE VIRTUAL TABLE tasks_fts USING fts5(
  task_id UNINDEXED,
  project_id UNINDEXED,
  title,
  description,
  acceptance_criteria,
  tokenize = "unicode61 remove_diacritics 2"
);

-- FTS para notes
CREATE VIRTUAL TABLE notes_fts USING fts5(
  note_id UNINDEXED,
  task_id UNINDEXED,
  kind UNINDEXED,
  content,
  tokenize = "unicode61 remove_diacritics 2"
);

-- FTS para decisions: title + context + decision + rationale
CREATE VIRTUAL TABLE decisions_fts USING fts5(
  decision_id UNINDEXED,
  project_id UNINDEXED,
  title,
  context,
  decision,
  rationale,
  tokenize = "unicode61 remove_diacritics 2"
);

-- =============================================================================
-- Triggers de sync FTS: tasks
-- =============================================================================
CREATE TRIGGER trg_tasks_fts_insert AFTER INSERT ON tasks BEGIN
  INSERT INTO tasks_fts (task_id, project_id, title, description, acceptance_criteria)
  VALUES (NEW.id, NEW.project_id, NEW.title, COALESCE(NEW.description, ''), NEW.acceptance_criteria);
END;

CREATE TRIGGER trg_tasks_fts_update AFTER UPDATE ON tasks 
WHEN OLD.title != NEW.title 
  OR COALESCE(OLD.description, '') != COALESCE(NEW.description, '')
  OR OLD.acceptance_criteria != NEW.acceptance_criteria
BEGIN
  DELETE FROM tasks_fts WHERE task_id = OLD.id;
  INSERT INTO tasks_fts (task_id, project_id, title, description, acceptance_criteria)
  VALUES (NEW.id, NEW.project_id, NEW.title, COALESCE(NEW.description, ''), NEW.acceptance_criteria);
END;

CREATE TRIGGER trg_tasks_fts_delete AFTER DELETE ON tasks BEGIN
  DELETE FROM tasks_fts WHERE task_id = OLD.id;
END;

-- =============================================================================
-- Triggers de sync FTS: notes
-- =============================================================================
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

-- =============================================================================
-- Triggers de sync FTS: decisions
-- =============================================================================
CREATE TRIGGER trg_decisions_fts_insert AFTER INSERT ON decisions BEGIN
  INSERT INTO decisions_fts (decision_id, project_id, title, context, decision, rationale)
  VALUES (NEW.id, NEW.project_id, NEW.title, 
          COALESCE(NEW.context, ''), NEW.decision, COALESCE(NEW.rationale, ''));
END;

CREATE TRIGGER trg_decisions_fts_update AFTER UPDATE ON decisions
WHEN OLD.title != NEW.title 
  OR COALESCE(OLD.context, '') != COALESCE(NEW.context, '')
  OR OLD.decision != NEW.decision
  OR COALESCE(OLD.rationale, '') != COALESCE(NEW.rationale, '')
BEGIN
  DELETE FROM decisions_fts WHERE decision_id = OLD.id;
  INSERT INTO decisions_fts (decision_id, project_id, title, context, decision, rationale)
  VALUES (NEW.id, NEW.project_id, NEW.title,
          COALESCE(NEW.context, ''), NEW.decision, COALESCE(NEW.rationale, ''));
END;

CREATE TRIGGER trg_decisions_fts_delete AFTER DELETE ON decisions BEGIN
  DELETE FROM decisions_fts WHERE decision_id = OLD.id;
END;

-- Marca migration aplicada
INSERT INTO schema_migrations (version) VALUES (2);
