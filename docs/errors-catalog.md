# Mnema — Catálogo de Erros

> **Status:** v1.0 · 2026-04-30
> **Audiência:** desenvolvedores implementando Mnema, agentes de IA gerando código
> **Propósito:** mensagens consistentes pro usuário, erros estruturados pro LLM

Cada erro tem três representações:

1. **Código TS** (`E_*`) — constante usada no código
2. **Mensagem humana** — saída no CLI quando erro ocorre
3. **Erro estruturado** — JSON retornado em response MCP

---

## Convenções

### Mensagem humana
- Não termina com ponto final (estilo Unix)
- Usa cor vermelha pro código, normal pra mensagem, dim pra hint
- Hint começa com verbo no imperativo: "Run...", "Set...", "Check..."
- Não revela paths absolutos completos quando possível (privacidade)

### Erro estruturado
- `error` é SCREAMING_SNAKE_CASE
- Campos adicionais em snake_case
- Sempre inclui `message` humana resumida (sem hint)

### Exit codes (CLI)
- `0` — sucesso
- `1` — erro genérico
- `2` — erro de configuração/uso (recuperável pelo usuário)
- `3` — erro de estado (precisa de ação como migrate)
- `4` — conflito (precisa de retry)
- `5` — erro interno (bug)

---

## 1. Configuração

### E_CONFIG_NOT_FOUND
**Quando:** comando rodado fora de projeto Mnema
**Mensagem CLI:**
```
mnema.config.json not found in /home/daniel/code/myproj or any parent directory
hint: Run `mnema init` to create a new project
```
**MCP:**
```json
{ "error": "CONFIG_NOT_FOUND", "current_dir": "/home/daniel/code/myproj", "message": "Mnema config not found" }
```
**Exit code:** 2

### E_CONFIG_INVALID
**Quando:** `mnema.config.json` malformado ou viola schema
**Mensagem CLI:**
```
mnema.config.json is invalid: project.key must match pattern ^[A-Z][A-Z0-9]{1,9}$
hint: Check the schema at https://mnema.dev/docs/config
```
**MCP:**
```json
{ "error": "CONFIG_INVALID", "issues": [{"path": "project.key", "message": "..."}], "message": "..." }
```
**Exit code:** 2

### E_VERSION_MISMATCH
**Quando:** `mnema_version` no config não satisfeito pela versão instalada
**Mensagem CLI:**
```
Project requires mnema ^1.2.0, but you have 1.1.5
hint: Update with `npm i -g @saurim/mnema@latest`, or pass `--no-version-check` to bypass
```
**MCP:**
```json
{ "error": "VERSION_MISMATCH", "required": "^1.2.0", "current": "1.1.5", "message": "..." }
```
**Exit code:** 3

---

## 2. Tasks e transições

### E_TASK_NOT_FOUND
**Quando:** key referenciada não existe (ou foi soft-deleted)
**Mensagem CLI:**
```
Task WEBAPP-42 not found
hint: List existing tasks with `mnema task list`
```
**MCP:**
```json
{ "error": "TASK_NOT_FOUND", "task_key": "WEBAPP-42", "message": "Task not found" }
```
**Exit code:** 2

### E_GATE_FAILED
**Quando:** payload da transição não satisfaz `requires` do gate
**Mensagem CLI:**
```
Cannot submit WEBAPP-42: missing required fields
  - title: must be at least 3 characters
  - acceptance_criteria: must have at least 1 item
hint: Add the missing fields and try again
```
**MCP:**
```json
{
  "error": "GATE_FAILED",
  "task_key": "WEBAPP-42",
  "action": "submit",
  "issues": [
    { "field": "title", "rule": "min_length", "expected": 3, "actual": 1 },
    { "field": "acceptance_criteria", "rule": "min_items", "expected": 1, "actual": 0 }
  ],
  "missing": ["title", "acceptance_criteria"],
  "message": "Required fields missing or invalid"
}
```
**Exit code:** 2

### E_INVALID_TRANSITION
**Quando:** ação não é válida pro estado atual
**Mensagem CLI:**
```
Cannot start WEBAPP-42: task is in DONE state
hint: Available actions from DONE: reopen
```
**MCP:**
```json
{
  "error": "INVALID_TRANSITION",
  "task_key": "WEBAPP-42",
  "from_state": "DONE",
  "action": "start",
  "available_actions": ["reopen"],
  "message": "Action not allowed from current state"
}
```
**Exit code:** 2

### E_CONFLICT
**Quando:** task foi modificada por outro processo (versionamento otimista)
**Mensagem CLI:**
```
Task WEBAPP-42 was modified by another process
hint: Re-read with `mnema task show WEBAPP-42` and try again
```
**MCP:**
```json
{
  "error": "CONFLICT",
  "task_key": "WEBAPP-42",
  "expected_updated_at": "2026-04-30T14:23:05.123Z",
  "current_updated_at": "2026-04-30T14:23:08.456Z",
  "message": "Task was modified concurrently — re-read and retry"
}
```
**Exit code:** 4

### E_DUPLICATE_KEY
**Quando:** tentativa de criar task com key já existente
**Mensagem CLI:**
```
Task WEBAPP-42 already exists
hint: Show with `mnema task show WEBAPP-42`
```
**MCP:**
```json
{ "error": "DUPLICATE_KEY", "task_key": "WEBAPP-42", "message": "Task with this key exists" }
```
**Exit code:** 2

### E_TASK_DELETED
**Quando:** operação em task soft-deleted
**Mensagem CLI:**
```
Task WEBAPP-42 was deleted
hint: Restore with `mnema task restore WEBAPP-42` if available
```
**Exit code:** 2

---

## 3. Workflow

### E_WORKFLOW_NOT_FOUND
**Quando:** workflow nomeado não existe em `workflows/`
**Mensagem CLI:**
```
Workflow `gitflow` not found in workflows/
hint: List available with `mnema workflow list`
```
**Exit code:** 2

### E_WORKFLOW_INVALID
**Quando:** JSON malformado ou não satisfaz meta-schema
**Mensagem CLI:**
```
workflows/custom.json is invalid:
  transitions.DRAFT.submit.requires.title.format: unsupported format "phone"
hint: Supported string formats: url, email, uuid, iso8601, task_key
```
**MCP:**
```json
{
  "error": "WORKFLOW_INVALID",
  "file": "workflows/custom.json",
  "issues": [{"path": "transitions.DRAFT.submit.requires.title.format", "message": "..."}],
  "message": "Workflow validation failed"
}
```
**Exit code:** 2

### E_WORKFLOW_STATE_UNKNOWN
**Quando:** transição referencia estado não declarado em `states[]`
**Mensagem CLI:**
```
workflows/default.json: transition DRAFT.submit targets state "REDY" but it's not in states[]
hint: Did you mean "READY"? Check the states array
```
**Exit code:** 2

### E_WORKFLOW_NO_INITIAL
**Quando:** workflow não declara `initial` ou estado declarado não existe
**Exit code:** 2

### E_WORKFLOW_VERSION_INCOMPATIBLE
**Quando:** `schema_version` do workflow não suportado pela versão atual
**Mensagem CLI:**
```
workflows/default.json uses schema_version 2.0, but mnema 1.x supports up to 1.0
hint: Upgrade mnema, or convert with `mnema workflow migrate`
```
**Exit code:** 3

---

## 4. MCP Server

### E_NO_AGENT_HANDLE
**Quando:** cliente MCP não passou `metadata.agent_handle`
**MCP response:**
```json
{
  "error": "NO_AGENT_HANDLE",
  "message": "MCP client did not provide agent_handle. Check your client configuration — see `mnema mcp install-instructions <client>`"
}
```

### E_NO_ACTIVE_RUN
**Quando:** mutação tentada sem `agent_run_start` prévio na sessão
**MCP response:**
```json
{
  "error": "NO_ACTIVE_RUN",
  "message": "No active agent run. Call agent_run_start({ goal: '...' }) before mutations"
}
```

### E_RUN_DEPTH_EXCEEDED
**Quando:** tentativa de criar run filho que ultrapassaria 5 níveis
**MCP response:**
```json
{
  "error": "RUN_DEPTH_EXCEEDED",
  "max_depth": 5,
  "current_depth": 5,
  "message": "Cannot create child run: maximum depth of 5 reached"
}
```

### E_PLAN_DEPTH_EXCEEDED
**Quando:** plan filho ultrapassaria 5 níveis
**MCP response similar a acima**

### E_RUN_ALREADY_ENDED
**Quando:** mutação tentada com run que já tem status `completed/failed/aborted`
**MCP response:**
```json
{
  "error": "RUN_ALREADY_ENDED",
  "run_id": "...",
  "status": "completed",
  "message": "Run is no longer active. Start a new one with agent_run_start"
}
```

### E_BOOTSTRAP_FAILED
**Quando:** `context_bootstrap` falha ao ler arquivos do projeto
**MCP response:**
```json
{
  "error": "BOOTSTRAP_FAILED",
  "missing_files": ["AGENTS.md"],
  "message": "Some context files are missing — run `mnema doctor`"
}
```

---

## 5. Storage e DB

### E_DB_LOCKED
**Quando:** `busy_timeout` (5s) estourou
**Mensagem CLI:**
```
Database is locked by another process
hint: Wait a moment and retry, or check for stale processes with `mnema doctor`
```
**Exit code:** 4

### E_DB_CORRUPT
**Quando:** SQLite reporta corruption
**Mensagem CLI:**
```
Database appears corrupt
hint: Restore from backup or rebuild with `mnema sync --bootstrap`
```
**Exit code:** 5

### E_MIGRATION_PENDING
**Quando:** schema do código é mais novo que do DB
**Mensagem CLI:**
```
Schema migration pending: 2 migrations to apply
hint: Run `mnema migrate` to apply
```
**Exit code:** 3

### E_SCHEMA_DOWNGRADE
**Quando:** schema do DB é mais novo que do código
**Mensagem CLI:**
```
Project schema (v5) is newer than this mnema version (supports up to v4)
hint: Upgrade with `npm i -g @saurim/mnema@latest`
```
**Exit code:** 3

### E_MIGRATION_FAILED
**Quando:** erro durante aplicação de migration
**Mensagem CLI:**
```
Migration 003_agent_plans_and_identity.sql failed
hint: Database is in inconsistent state. Restore from backup or contact support
```
**Exit code:** 5

---

## 6. Markdown e sync

### E_MARKDOWN_INVALID_FRONTMATTER
**Quando:** YAML frontmatter quebrado em arquivo gerenciado
**Mensagem CLI:**
```
backlog/READY/WEBAPP-42.md has invalid YAML frontmatter
hint: Fix the YAML or remove the file to regenerate
```
**Exit code:** 2

### E_MARKDOWN_FRONTMATTER_SCHEMA
**Quando:** frontmatter `mnema:` viola schema esperado
**Mensagem CLI:**
```
backlog/READY/WEBAPP-42.md: mnema.state must be one of [DRAFT, READY, ...]
hint: Run `mnema sync` to regenerate from database
```
**Exit code:** 2

### E_MARKDOWN_KEY_MISMATCH
**Quando:** key no frontmatter não bate com o esperado pelo path
**Mensagem CLI:**
```
backlog/READY/WEBAPP-42.md has mnema.key=WEBAPP-43, expected WEBAPP-42
hint: Either rename the file or fix the key
```
**Exit code:** 2

### E_SYNC_BUFFER_CORRUPT
**Quando:** `.app/buffer.jsonl` está malformado no boot
**Mensagem CLI:**
```
Sync buffer file is corrupt
hint: Run `mnema sync --rebuild` to discard buffer and re-sync from DB
```
**Exit code:** 3

---

## 7. Identidade

### E_IDENTITY_NOT_CONFIGURED
**Quando:** `~/.config/mnema/identity.json` não existe e env var não setada
**Mensagem CLI:**
```
No identity configured
hint: Set with `mnema identity set <handle>` or env MNEMA_ACTOR=<handle>
```
**Exit code:** 2

### E_IDENTITY_INVALID
**Quando:** identity.json malformado
**Mensagem CLI:**
```
~/.config/mnema/identity.json is invalid
hint: Fix the file or recreate with `mnema identity set <handle>`
```
**Exit code:** 2

### E_ACTOR_NOT_FOUND
**Quando:** referência a actor que não existe no projeto
**MCP response:**
```json
{
  "error": "ACTOR_NOT_FOUND",
  "actor": "alice",
  "message": "Actor 'alice' not registered in this project"
}
```

---

## 8. Importadores

### E_IMPORT_SOURCE_INVALID
**Quando:** importador não consegue conectar/autenticar
**Mensagem CLI:**
```
Cannot connect to GitHub: 401 Unauthorized
hint: Check your token with `gh auth status` or pass --token
```
**Exit code:** 2

### E_IMPORT_DUPLICATE
**Quando:** re-import detecta items já importados
**Mensagem CLI:**
```
123 issues already imported, 5 new to import
hint: Pass --update to refresh existing, or --force to recreate
```
**Exit code:** 0 (warning, not error)

### E_IMPORT_PARSE_FAILED
**Quando:** markdown source não pode ser parseado pelas heurísticas
**Mensagem CLI:**
```
Could not parse TODO.md: no headers matching `## STATE Title` pattern
hint: Check the format guide at https://mnema.dev/docs/import-markdown
```
**Exit code:** 2

---

## 9. Sistema

### E_PERMISSION_DENIED
**Quando:** falta permissão de filesystem
**Mensagem CLI:**
```
Permission denied writing to .app/state.db
hint: Check directory permissions
```
**Exit code:** 2

### E_DISK_FULL
**Quando:** ENOSPC durante write
**Mensagem CLI:**
```
Disk full — cannot write to .app/state.db
hint: Free up space and retry
```
**Exit code:** 1

### E_INTERNAL
**Quando:** bug ou condição não tratada
**Mensagem CLI:**
```
Internal error: <stack trace summary>
hint: Please report at https://github.com/<saurim>/mnema/issues with output of `mnema doctor`
```
**Exit code:** 5

---

## Tabela mestre (referência rápida)

| Código | Categoria | Exit code | Recuperável pelo usuário? |
|---|---|---|---|
| E_CONFIG_NOT_FOUND | Config | 2 | Sim (init) |
| E_CONFIG_INVALID | Config | 2 | Sim (fix JSON) |
| E_VERSION_MISMATCH | Config | 3 | Sim (upgrade) |
| E_TASK_NOT_FOUND | Task | 2 | Sim (verificar key) |
| E_GATE_FAILED | Task | 2 | Sim (fix payload) |
| E_INVALID_TRANSITION | Task | 2 | Sim (escolher ação válida) |
| E_CONFLICT | Task | 4 | Sim (retry) |
| E_DUPLICATE_KEY | Task | 2 | Sim |
| E_TASK_DELETED | Task | 2 | Sim |
| E_WORKFLOW_NOT_FOUND | Workflow | 2 | Sim |
| E_WORKFLOW_INVALID | Workflow | 2 | Sim (fix JSON) |
| E_WORKFLOW_STATE_UNKNOWN | Workflow | 2 | Sim |
| E_WORKFLOW_NO_INITIAL | Workflow | 2 | Sim |
| E_WORKFLOW_VERSION_INCOMPATIBLE | Workflow | 3 | Sim (upgrade) |
| E_NO_AGENT_HANDLE | MCP | n/a | Sim (config) |
| E_NO_ACTIVE_RUN | MCP | n/a | Sim (call agent_run_start) |
| E_RUN_DEPTH_EXCEEDED | MCP | n/a | Não no momento |
| E_PLAN_DEPTH_EXCEEDED | MCP | n/a | Não no momento |
| E_RUN_ALREADY_ENDED | MCP | n/a | Sim (novo run) |
| E_BOOTSTRAP_FAILED | MCP | n/a | Sim (doctor) |
| E_DB_LOCKED | Storage | 4 | Sim (retry) |
| E_DB_CORRUPT | Storage | 5 | Talvez (rebuild) |
| E_MIGRATION_PENDING | Storage | 3 | Sim (migrate) |
| E_SCHEMA_DOWNGRADE | Storage | 3 | Sim (upgrade) |
| E_MIGRATION_FAILED | Storage | 5 | Não (escalate) |
| E_MARKDOWN_INVALID_FRONTMATTER | Markdown | 2 | Sim (fix YAML) |
| E_MARKDOWN_FRONTMATTER_SCHEMA | Markdown | 2 | Sim (sync) |
| E_MARKDOWN_KEY_MISMATCH | Markdown | 2 | Sim |
| E_SYNC_BUFFER_CORRUPT | Markdown | 3 | Sim (rebuild) |
| E_IDENTITY_NOT_CONFIGURED | Identity | 2 | Sim (set) |
| E_IDENTITY_INVALID | Identity | 2 | Sim |
| E_ACTOR_NOT_FOUND | Identity | n/a | Sim |
| E_IMPORT_SOURCE_INVALID | Import | 2 | Sim |
| E_IMPORT_DUPLICATE | Import | 0 | n/a (warning) |
| E_IMPORT_PARSE_FAILED | Import | 2 | Sim |
| E_PERMISSION_DENIED | System | 2 | Sim |
| E_DISK_FULL | System | 1 | Sim |
| E_INTERNAL | System | 5 | Não (bug) |

**Total:** 38 erros catalogados

---

## Implementação sugerida

```typescript
// src/errors/catalog.ts
export const Errors = {
  CONFIG_NOT_FOUND: (ctx: { current_dir: string }) => ({
    code: 'E_CONFIG_NOT_FOUND',
    human_message: `mnema.config.json not found in ${ctx.current_dir} or any parent directory`,
    human_hint: 'Run `mnema init` to create a new project',
    structured: { error: 'CONFIG_NOT_FOUND', current_dir: ctx.current_dir, message: 'Mnema config not found' },
    exit_code: 2,
  }),
  // ... outros 37
} as const;
```

E utility:

```typescript
// src/cli/error-printer.ts
import chalk from 'chalk';
import type { ErrorOutput } from '@/errors/types.js';

export function printError(err: ErrorOutput): void {
  console.error(`${chalk.red(err.code)} ${err.human_message}`);
  if (err.human_hint) {
    console.error(chalk.dim(`hint: ${err.human_hint}`));
  }
}
```
