-- =============================================================================
-- Migration 001: baseline
--
-- The single hand-curated baseline of the 0.1.0-beta line: the final shape
-- the previous 36 forward-only migrations produced, squashed. state.db is
-- git-ignored and rebuilt from the committed markdown + audit JSONL on every
-- clone, so no adopter carries an old-versioned database — a fresh clone runs
-- only this file. Forward-only migrations continue AFTER this baseline
-- (schema integrity is the invariant, not behaviour preservation).
--
-- Deliberate differences from the replayed 036 schema:
--   * workspace_config is gone (dead first-generation multi-project idea)
--   * applied_remediations became applied_upgrades (the upgrade-script
--     ledger contract for the beta upgrade runner)
-- =============================================================================

CREATE TABLE schema_migrations (
  version    INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE actors (
  id         TEXT PRIMARY KEY,                  -- UUID
  handle     TEXT NOT NULL UNIQUE,              -- "daniel", "agent:planner"
  kind       TEXT NOT NULL CHECK (kind IN ('human', 'agent')),
  display    TEXT,                              -- nome amigável
  metadata   TEXT NOT NULL DEFAULT '{}',        -- JSON: skills, perms, etc
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE TABLE agent_plans (
  id              TEXT PRIMARY KEY,
  agent_run_id    TEXT NOT NULL REFERENCES agent_runs(id),
  parent_plan_id  TEXT REFERENCES agent_plans(id),
  
  content         TEXT NOT NULL,        -- descrição do passo
  state           TEXT NOT NULL DEFAULT 'pending' 
                  CHECK (state IN ('pending', 'in_progress', 'completed', 'skipped', 'failed')),
  result          TEXT,                  -- output, achados, links pra arquivos modificados
  
  position        INTEGER NOT NULL DEFAULT 0,  -- ordem dentro do mesmo nível
  depth           INTEGER NOT NULL DEFAULT 0 CHECK (depth <= 5),
  
  metadata        TEXT NOT NULL DEFAULT '{}',
  
  started_at      TEXT,
  completed_at    TEXT,
  archived_at     TEXT,                  -- setado quando agent_run termina (D2: auto-archive)
  
  created_at      TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
, task_id TEXT REFERENCES tasks(id));

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
, client_metadata TEXT NOT NULL DEFAULT '{}');

CREATE TABLE anchors (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  -- The chain_head_hash this anchor covers (hex).
  head_hash     TEXT NOT NULL,
  -- The provider that produced this anchor (none never persists a row).
  provider      TEXT NOT NULL,
  -- pending: submitted, not yet confirmable (retry/upgrade later).
  -- anchored: confirmed and independently verifiable.
  -- failed: the stamp attempt failed (fail-open — the write still stood).
  status        TEXT NOT NULL CHECK (status IN ('pending', 'anchored', 'failed')),
  -- Serialized, provider-specific proof (an .ots blob, a commit sha, a TSA
  -- token). NULL while pending with no proof yet.
  receipt       TEXT,
  -- When the anchor was first recorded.
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  -- When it moved to 'anchored' (NULL until confirmed).
  confirmed_at  TEXT, event_count_at INTEGER,
  -- One anchor per (head, provider); re-stamping upserts on this pair.
  UNIQUE (head_hash, provider)
);

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

CREATE TABLE audit_head_signature (
  -- Always 1 row. The CHECK keeps it that way, mirroring audit_state.
  id                  INTEGER PRIMARY KEY CHECK (id = 1),
  -- The chain_head_hash this signature covers (hex).
  covered_head_hash   TEXT NOT NULL,
  -- event_count at the moment of signing — lets a verifier tell whether the
  -- head has advanced past the last signed checkpoint.
  event_count_at      INTEGER NOT NULL,
  -- Resolved actor handle that owns the signing key.
  signer_actor        TEXT NOT NULL,
  -- sha256(SPKI DER) of the signer's public key — routes to the committed
  -- .mnema/keys/<actor>.<fp12>.pub for verification.
  signer_fingerprint  TEXT NOT NULL,
  -- Base64 Ed25519 signature over the covered head hash bytes.
  signature           TEXT NOT NULL,
  -- ISO8601 wall-clock of signing.
  signed_at           TEXT NOT NULL
);

CREATE TABLE audit_state (
  -- Always 1 row (`id = 1`). The CHECK keeps it that way.
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  event_count     INTEGER NOT NULL DEFAULT 0,
  last_event_at   TEXT,
  chain_head_hash TEXT,
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE decision_tasks (
  decision_id TEXT NOT NULL REFERENCES decisions(id),
  task_id     TEXT NOT NULL REFERENCES tasks(id),
  PRIMARY KEY (decision_id, task_id)
);

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
, updated_at TEXT, impacts TEXT NOT NULL DEFAULT '[]');

CREATE VIRTUAL TABLE decisions_fts USING fts5(
  decision_id UNINDEXED,
  project_id UNINDEXED,
  title,
  context,
  decision,
  rationale,
  tokenize = "unicode61 remove_diacritics 2"
);

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

CREATE TABLE labels (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

  UNIQUE (name)
);

CREATE TABLE memories (
  id          TEXT PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  content     TEXT NOT NULL,
  topics      TEXT NOT NULL DEFAULT '[]',
  created_by  TEXT NOT NULL REFERENCES actors(id),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
, archived_at TEXT, superseded_by TEXT, obsoleted_by TEXT, scope TEXT);

CREATE VIRTUAL TABLE memories_fts USING fts5(
  memory_id UNINDEXED,
  slug,
  title,
  content,
  tokenize = "unicode61 remove_diacritics 2"
);

CREATE TABLE "notes" (
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

CREATE VIRTUAL TABLE notes_fts USING fts5(
  note_id UNINDEXED,
  task_id UNINDEXED,
  kind UNINDEXED,
  content,
  tokenize = "unicode61 remove_diacritics 2"
);

CREATE TABLE observations (
  id               TEXT PRIMARY KEY,
  content          TEXT NOT NULL,
  topics           TEXT NOT NULL DEFAULT '[]',
  related_task_id  TEXT REFERENCES tasks(id),
  created_by       TEXT NOT NULL REFERENCES actors(id),
  at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
, archived_at TEXT);

CREATE VIRTUAL TABLE observations_fts USING fts5(
  observation_id UNINDEXED,
  content,
  tokenize = "unicode61 remove_diacritics 2"
);

CREATE TABLE projects (
  id          TEXT PRIMARY KEY,                -- UUID
  key         TEXT NOT NULL UNIQUE,             -- ex: "WEBAPP", prefixo de IDs humanos
  name        TEXT NOT NULL,
  description TEXT,
  config      TEXT NOT NULL DEFAULT '{}',      -- JSON: workflow customizado, settings
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at  TEXT
);

CREATE TABLE "provenance_links" (
  id           TEXT PRIMARY KEY,
  source_kind  TEXT NOT NULL CHECK (source_kind IN ('observation', 'note', 'decision', 'memory', 'skill')),
  source_ref   TEXT NOT NULL,
  target_kind  TEXT NOT NULL CHECK (target_kind IN ('observation', 'note', 'decision', 'memory', 'skill')),
  target_ref   TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

  UNIQUE (source_kind, source_ref, target_kind, target_ref)
);

CREATE TABLE skills (
  id            TEXT PRIMARY KEY,
  slug          TEXT NOT NULL,
  name          TEXT NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1,
  description   TEXT NOT NULL,
  content       TEXT NOT NULL,
  tools_used    TEXT NOT NULL DEFAULT '[]',
  usage_count   INTEGER NOT NULL DEFAULT 0,
  last_used_at  TEXT,
  created_by    TEXT NOT NULL REFERENCES actors(id),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), invocable INTEGER NOT NULL DEFAULT 0, dynamic_context TEXT NOT NULL DEFAULT '[]', superseded_by TEXT, change_rationale TEXT, scope TEXT, content_core TEXT, content_examples TEXT,
  UNIQUE(slug, version)
);

CREATE VIRTUAL TABLE skills_fts USING fts5(
  skill_id UNINDEXED,
  slug UNINDEXED,
  version UNINDEXED,
  name,
  description,
  content_core,
  content_examples,
  tokenize = "unicode61 remove_diacritics 2"
);

CREATE TABLE sprint_metrics (
  id          TEXT PRIMARY KEY,
  sprint_id   TEXT NOT NULL REFERENCES sprints(id),
  name        TEXT NOT NULL,
  baseline    REAL,
  target      REAL NOT NULL,
  unit        TEXT,
  due_date    TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

  UNIQUE (sprint_id, name)
);

CREATE TABLE "sprints" (
  id          TEXT PRIMARY KEY,
  key         TEXT NOT NULL UNIQUE,
  project_id  TEXT NOT NULL REFERENCES projects(id),
  name        TEXT NOT NULL,
  goal        TEXT,
  state       TEXT NOT NULL DEFAULT 'PLANNED' CHECK (state IN ('PLANNED', 'ACTIVE', 'CLOSED', 'CANCELED')),
  starts_at   TEXT,
  ends_at     TEXT,
  capacity    INTEGER,
  metadata    TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at   TEXT,
  deleted_at  TEXT,
  updated_at  TEXT
);

CREATE TABLE task_evidence (
  id               TEXT PRIMARY KEY,
  task_id          TEXT NOT NULL REFERENCES tasks(id),
  criterion_index  INTEGER NOT NULL,
  kind             TEXT NOT NULL DEFAULT 'other' CHECK (kind IN (
    'test', 'route', 'commit', 'doc', 'url', 'other'
  )),
  ref              TEXT NOT NULL,
  note             TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), criterion_text TEXT,

  UNIQUE (task_id, criterion_index, kind, ref)
);

CREATE TABLE task_labels (
  task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  label_id    TEXT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

  PRIMARY KEY (task_id, label_id)
);

CREATE TABLE "tasks" (
  id                   TEXT PRIMARY KEY,
  key                  TEXT NOT NULL UNIQUE,
  project_id           TEXT NOT NULL REFERENCES projects(id),
  epic_id              TEXT REFERENCES epics(id),
  sprint_id            TEXT REFERENCES sprints(id),

  title                TEXT NOT NULL,
  description          TEXT,
  acceptance_criteria  TEXT NOT NULL DEFAULT '[]',

  state                TEXT NOT NULL DEFAULT 'DRAFT',

  estimate             INTEGER,
  priority             INTEGER NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),

  assignee_id          TEXT REFERENCES actors(id),
  reporter_id          TEXT NOT NULL REFERENCES actors(id),

  reopen_count         INTEGER NOT NULL DEFAULT 0,
  metadata             TEXT NOT NULL DEFAULT '{}',

  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at            TEXT,
  deleted_at           TEXT
, context_budget INTEGER, claimed_by TEXT REFERENCES actors(id), lease_expires_at TEXT, git_branch TEXT, git_commits TEXT NOT NULL DEFAULT '[]', git_pr TEXT);

CREATE VIRTUAL TABLE tasks_fts USING fts5(
  task_id UNINDEXED,
  project_id UNINDEXED,
  title,
  description,
  acceptance_criteria,
  tokenize = "unicode61 remove_diacritics 2"
);

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
, via_actor_id TEXT REFERENCES actors(id));

CREATE INDEX idx_actors_kind ON actors(kind);

CREATE INDEX idx_anchors_status ON anchors (status);

CREATE INDEX idx_attach_hash ON attachments(hash);

CREATE INDEX idx_attach_parent ON attachments(parent_kind, parent_id);

CREATE INDEX idx_decisions_project ON decisions(project_id);

CREATE INDEX idx_decisions_status ON decisions(status);

CREATE INDEX idx_deps_blocks ON dependencies(blocks_task_id);

CREATE INDEX idx_deps_task ON dependencies(task_id);

CREATE INDEX idx_epics_project ON epics(project_id);

CREATE INDEX idx_epics_state ON epics(state) WHERE deleted_at IS NULL;

CREATE INDEX idx_memories_slug ON memories(slug);

CREATE INDEX idx_notes_kind ON notes(kind);

CREATE INDEX idx_notes_task ON notes(task_id, at);

CREATE INDEX idx_observations_at ON observations(at);

CREATE INDEX idx_observations_task ON observations(related_task_id);

CREATE INDEX idx_plans_active ON agent_plans(agent_run_id) WHERE archived_at IS NULL;

CREATE INDEX idx_plans_parent ON agent_plans(parent_plan_id) WHERE parent_plan_id IS NOT NULL;

CREATE INDEX idx_plans_run ON agent_plans(agent_run_id);

CREATE INDEX idx_plans_task ON agent_plans(task_id) WHERE task_id IS NOT NULL;

CREATE INDEX idx_prov_source ON provenance_links(source_kind, source_ref);

CREATE INDEX idx_prov_target ON provenance_links(target_kind, target_ref);

CREATE INDEX idx_runs_agent ON agent_runs(agent_actor_id);

CREATE INDEX idx_runs_parent ON agent_runs(parent_run_id) WHERE parent_run_id IS NOT NULL;

CREATE INDEX idx_runs_started ON agent_runs(started_at);

CREATE INDEX idx_runs_status ON agent_runs(status);

CREATE INDEX idx_skills_slug ON skills(slug, version DESC);

CREATE INDEX idx_sprint_metrics_sprint ON sprint_metrics(sprint_id);

CREATE UNIQUE INDEX idx_sprints_active ON sprints(project_id)
  WHERE state = 'ACTIVE' AND deleted_at IS NULL;

CREATE INDEX idx_sprints_project ON sprints(project_id);

CREATE INDEX idx_task_evidence_task ON task_evidence(task_id);

CREATE INDEX idx_task_labels_label ON task_labels(label_id);

CREATE INDEX idx_task_labels_task ON task_labels(task_id);

CREATE INDEX idx_tasks_assignee ON tasks(assignee_id) WHERE assignee_id IS NOT NULL;

CREATE INDEX idx_tasks_claimed_by ON tasks(claimed_by) WHERE claimed_by IS NOT NULL;

CREATE INDEX idx_tasks_epic ON tasks(epic_id) WHERE epic_id IS NOT NULL;

CREATE INDEX idx_tasks_project ON tasks(project_id);

CREATE INDEX idx_tasks_sprint ON tasks(sprint_id) WHERE sprint_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX idx_tasks_state ON tasks(state) WHERE deleted_at IS NULL;

CREATE INDEX idx_tasks_title
  ON tasks(project_id, title)
  WHERE deleted_at IS NULL;

CREATE INDEX idx_transitions_actor ON transitions(actor_id);

CREATE INDEX idx_transitions_at ON transitions(at);

CREATE INDEX idx_transitions_run ON transitions(agent_run_id) WHERE agent_run_id IS NOT NULL;

CREATE INDEX idx_transitions_task ON transitions(task_id, at);

CREATE INDEX idx_transitions_via ON transitions(via_actor_id) WHERE via_actor_id IS NOT NULL;

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

CREATE TRIGGER trg_decisions_fts_delete AFTER DELETE ON decisions BEGIN
  DELETE FROM decisions_fts WHERE decision_id = OLD.id;
END;

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

CREATE TRIGGER trg_memories_fts_delete AFTER DELETE ON memories BEGIN
  DELETE FROM memories_fts WHERE memory_id = OLD.id;
END;

CREATE TRIGGER trg_memories_fts_insert AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts (memory_id, slug, title, content)
  VALUES (NEW.id, NEW.slug, NEW.title, NEW.content);
END;

CREATE TRIGGER trg_memories_fts_update AFTER UPDATE ON memories
WHEN OLD.title != NEW.title OR OLD.content != NEW.content
BEGIN
  DELETE FROM memories_fts WHERE memory_id = OLD.id;
  INSERT INTO memories_fts (memory_id, slug, title, content)
  VALUES (NEW.id, NEW.slug, NEW.title, NEW.content);
END;

CREATE TRIGGER trg_notes_fts_delete AFTER DELETE ON notes BEGIN
  DELETE FROM notes_fts WHERE note_id = OLD.id;
END;

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

CREATE TRIGGER trg_observations_fts_delete AFTER DELETE ON observations BEGIN
  DELETE FROM observations_fts WHERE observation_id = OLD.id;
END;

CREATE TRIGGER trg_observations_fts_insert AFTER INSERT ON observations BEGIN
  INSERT INTO observations_fts (observation_id, content)
  VALUES (NEW.id, NEW.content);
END;

CREATE TRIGGER trg_observations_fts_update AFTER UPDATE ON observations
WHEN OLD.content != NEW.content
BEGIN
  DELETE FROM observations_fts WHERE observation_id = OLD.id;
  INSERT INTO observations_fts (observation_id, content) VALUES (NEW.id, NEW.content);
END;

CREATE TRIGGER trg_skills_fts_delete AFTER DELETE ON skills BEGIN
  DELETE FROM skills_fts WHERE skill_id = OLD.id;
END;

CREATE TRIGGER trg_skills_fts_insert AFTER INSERT ON skills BEGIN
  INSERT INTO skills_fts (skill_id, slug, version, name, description, content_core, content_examples)
  VALUES (NEW.id, NEW.slug, NEW.version, NEW.name, NEW.description,
          NEW.content_core, NEW.content_examples);
END;

CREATE TRIGGER trg_skills_fts_update AFTER UPDATE ON skills
WHEN OLD.name != NEW.name
  OR OLD.description != NEW.description
  OR OLD.content_core IS NOT NEW.content_core
  OR OLD.content_examples IS NOT NEW.content_examples
BEGIN
  DELETE FROM skills_fts WHERE skill_id = OLD.id;
  INSERT INTO skills_fts (skill_id, slug, version, name, description, content_core, content_examples)
  VALUES (NEW.id, NEW.slug, NEW.version, NEW.name, NEW.description,
          NEW.content_core, NEW.content_examples);
END;

CREATE TRIGGER trg_tasks_fts_delete AFTER DELETE ON tasks BEGIN
  DELETE FROM tasks_fts WHERE task_id = OLD.id;
END;

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

CREATE TRIGGER trg_tasks_updated_at
AFTER UPDATE ON tasks
FOR EACH ROW WHEN OLD.updated_at = NEW.updated_at
BEGIN
  UPDATE tasks SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = NEW.id;
END;

CREATE TRIGGER trg_transitions_no_delete
BEFORE DELETE ON transitions
BEGIN
  SELECT RAISE(ABORT, 'transitions cannot be deleted');
END;

CREATE TRIGGER trg_transitions_no_update
BEFORE UPDATE ON transitions
BEGIN
  SELECT RAISE(ABORT, 'transitions are append-only');
END;

-- The applied-upgrades ledger: run-once-and-record lifecycle for the
-- one-shot upgrade steps `mnema upgrade` runs (the successor of the
-- remediation ledger). `script` is the step's stable name; `version` is
-- the version window a script belongs to (NULL for always-on
-- clone-condition steps, which need no ledger row but may record one).
CREATE TABLE applied_upgrades (
  script     TEXT PRIMARY KEY,
  version    TEXT,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Seed the audit_state singleton (always exactly one row, id = 1).
INSERT INTO audit_state (id, event_count) VALUES (1, 0);

INSERT INTO schema_migrations (version, applied_at)
VALUES (1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
