-- =============================================================================
-- Migration 003: agent_plans, identidade dupla, audit fragmentado
-- 
-- Mudanças baseadas nas decisões dos 5 aspectos discutidos:
-- - Aspecto 5: nova tabela agent_plans (separada de tasks)
-- - Aspecto 1: identidade dupla em transitions (actor + via + run)
-- - Aspecto 2: audit_strategy configurável
-- =============================================================================

-- =============================================================================
-- agent_plans: trabalho intra-agente, separado de tasks permanentes
-- =============================================================================
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
);

CREATE INDEX idx_plans_run ON agent_plans(agent_run_id);
CREATE INDEX idx_plans_parent ON agent_plans(parent_plan_id) WHERE parent_plan_id IS NOT NULL;
CREATE INDEX idx_plans_active ON agent_plans(agent_run_id) WHERE archived_at IS NULL;

-- Trigger: ao terminar um agent_run, archive todos os plans associados
CREATE TRIGGER trg_archive_plans_on_run_end
AFTER UPDATE ON agent_runs
FOR EACH ROW
WHEN NEW.status IN ('completed', 'failed', 'aborted') 
     AND OLD.status NOT IN ('completed', 'failed', 'aborted')
BEGIN
  UPDATE agent_plans 
     SET archived_at = datetime('now', 'subsec')
   WHERE agent_run_id = NEW.id AND archived_at IS NULL;
END;

-- =============================================================================
-- transitions: adiciona campo "via" para identidade dupla
-- 
-- Schema original tinha: actor_id (humano OU agente), agent_run_id (opcional)
-- Schema novo:           actor_id (sempre humano responsável), via_actor_id (agente), agent_run_id
-- =============================================================================

-- SQLite não suporta ADD COLUMN com FOREIGN KEY direto em algumas versões.
-- Estratégia: adicionar coluna sem FK e validar via trigger.
ALTER TABLE transitions ADD COLUMN via_actor_id TEXT REFERENCES actors(id);

CREATE INDEX idx_transitions_via ON transitions(via_actor_id) WHERE via_actor_id IS NOT NULL;

-- =============================================================================
-- agent_runs: novos campos pra capturar metadata do MCP client
-- =============================================================================
ALTER TABLE agent_runs ADD COLUMN client_metadata TEXT NOT NULL DEFAULT '{}';
-- client_metadata armazena: pid, hostname, mcp_client_name, etc — pra forense

-- =============================================================================
-- workspace_config: adiciona configurações de audit_strategy
-- =============================================================================
INSERT INTO workspace_config (key, value) VALUES 
  ('audit_strategy', 'recent'),     -- 'full' | 'recent' | 'local'
  ('audit_retention_months', '12'), -- usado em modo 'recent'
  ('enforcement_mode', 'advisory'); -- 'advisory' | 'strict' | 'blocking'

-- =============================================================================
-- Tabela activity_log: NÃO foi criada como tabela SQL.
-- 
-- Atividade efêmera (reads, thinking, errors não-mutantes) é gravada em 
-- arquivo .app/activity.log (rotacionado), NÃO em SQLite.
-- Isso mantém o DB enxuto e foca o SQLite no que é fonte da verdade.
-- =============================================================================

-- Marca migration aplicada
INSERT INTO schema_migrations (version) VALUES (3);
