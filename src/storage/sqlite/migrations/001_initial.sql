-- =============================================================================
-- Migration 001: schema inicial
-- Orquestrador de tarefas com workflow, auditoria, memória e suporte a agentes.
-- =============================================================================

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

-- =============================================================================
-- Projects: raiz de tudo
-- =============================================================================
CREATE TABLE projects (
  id          TEXT PRIMARY KEY,                -- UUID
  key         TEXT NOT NULL UNIQUE,             -- ex: "WEBAPP", prefixo de IDs humanos
  name        TEXT NOT NULL,
  description TEXT,
  config      TEXT NOT NULL DEFAULT '{}',      -- JSON: workflow customizado, settings
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at  TEXT
);

-- =============================================================================
-- Actors: humanos e agentes unificados
-- =============================================================================
CREATE TABLE actors (
  id         TEXT PRIMARY KEY,                  -- UUID
  handle     TEXT NOT NULL UNIQUE,              -- "daniel", "agent:planner"
  kind       TEXT NOT NULL CHECK (kind IN ('human', 'agent')),
  display    TEXT,                              -- nome amigável
  metadata   TEXT NOT NULL DEFAULT '{}',        -- JSON: skills, perms, etc
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE INDEX idx_actors_kind ON actors(kind);

-- =============================================================================
-- Epics: agregador de tasks por tema/feature
-- =============================================================================
CREATE TABLE epics (
  id          TEXT PRIMARY KEY,
  key         TEXT NOT NULL UNIQUE,             -- ex: "WEBAPP-EPIC-3"
  project_id  TEXT NOT NULL REFERENCES projects(id),
  title       TEXT NOT NULL,
  description TEXT,
  state       TEXT NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN', 'CLOSED')),
  metadata    TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at   TEXT,
  deleted_at  TEXT
);

CREATE INDEX idx_epics_project ON epics(project_id);
CREATE INDEX idx_epics_state ON epics(state) WHERE deleted_at IS NULL;

-- =============================================================================
-- Sprints: ciclos de trabalho
-- =============================================================================
CREATE TABLE sprints (
  id          TEXT PRIMARY KEY,
  key         TEXT NOT NULL UNIQUE,             -- ex: "WEBAPP-SPRINT-12"
  project_id  TEXT NOT NULL REFERENCES projects(id),
  name        TEXT NOT NULL,
  goal        TEXT,
  state       TEXT NOT NULL DEFAULT 'PLANNED' CHECK (state IN ('PLANNED', 'ACTIVE', 'CLOSED')),
  starts_at   TEXT,
  ends_at     TEXT,
  capacity    INTEGER,                           -- soma de estimates planejada
  metadata    TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at   TEXT,
  deleted_at  TEXT
);

CREATE INDEX idx_sprints_project ON sprints(project_id);
CREATE UNIQUE INDEX idx_sprints_active ON sprints(project_id) 
  WHERE state = 'ACTIVE' AND deleted_at IS NULL;

-- =============================================================================
-- Tasks: a entidade principal
-- =============================================================================
CREATE TABLE tasks (
  id                   TEXT PRIMARY KEY,
  key                  TEXT NOT NULL UNIQUE,    -- ex: "WEBAPP-42"
  project_id           TEXT NOT NULL REFERENCES projects(id),
  epic_id              TEXT REFERENCES epics(id),
  sprint_id            TEXT REFERENCES sprints(id),
  
  title                TEXT NOT NULL,
  description          TEXT,
  acceptance_criteria  TEXT NOT NULL DEFAULT '[]',  -- JSON array
  
  state                TEXT NOT NULL DEFAULT 'DRAFT' 
    CHECK (state IN ('DRAFT', 'READY', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW', 'DONE', 'CANCELED')),
  
  estimate             INTEGER,                  -- pontos Fibonacci
  priority             INTEGER NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  
  assignee_id          TEXT REFERENCES actors(id),
  reporter_id          TEXT NOT NULL REFERENCES actors(id),
  
  reopen_count         INTEGER NOT NULL DEFAULT 0,
  metadata             TEXT NOT NULL DEFAULT '{}',
  
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at            TEXT,
  deleted_at           TEXT
);

CREATE INDEX idx_tasks_project ON tasks(project_id);
CREATE INDEX idx_tasks_state ON tasks(state) WHERE deleted_at IS NULL;
CREATE INDEX idx_tasks_sprint ON tasks(sprint_id) WHERE sprint_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_tasks_epic ON tasks(epic_id) WHERE epic_id IS NOT NULL;
CREATE INDEX idx_tasks_assignee ON tasks(assignee_id) WHERE assignee_id IS NOT NULL;

-- Trigger pra manter updated_at em sync
CREATE TRIGGER trg_tasks_updated_at
AFTER UPDATE ON tasks
FOR EACH ROW WHEN OLD.updated_at = NEW.updated_at
BEGIN
  UPDATE tasks SET updated_at = datetime('now') WHERE id = NEW.id;
END;

-- =============================================================================
-- Transitions: log append-only de mudanças de estado
-- =============================================================================
CREATE TABLE transitions (
  id            TEXT PRIMARY KEY,
  task_id       TEXT NOT NULL REFERENCES tasks(id),
  from_state    TEXT,                            -- NULL na criação
  to_state      TEXT NOT NULL,
  action        TEXT NOT NULL,                   -- "submit", "start", "block"...
  payload       TEXT NOT NULL DEFAULT '{}',      -- JSON: gates capturados
  
  actor_id      TEXT NOT NULL REFERENCES actors(id),
  agent_run_id  TEXT REFERENCES agent_runs(id),  -- se feito por agente
  
  at            TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
);

CREATE INDEX idx_transitions_task ON transitions(task_id, at);
CREATE INDEX idx_transitions_actor ON transitions(actor_id);
CREATE INDEX idx_transitions_run ON transitions(agent_run_id) WHERE agent_run_id IS NOT NULL;
CREATE INDEX idx_transitions_at ON transitions(at);

-- Bloqueia UPDATE/DELETE: append-only enforcement
CREATE TRIGGER trg_transitions_no_update
BEFORE UPDATE ON transitions
BEGIN
  SELECT RAISE(ABORT, 'transitions are append-only');
END;

CREATE TRIGGER trg_transitions_no_delete
BEFORE DELETE ON transitions
BEGIN
  SELECT RAISE(ABORT, 'transitions cannot be deleted');
END;

-- =============================================================================
-- Notes: anotações tipadas em tasks
-- =============================================================================
CREATE TABLE notes (
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL REFERENCES tasks(id),
  actor_id    TEXT NOT NULL REFERENCES actors(id),
  
  kind        TEXT NOT NULL CHECK (kind IN (
    'comment',
    'block_reason', 'unblock_reason',
    'review_feedback', 'review_approval',
    'cancel_reason', 'reopen_reason',
    'agent_observation'
  )),
  
  content     TEXT NOT NULL,
  metadata    TEXT NOT NULL DEFAULT '{}',
  
  at          TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
  deleted_at  TEXT
);

CREATE INDEX idx_notes_task ON notes(task_id, at);
CREATE INDEX idx_notes_kind ON notes(kind);

-- =============================================================================
-- Dependencies: relacionamentos entre tasks
-- =============================================================================
CREATE TABLE dependencies (
  id              TEXT PRIMARY KEY,
  task_id         TEXT NOT NULL REFERENCES tasks(id),
  blocks_task_id  TEXT NOT NULL REFERENCES tasks(id),
  kind            TEXT NOT NULL DEFAULT 'blocks' CHECK (kind IN (
    'blocks', 'relates_to', 'duplicates', 'parent_of'
  )),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  
  CHECK (task_id != blocks_task_id),
  UNIQUE (task_id, blocks_task_id, kind)
);

CREATE INDEX idx_deps_task ON dependencies(task_id);
CREATE INDEX idx_deps_blocks ON dependencies(blocks_task_id);

-- =============================================================================
-- Decisions: ADRs (Architecture Decision Records)
-- =============================================================================
CREATE TABLE decisions (
  id          TEXT PRIMARY KEY,
  key         TEXT NOT NULL UNIQUE,             -- ex: "ADR-0042"
  project_id  TEXT NOT NULL REFERENCES projects(id),
  
  title       TEXT NOT NULL,
  context     TEXT,                              -- por que essa decisão foi necessária
  decision    TEXT NOT NULL,                     -- o que foi decidido
  rationale   TEXT,                              -- por que essa escolha
  consequences TEXT,                             -- o que decorre disso
  
  status      TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN (
    'proposed', 'accepted', 'rejected', 'superseded'
  )),
  
  superseded_by TEXT REFERENCES decisions(id),
  
  authored_by TEXT NOT NULL REFERENCES actors(id),
  metadata    TEXT NOT NULL DEFAULT '{}',
  
  at          TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at  TEXT
);

CREATE INDEX idx_decisions_project ON decisions(project_id);
CREATE INDEX idx_decisions_status ON decisions(status);

-- Liga decisões a tasks (many-to-many)
CREATE TABLE decision_tasks (
  decision_id TEXT NOT NULL REFERENCES decisions(id),
  task_id     TEXT NOT NULL REFERENCES tasks(id),
  PRIMARY KEY (decision_id, task_id)
);

-- =============================================================================
-- Agent runs: execuções de agentes (multi-agente)
-- =============================================================================
CREATE TABLE agent_runs (
  id              TEXT PRIMARY KEY,
  agent_actor_id  TEXT NOT NULL REFERENCES actors(id),
  parent_run_id   TEXT REFERENCES agent_runs(id),
  invoked_by      TEXT NOT NULL REFERENCES actors(id),  -- humano ou outro agente
  
  goal            TEXT NOT NULL,                 -- prompt/objetivo recebido
  skills_loaded   TEXT NOT NULL DEFAULT '[]',    -- JSON array: skills usadas
  
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'running', 'completed', 'failed', 'aborted'
  )),
  
  result          TEXT,                          -- output final
  error           TEXT,
  metadata        TEXT NOT NULL DEFAULT '{}',
  
  started_at      TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
  ended_at        TEXT,
  
  -- Limite de profundidade pra evitar loops
  depth           INTEGER NOT NULL DEFAULT 0 CHECK (depth <= 5)
);

CREATE INDEX idx_runs_agent ON agent_runs(agent_actor_id);
CREATE INDEX idx_runs_parent ON agent_runs(parent_run_id) WHERE parent_run_id IS NOT NULL;
CREATE INDEX idx_runs_status ON agent_runs(status);
CREATE INDEX idx_runs_started ON agent_runs(started_at);

-- =============================================================================
-- Schema version: pra migrations futuras
-- =============================================================================
CREATE TABLE schema_migrations (
  version    INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO schema_migrations (version) VALUES (1);
