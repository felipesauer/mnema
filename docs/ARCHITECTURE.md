# Mnema — Arquitetura

> **Status:** Draft v1.2 · Companion document do `DESIGN.md`
> **Audiência:** desenvolvedores implementando Mnema, agentes de IA executando código
> **Pré-requisito:** ler `DESIGN.md` antes deste documento
>
> **Mudanças v1.2:** Convenções de código consolidadas e formalizadas no Apêndice B. Padrão OOP-first (classes pra estado/lifecycle, funções soltas só pra utils puros). Arquivos em kebab-case sempre. JSDoc completo em APIs públicas. Enums nativos. Proibido comentar histórico de decisão. Todos os exemplos de código revisados.
>
> **Mudanças v1.1:** Adicionadas seções de Concorrência e Crash Recovery, Lifecycle do MCP server, Logging interno, Meta-schema do Workflow JSON. Atualizada estrutura de pastas com `errors/` e novas dependências (pino, gray-matter).

Este documento descreve a arquitetura técnica em profundidade. Onde o `DESIGN.md` responde "o quê e por quê", este responde "como".

> **Aviso ao agente de IA implementando:** as convenções de código no Apêndice B são **obrigatórias e não-negociáveis**. Toda PR/incremento deve seguir. Em caso de dúvida, releia o Apêndice B antes de escrever código.

---

## 1. Visão geral em camadas

```
┌─────────────────────────────────────────────────────────────────┐
│                    Clientes externos                             │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│   │ Humano (CLI) │  │ Claude Code  │  │ Cursor/Aider/outros  │  │
│   └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘  │
└──────────┼─────────────────┼─────────────────────┼──────────────┘
           │                 │                     │
           │ stdin/stdout    │ stdio (MCP)         │ stdio (MCP)
           │                 │                     │
┌──────────▼─────────────────▼─────────────────────▼──────────────┐
│                    Camada de Interface                           │
│   ┌──────────────────────┐    ┌──────────────────────────────┐  │
│   │   CLI (Commander)    │    │   MCP Server (@mcp/sdk)      │  │
│   │   + @inquirer/prompts│    │   + tools geradas/hardcoded  │  │
│   └──────────┬───────────┘    └──────────────┬───────────────┘  │
└──────────────┼────────────────────────────────┼─────────────────┘
               │                                │
               │  ambos chamam Services         │
               │                                │
┌──────────────▼────────────────────────────────▼─────────────────┐
│                    Camada de Serviço                             │
│   TaskService · DecisionService · AgentRunService                │
│   AgentPlanService · SyncService · WorkflowService               │
│   AuditService · IdentityService · ImporterService               │
│   (todos retornam Result<T, Error> tipado)                       │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           │ services orquestram domain + storage
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│                    Camada de Domínio                             │
│   StateMachine · Gates · Validators · Entities                   │
│   (TypeScript puro, sem I/O, totalmente testável)                │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│                    Camada de Storage                             │
│   ┌──────────────┐ ┌────────────┐ ┌──────────────┐ ┌──────────┐ │
│   │ SQLiteAdapter│ │MarkdownIO  │ │AuditWriter   │ │FileStore │ │
│   │ (estado)     │ │(conteúdo)  │ │(JSONL)       │ │(anexos)  │ │
│   └──────────────┘ └────────────┘ └──────────────┘ └──────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

**Regra de fluxo:** dependências apontam só pra baixo. Domínio não conhece Services; Services não conhecem CLI/MCP.

---

## 2. Estrutura de pastas do repo

```
mnema/                                  (repo único, package.json único)
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── biome.json
│
├── src/
│   ├── index.ts                        (entry point: `mnema` binary)
│   │
│   ├── cli/                            (camada de interface — CLI)
│   │   ├── index.ts                    (registra comandos no Commander)
│   │   ├── commands/
│   │   │   ├── init-command.ts
│   │   │   ├── task-command.ts
│   │   │   ├── history-command.ts
│   │   │   ├── watch-command.ts
│   │   │   ├── inbox-command.ts
│   │   │   ├── mcp-command.ts          (subcomando `mnema mcp serve`)
│   │   │   ├── doctor-command.ts
│   │   │   ├── sync-command.ts
│   │   │   └── ...
│   │   ├── prompts/                    (wizards interativos com @inquirer)
│   │   │   └── init-wizard.ts
│   │   └── formatters/                 (output: human, table, json)
│   │       ├── human-formatter.ts
│   │       ├── table-formatter.ts
│   │       └── json-formatter.ts
│   │
│   ├── mcp/                            (camada de interface — MCP)
│   │   ├── mcp-server.ts               (boots @mcp/sdk server)
│   │   ├── tools/
│   │   │   ├── universal/              (hardcoded)
│   │   │   │   ├── context-bootstrap-tool.ts
│   │   │   │   ├── tasks-list-tool.ts
│   │   │   │   ├── task-show-tool.ts
│   │   │   │   ├── task-create-tool.ts
│   │   │   │   ├── agent-run-start-tool.ts
│   │   │   │   ├── agent-run-end-tool.ts
│   │   │   │   ├── agent-plan-create-tool.ts
│   │   │   │   ├── decision-record-tool.ts
│   │   │   │   └── ...
│   │   │   └── transition-tool-generator.ts  (geradas do workflow ativo)
│   │   ├── schemas/                    (Zod schemas pra inputs/outputs)
│   │   └── tool-registry.ts            (registra todas as tools no server)
│   │
│   ├── services/                       (camada de serviço — orquestração)
│   │   ├── task-service.ts
│   │   ├── decision-service.ts
│   │   ├── agent-run-service.ts
│   │   ├── agent-plan-service.ts
│   │   ├── sync-service.ts
│   │   ├── workflow-service.ts
│   │   ├── audit-service.ts
│   │   ├── identity-service.ts
│   │   ├── importer-service.ts
│   │   └── result.ts                   (Ok, Err factories + Result<T,E> type)
│   │
│   ├── domain/                         (camada de domínio — TS puro, sem I/O)
│   │   ├── entities/                   (interfaces de Task, Decision, etc.)
│   │   │   ├── task.ts
│   │   │   ├── decision.ts
│   │   │   ├── sprint.ts
│   │   │   ├── epic.ts
│   │   │   ├── agent-run.ts
│   │   │   ├── agent-plan.ts
│   │   │   ├── actor.ts
│   │   │   ├── transition.ts
│   │   │   ├── note.ts
│   │   │   └── dependency.ts
│   │   ├── enums/                      (TaskState, AgentRunStatus, etc.)
│   │   │   ├── task-state.ts
│   │   │   ├── agent-run-status.ts
│   │   │   ├── agent-plan-state.ts
│   │   │   ├── actor-kind.ts
│   │   │   ├── decision-status.ts
│   │   │   └── enforcement-mode.ts
│   │   ├── state-machine/
│   │   │   ├── state-machine.ts        (máquina genérica)
│   │   │   ├── workflow.ts             (carrega workflow do JSON)
│   │   │   ├── workflow-schema-translator.ts  (jsonRequiresToZod equivalent)
│   │   │   └── workflow-meta-schema.ts (Zod meta-schema do workflow.json)
│   │   ├── validators/                 (Zod schemas reutilizáveis)
│   │   │   ├── task-key-validator.ts
│   │   │   └── identity-validator.ts
│   │   └── id-generator.ts             (UUID v7, key generation — funções soltas)
│   │
│   ├── storage/                        (camada de storage)
│   │   ├── sqlite/
│   │   │   ├── sqlite-adapter.ts       (better-sqlite3 wrapper)
│   │   │   ├── migration-runner.ts
│   │   │   ├── migrations/             (.sql files copied at build)
│   │   │   └── repositories/
│   │   │       ├── task-repository.ts
│   │   │       ├── decision-repository.ts
│   │   │       ├── agent-run-repository.ts
│   │   │       ├── agent-plan-repository.ts
│   │   │       ├── sprint-repository.ts
│   │   │       ├── epic-repository.ts
│   │   │       ├── actor-repository.ts
│   │   │       ├── transition-repository.ts
│   │   │       └── attachment-repository.ts
│   │   ├── markdown/
│   │   │   └── markdown-io.ts          (gray-matter wrapper)
│   │   ├── audit/
│   │   │   ├── audit-writer.ts         (JSONL append-only)
│   │   │   └── audit-rotator.ts        (rotação mensal)
│   │   ├── buffer/
│   │   │   └── sync-buffer.ts          (.app/buffer.jsonl)
│   │   └── files/
│   │       └── file-store.ts           (SHA-256 dedup)
│   │
│   ├── config/
│   │   ├── config-loader.ts            (lê mnema.config.json, sobe na árvore)
│   │   ├── config-schema.ts            (Zod do mnema.config.json)
│   │   └── config-defaults.ts
│   │
│   ├── errors/                         (catálogo central — ver errors-catalog.md)
│   │   ├── error-catalog.ts            (Errors.<CODE>(ctx) → ErrorOutput)
│   │   ├── error-types.ts              (ErrorOutput, ErrorCode enum)
│   │   └── error-printer.ts            (printError pro CLI)
│   │
│   └── utils/                          (funções soltas, stateless)
│       ├── logger.ts                   (Pino, configurável via env)
│       ├── version.ts                  (semver, version check)
│       ├── fs-helpers.ts               (helpers de filesystem)
│       └── date-helpers.ts             (formatação de datas)
│
├── workflows/                          (presets, copiados pra projetos no init)
│   ├── default.json
│   ├── lean.json
│   ├── kanban.json
│   └── jira-classic.json
│
├── templates/                          (templates pra init)
│   ├── agents-md.tmpl
│   ├── readme.tmpl
│   └── skills/
│       ├── skill.md
│       ├── creating-tasks.md
│       ├── transitioning-tasks.md
│       ├── recording-decisions.md
│       └── handling-blockers.md
│
├── tests/
│   ├── unit/                           (espelha src/)
│   ├── integration/                    (com SQLite real, fs real em tmp)
│   └── e2e/                            (CLI rodando como subprocess)
│       └── cli-init.test.ts
│
└── docs/
    ├── DESIGN.md
    ├── ARCHITECTURE.md                 (este arquivo)
    ├── EXECUTION_GUIDE.md
    ├── errors-catalog.md
    └── GAPS_AND_REFINEMENTS.md
```

### Convenções de naming

- **Arquivos:** kebab-case sempre, inclusive testes (`task-service.test.ts`)
- **Sufixos descritivos:** `-service`, `-repository`, `-tool`, `-command`, `-validator`, `-adapter`, `-helper`
- Arquivo que exporta uma classe principal usa o nome da classe em kebab-case (ex: `class TaskService` → `task-service.ts`)
- Arquivo de utility com funções soltas tem nome descritivo da área (ex: `id-generator.ts`, `fs-helpers.ts`)
- Migrations mantêm formato existente: `001_initial.sql`, `002_fts_attachments.sql` (snake_case com prefixo numérico)
```

### Por que essa estrutura

- **Pastas espelham camadas** — fácil de navegar, fácil de impor regras de import (ex: `domain/` não pode importar de `services/`)
- **Testes paralelos** — cada `src/X/Y.ts` tem `tests/unit/X/Y.test.ts`
- **Workflows e templates fora do `src/`** — são dados, não código; copiados durante init via `fs.cp`
- **Migrations como `.sql`** — são copiados pro `dist/` no build pra serem lidos em runtime

---

## 3. Camada de Storage

### 3.1 SQLite — adapter e repositórios

**`SqliteAdapter`** é o wrapper único sobre `better-sqlite3`. Todas as queries passam por ele. Configuração obrigatória:

```typescript
// src/storage/sqlite/sqlite-adapter.ts
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';

/**
 * Wrapper sobre better-sqlite3 com configuração padronizada.
 * Aplica pragmas obrigatórios (WAL, foreign keys, busy timeout) no boot.
 */
export class SqliteAdapter {
  private readonly database: DatabaseType;

  /**
   * Opens the SQLite database at the given path and applies required pragmas.
   *
   * @param databasePath - Absolute path to the SQLite file
   */
  constructor(databasePath: string) {
    this.database = new Database(databasePath);
    this.database.pragma('journal_mode = WAL');
    this.database.pragma('synchronous = NORMAL');
    this.database.pragma('foreign_keys = ON');
    this.database.pragma('busy_timeout = 5000');
    this.database.pragma('wal_autocheckpoint = 1000');
  }

  /**
   * Returns the underlying better-sqlite3 Database instance.
   * Repositories use this to prepare and execute statements.
   *
   * @returns The native Database instance
   */
  getDatabase(): DatabaseType {
    return this.database;
  }

  /**
   * Closes the database connection. Should be called on graceful shutdown.
   */
  close(): void {
    this.database.close();
  }
}
```

**Repositórios** seguem padrão CRUD + queries específicas. Não contêm lógica de domínio — apenas leitura e escrita.

```typescript
// src/storage/sqlite/repositories/task-repository.ts
import type { Task } from '@/domain/entities/task.js';
import { TaskState } from '@/domain/enums/task-state.js';
import type { SqliteAdapter } from '../sqlite-adapter.js';

/**
 * Persistência de Task no SQLite.
 * Não valida regras de negócio — isso é responsabilidade dos Services.
 */
export class TaskRepository {
  constructor(private readonly adapter: SqliteAdapter) {}

  /**
   * Finds a task by its human-readable key, excluding soft-deleted tasks.
   *
   * @param key - Task key (e.g., "WEBAPP-42")
   * @returns The task if found and not deleted, null otherwise
   */
  findByKey(key: string): Task | null {
    const row = this.adapter.getDatabase()
      .prepare('SELECT * FROM tasks WHERE key = ? AND deleted_at IS NULL')
      .get(key);
    return row === undefined ? null : this.rowToTask(row);
  }

  /**
   * Lists tasks in the given state, excluding soft-deleted tasks.
   *
   * @param state - Target state to filter by
   * @returns Array of tasks (possibly empty)
   */
  findByState(state: TaskState): Task[] {
    const rows = this.adapter.getDatabase()
      .prepare('SELECT * FROM tasks WHERE state = ? AND deleted_at IS NULL ORDER BY key')
      .all(state);
    return rows.map((row) => this.rowToTask(row));
  }

  /**
   * Inserts a new task. Caller is responsible for ensuring no duplicate key.
   *
   * @param task - Task entity to persist
   */
  insert(task: Task): void {
    // Implementation
  }

  /** Maps a raw DB row to a Task entity. */
  private rowToTask(row: unknown): Task {
    // Implementation
  }
}
```

**Decisão importante:** repositórios só **leem e gravam**. Eles não validam regras de negócio (isso é Domain). Validação acontece nos Services antes de chamar repositórios.

### 3.2 Migrations

Arquivos `.sql` rodam em ordem na primeira inicialização e em upgrades. Tracking via tabela `schema_migrations`:

```typescript
// src/storage/sqlite/migration-runner.ts
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { SqliteAdapter } from './sqlite-adapter.js';

/**
 * Aplica migrations SQL em ordem, idempotente.
 * Usa a tabela `schema_migrations` pra rastrear versões aplicadas.
 */
export class MigrationRunner {
  /**
   * Runs all pending migrations from the given directory.
   *
   * @param adapter - SQLite adapter to apply migrations against
   * @param migrationsDir - Absolute path to directory containing .sql files
   */
  run(adapter: SqliteAdapter, migrationsDir: string): void {
    const database = adapter.getDatabase();
    const applied = database
      .prepare('SELECT version FROM schema_migrations ORDER BY version')
      .all()
      .map((row: { version: number }) => row.version);

    const files = readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const version = Number.parseInt(file.split('_')[0]!, 10);
      if (applied.includes(version)) continue;

      const sql = readFileSync(path.join(migrationsDir, file), 'utf-8');
      database.exec(sql);
    }
  }
}
```

### 3.3 Markdown I/O

Markdowns usam **YAML frontmatter** (padrão da comunidade — Jekyll, Hugo, Obsidian, GitHub renderer). Estrutura:

```markdown
---
mnema:
  key: WEBAPP-42
  state: IN_REVIEW
  estimate: 5
  acceptance_criteria:
    - User can authenticate
    - Token persisted across reloads
  metadata:
    pr_url: https://github.com/example/repo/pull/123
  reporter: daniel
  assignee: daniel
  reopen_count: 0
---

# Implementar OAuth2 callback

[Conteúdo livre, editável à mão. Preservado em sync.]
```

**Zonas:**
- **Frontmatter `mnema:`** — gerenciado pelo sistema. Sobrescrito em cada sync.
- **Outras chaves no frontmatter** — preservadas (útil pra Hugo, Astro, etc.)
- **Conteúdo após `---`** — totalmente livre. Mnema nunca toca.

**Implementação com `gray-matter`:**

```typescript
// src/storage/markdown/markdown-io.ts
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';

import matter from 'gray-matter';

/**
 * Resultado de parse de um markdown gerenciado pelo Mnema.
 */
export interface ParsedMarkdown {
  /** Conteúdo da chave `mnema:` no frontmatter, gerenciado pelo sistema */
  readonly mnemaData: Record<string, unknown>;
  /** Outras chaves no frontmatter, preservadas em sync */
  readonly otherFrontmatter: Record<string, unknown>;
  /** Markdown body livre, preservado em sync */
  readonly content: string;
}

/**
 * Read/write atômico de markdowns com YAML frontmatter.
 * Preserva chaves não-Mnema e conteúdo livre durante updates.
 */
export class MarkdownIo {
  /**
   * Reads a markdown file and parses its frontmatter.
   * Returns empty structure if file does not exist.
   *
   * @param filePath - Absolute path to the markdown file
   * @returns Parsed structure with mnema data, other frontmatter, and content
   * @throws If frontmatter YAML is malformed
   */
  read(filePath: string): ParsedMarkdown {
    if (!existsSync(filePath)) {
      return { mnemaData: {}, otherFrontmatter: {}, content: '' };
    }

    const raw = readFileSync(filePath, 'utf-8');
    let parsed: matter.GrayMatterFile<string>;
    try {
      parsed = matter(raw);
    } catch {
      throw new Error(`E_MARKDOWN_INVALID_FRONTMATTER:${filePath}`);
    }

    const frontmatter = parsed.data ?? {};
    const { mnema, ...otherFrontmatter } = frontmatter;

    return {
      mnemaData: (mnema as Record<string, unknown>) ?? {},
      otherFrontmatter,
      content: parsed.content,
    };
  }

  /**
   * Writes a markdown file atomically (tmp + rename).
   * Combines mnema data, other frontmatter, and content into a single output.
   *
   * @param filePath - Absolute path to write
   * @param parsed - Structure to serialize
   */
  write(filePath: string, parsed: ParsedMarkdown): void {
    const fullFrontmatter = {
      ...parsed.otherFrontmatter,
      mnema: parsed.mnemaData,
    };

    const output = matter.stringify(parsed.content, fullFrontmatter);

    const tmpPath = `${filePath}.tmp`;
    writeFileSync(tmpPath, output, 'utf-8');
    renameSync(tmpPath, filePath);
  }

  /**
   * Updates only the `mnema:` frontmatter section, preserving everything else.
   *
   * @param filePath - Absolute path to the markdown file
   * @param updates - Fields to merge into mnema frontmatter
   */
  updateMnema(filePath: string, updates: Record<string, unknown>): void {
    const current = this.read(filePath);
    this.write(filePath, {
      ...current,
      mnemaData: { ...current.mnemaData, ...updates },
    });
  }
}
```

**Validação do frontmatter `mnema:`:**

Ao ler, schema Zod valida estrutura:

```typescript
const MnemaFrontmatterSchema = z.object({
  key: z.string().regex(/^[A-Z][A-Z0-9]*-\d+$/),
  state: z.string(),
  // ... outros campos
});

function validateMnemaFrontmatter(data: unknown, filePath: string): MnemaFrontmatter {
  const result = MnemaFrontmatterSchema.safeParse(data);
  if (!result.success) {
    throw Errors.MARKDOWN_FRONTMATTER_SCHEMA({
      file: filePath,
      issues: result.error.issues,
    });
  }
  return result.data;
}
```

**Comportamento de erros:**

| Situação | Comportamento |
|---|---|
| Arquivo não existe | Sync recria com defaults |
| YAML malformado | `E_MARKDOWN_INVALID_FRONTMATTER` |
| `mnema:` ausente | Sync recria a chave |
| `mnema:` com schema inválido | `E_MARKDOWN_FRONTMATTER_SCHEMA` |
| `mnema.key` não bate com path | `E_MARKDOWN_KEY_MISMATCH` |

**Por que YAML frontmatter ao invés de blocos HTML:**

- Renderiza corretamente em qualquer visualizador markdown (GitHub, Obsidian, VSCode)
- Padrão universal — `gray-matter` é parser de referência
- Permite coexistência com outras tools que usam frontmatter
- YAML é mais legível que HTML comments com sintaxe inventada

### 3.4 Audit JSONL

`AuditWriter` é append-only. Nunca abre `O_TRUNC`, sempre `O_APPEND`. Cada linha é um evento JSON:

```typescript
// src/storage/audit/audit-writer.ts
import { appendFileSync, existsSync, renameSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Evento append-only registrado no audit log.
 */
export interface AuditEvent {
  readonly v: number;
  readonly at: string;
  readonly kind: string;
  readonly actor: string;
  readonly via?: string;
  readonly run?: string;
  readonly data: Readonly<Record<string, unknown>>;
}

/**
 * Append-only writer pra audit log em JSONL.
 * Rotaciona automaticamente quando muda o mês.
 */
export class AuditWriter {
  private readonly currentFile: string;

  /**
   * Initializes the writer and triggers a rotation check.
   *
   * @param auditDir - Absolute path to the audit directory
   */
  constructor(private readonly auditDir: string) {
    this.currentFile = path.join(auditDir, 'current.jsonl');
    this.checkRotation();
  }

  /**
   * Appends an event to the current audit file.
   *
   * @param event - Event to append (will be JSON-serialized)
   */
  write(event: AuditEvent): void {
    const line = `${JSON.stringify(event)}\n`;
    appendFileSync(this.currentFile, line, { flag: 'a' });
  }

  /**
   * Checks if the current file's month differs from now and rotates if so.
   * Called on construction and can be called periodically.
   */
  checkRotation(): void {
    const now = new Date();
    const currentMonth = now.toISOString().slice(0, 7);

    if (!existsSync(this.currentFile)) return;

    const stat = statSync(this.currentFile);
    const fileMonth = new Date(stat.mtime).toISOString().slice(0, 7);

    if (fileMonth !== currentMonth) {
      renameSync(
        this.currentFile,
        path.join(this.auditDir, `${fileMonth}.jsonl`),
      );
    }
  }
}
```

### 3.5 FileStore (anexos)

Anexos são gravados com nome `{sha256}.{ext}`. Dedup automático.

```typescript
// src/storage/files/file-store.ts
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Resultado de armazenamento de um anexo.
 */
export interface StoredFile {
  readonly hash: string;
  readonly storedPath: string;
}

/**
 * Armazena anexos com nomenclatura por hash SHA-256.
 * Idempotente — mesmo conteúdo nunca é gravado duas vezes.
 */
export class FileStore {
  constructor(private readonly attachmentsDir: string) {}

  /**
   * Stores a file by its SHA-256 hash. Returns existing path if hash matches.
   *
   * @param sourcePath - Absolute path to the source file
   * @returns Hash and stored path of the deduplicated file
   */
  store(sourcePath: string): StoredFile {
    const buffer = readFileSync(sourcePath);
    const hash = createHash('sha256').update(buffer).digest('hex');
    const extension = path.extname(sourcePath);
    const storedPath = path.join(this.attachmentsDir, `${hash}${extension}`);

    if (!existsSync(storedPath)) {
      writeFileSync(storedPath, buffer);
    }

    return { hash, storedPath };
  }
}
```

---

## 4. Camada de Domínio

### 4.1 State Machine

`StateMachine` é genérica — recebe um `Workflow` (carregado do JSON) e responde queries.

```typescript
// src/domain/state-machine/state-machine.ts
import type { z } from 'zod';

import { Ok, Err, type Result } from '@/services/result.js';

/**
 * Definição de uma transição em um workflow.
 */
export interface Transition {
  readonly to: string;
  readonly description: string;
  readonly useWhen: string;
  readonly requires: z.ZodObject<z.ZodRawShape>;
}

/**
 * Workflow carregado e pronto pra ser usado pela state machine.
 * `transitions` é indexado por estado de origem, depois por nome da ação.
 */
export interface Workflow {
  readonly name: string;
  readonly states: readonly string[];
  readonly initial: string;
  readonly terminal: readonly string[];
  readonly transitions: Readonly<Record<string, Readonly<Record<string, Transition>>>>;
}

/**
 * Erro retornado por validação de gate.
 */
export type GateError =
  | { readonly kind: 'INVALID_TRANSITION'; readonly from: string; readonly action: string }
  | { readonly kind: 'GATE_FAILED'; readonly issues: readonly z.ZodIssue[] };

/**
 * Resultado de uma validação bem-sucedida.
 */
export interface ValidatedTransition {
  readonly to: string;
  readonly data: unknown;
}

/**
 * Máquina de estados genérica baseada em workflow declarativo.
 * Não tem estado interno — só consulta o workflow injetado.
 */
export class StateMachine {
  constructor(private readonly workflow: Workflow) {}

  /**
   * Checks if a transition from a state via an action is defined.
   *
   * @param from - Source state
   * @param action - Action name
   * @returns True if the transition exists, false otherwise
   */
  canTransition(from: string, action: string): boolean {
    return this.workflow.transitions[from]?.[action] !== undefined;
  }

  /**
   * Validates a transition attempt against the workflow.
   * Checks both the transition existence and the gate requirements.
   *
   * @param from - Source state
   * @param action - Action name
   * @param payload - Data to validate against the gate's requires schema
   * @returns Result with target state and parsed data, or typed gate error
   */
  validateTransition(
    from: string,
    action: string,
    payload: unknown,
  ): Result<ValidatedTransition, GateError> {
    const transition = this.workflow.transitions[from]?.[action];
    if (transition === undefined) {
      return Err({ kind: 'INVALID_TRANSITION', from, action });
    }

    const parsed = transition.requires.safeParse(payload);
    if (!parsed.success) {
      return Err({ kind: 'GATE_FAILED', issues: parsed.error.issues });
    }

    return Ok({ to: transition.to, data: parsed.data });
  }

  /**
   * Lists all actions available from a given state.
   *
   * @param state - State to query
   * @returns Array of action names with their transition definitions
   */
  listActionsFrom(state: string): ReadonlyArray<{ action: string; transition: Transition }> {
    const transitions = this.workflow.transitions[state] ?? {};
    return Object.entries(transitions).map(([action, transition]) => ({ action, transition }));
  }

  /**
   * Checks if a state is terminal (no outgoing transitions).
   *
   * @param state - State to check
   * @returns True if the state is terminal
   */
  isTerminal(state: string): boolean {
    return this.workflow.terminal.includes(state);
  }
}
```

### 4.2 Workflow Loader

Lê o JSON, traduz `requires` em `ZodSchema`:

```typescript
function loadWorkflow(jsonPath: string): Workflow {
  const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  validateWorkflowSchema(raw);   // meta-schema
  
  const transitions: Workflow['transitions'] = {};
  for (const [from, actions] of Object.entries(raw.transitions)) {
    transitions[from] = {};
    for (const [action, def] of Object.entries(actions)) {
      transitions[from][action] = {
        to: def.to,
        description: def.description,
        use_when: def.use_when,
        requires: jsonRequiresToZod(def.requires),  // tradutor
      };
    }
  }
  
  return { ...raw, transitions };
}
```

`jsonRequiresToZod` traduz a estrutura verbose do JSON pra Zod. Exemplo:

```json
{ "title": { "type": "string", "min": 3, "max": 200 } }
```

Vira:

```typescript
z.object({ title: z.string().min(3).max(200) })
```

### 4.3 Enums

Enums TypeScript nativos com valores string. Vivem em `src/domain/enums/`.

```typescript
// src/domain/enums/task-state.ts

/**
 * Estados possíveis de uma Task no workflow default.
 * Workflows customizados podem usar outros estados (string livre).
 */
export enum TaskState {
  Draft = 'DRAFT',
  Ready = 'READY',
  InProgress = 'IN_PROGRESS',
  Blocked = 'BLOCKED',
  InReview = 'IN_REVIEW',
  Done = 'DONE',
  Canceled = 'CANCELED',
}
```

```typescript
// src/domain/enums/agent-run-status.ts

/**
 * Status de uma execução de agente externo.
 */
export enum AgentRunStatus {
  Running = 'running',
  Completed = 'completed',
  Failed = 'failed',
  Aborted = 'aborted',
}
```

```typescript
// src/domain/enums/agent-plan-state.ts

/**
 * Estado de um passo dentro de um agent_run.
 */
export enum AgentPlanState {
  Pending = 'pending',
  InProgress = 'in_progress',
  Completed = 'completed',
  Skipped = 'skipped',
  Failed = 'failed',
}
```

```typescript
// src/domain/enums/actor-kind.ts

/**
 * Tipo de actor: humano ou agente.
 */
export enum ActorKind {
  Human = 'human',
  Agent = 'agent',
}
```

**Convenção:**
- Nome do enum em PascalCase, singular
- Membros em PascalCase (ex: `Draft`, `InProgress`)
- Valores string em SCREAMING_SNAKE_CASE quando representam estados de domínio (`'DRAFT'`, `'IN_PROGRESS'`)
- Valores em lowercase quando representam categorias técnicas (`'human'`, `'agent'`)

### 4.4 Entidades

Entidades são `interface`s puras. Nada de classes com métodos de negócio — toda lógica vive em Services.

```typescript
// src/domain/entities/task.ts
import type { TaskState } from '@/domain/enums/task-state.js';

/**
 * Entidade Task. Imutável — atualizações geram nova instância.
 * Campos em camelCase em código; mapeamento pra snake_case acontece no repositório.
 */
export interface Task {
  /** UUID v7 interno */
  readonly id: string;
  /** Identificador humano, ex: "WEBAPP-42" */
  readonly key: string;
  readonly projectId: string;
  readonly state: TaskState;
  readonly title: string;
  readonly description: string;
  readonly acceptanceCriteria: readonly string[];
  readonly estimate: number | null;
  readonly assigneeId: string | null;
  readonly reporterId: string;
  readonly sprintId: string | null;
  readonly epicId: string | null;
  readonly reopenCount: number;
  readonly metadata: Readonly<Record<string, unknown>>;
  /** ISO8601 timestamp */
  readonly createdAt: string;
  /** ISO8601 timestamp, usado em versionamento otimista */
  readonly updatedAt: string;
  readonly deletedAt: string | null;
}
```

**Convenção:** entidades usam `camelCase`. Repositórios fazem mapeamento entre `snake_case` (SQL) e `camelCase` (TypeScript) na fronteira.

---

## 5. Camada de Serviço

### 5.1 Padrão Result

Toda operação que pode falhar retorna `Result<T, E>`. Factories `Ok` e `Err` são funções soltas exportadas — utilities stateless puras.

```typescript
// src/services/result.ts

/**
 * Discriminated union representing success or failure of an operation.
 * Use the Ok and Err factories to construct values.
 */
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/**
 * Constructs a successful Result containing the given value.
 *
 * @param value - The success value to wrap
 * @returns A Result indicating success
 */
export function Ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/**
 * Constructs a failed Result containing the given error.
 *
 * @param error - The error value to wrap
 * @returns A Result indicating failure
 */
export function Err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}
```

Erros são tipados estruturalmente como discriminated unions:

```typescript
// src/services/task-errors.ts
import type { z } from 'zod';
import type { TaskState } from '@/domain/enums/task-state.js';

/**
 * Erros que TaskService pode retornar.
 * Cada variante carrega contexto suficiente pro chamador decidir a próxima ação.
 */
export type TaskError =
  | { readonly kind: 'GATE_FAILED'; readonly issues: readonly z.ZodIssue[]; readonly missing: readonly string[] }
  | { readonly kind: 'INVALID_TRANSITION'; readonly from: TaskState; readonly action: string }
  | { readonly kind: 'TASK_NOT_FOUND'; readonly taskKey: string }
  | { readonly kind: 'CONFLICT'; readonly expectedUpdatedAt: string; readonly currentUpdatedAt: string }
  | { readonly kind: 'DUPLICATE_KEY'; readonly taskKey: string }
  | { readonly kind: 'FORBIDDEN'; readonly reason: string };
```

CLI converte erro pra mensagem humana via `error-printer.ts`. MCP converte pra erro estruturado JSON via `error-catalog.ts`.

### 5.2 TaskService — exemplo de orquestração

```typescript
// src/services/task-service.ts
import type { Task } from '@/domain/entities/task.js';
import type { TaskState } from '@/domain/enums/task-state.js';
import type { StateMachine } from '@/domain/state-machine/state-machine.js';
import type { TaskRepository } from '@/storage/sqlite/repositories/task-repository.js';
import type { AuditService } from './audit-service.js';
import type { SyncService } from './sync-service.js';
import { Ok, Err, type Result } from './result.js';
import type { TaskError } from './task-errors.js';

/**
 * Argumentos pra TaskService.transition.
 */
export interface TransitionArgs {
  readonly taskKey: string;
  readonly action: string;
  readonly payload: unknown;
  readonly actor: string;
  readonly via?: string;
  readonly runId?: string;
  readonly expectedUpdatedAt?: string;
}

/**
 * Orquestra o ciclo de vida de tasks: criação, transições de estado, queries.
 * Toda mutação é atômica (única transação SQLite) e auditada.
 *
 * Reads não exigem agent_run ativo; mutações sim (validado upstream em MCP layer).
 */
export class TaskService {
  constructor(
    private readonly repository: TaskRepository,
    private readonly stateMachine: StateMachine,
    private readonly auditService: AuditService,
    private readonly syncService: SyncService,
  ) {}

  /**
   * Transitions a task to a new state by executing a workflow action.
   * Validates against the active workflow's gates and persists atomically.
   *
   * @param args.taskKey - Human-readable task identifier (e.g., "WEBAPP-42")
   * @param args.action - Action name as defined in the workflow
   * @param args.payload - Field values required by the action's gate
   * @param args.actor - Human responsible for this mutation
   * @param args.via - Optional agent intermediary (omit for direct CLI use)
   * @param args.runId - Required when via is provided
   * @param args.expectedUpdatedAt - Optional optimistic concurrency token
   * @returns Result with the updated task on success, typed error on failure
   */
  async transition(args: TransitionArgs): Promise<Result<Task, TaskError>> {
    const task = this.repository.findByKey(args.taskKey);
    if (task === null) {
      return Err({ kind: 'TASK_NOT_FOUND', taskKey: args.taskKey });
    }

    const validation = this.stateMachine.validateTransition(
      task.state,
      args.action,
      args.payload,
    );
    if (!validation.ok) {
      return Err(validation.error);
    }

    const { to, data } = validation.value;

    const updated = this.repository.runInTransaction(() => {
      this.repository.updateState(task.id, to, args.expectedUpdatedAt);
      this.repository.recordTransition({
        taskId: task.id,
        fromState: task.state,
        toState: to,
        action: args.action,
        actorId: args.actor,
        viaActorId: args.via ?? null,
        agentRunId: args.runId ?? null,
        payload: data,
      });
      return this.repository.findByKey(args.taskKey);
    });

    if (updated === null) {
      return Err({ kind: 'TASK_NOT_FOUND', taskKey: args.taskKey });
    }

    await this.auditService.write({
      kind: 'task_transitioned',
      actor: args.actor,
      via: args.via,
      run: args.runId,
      data: { key: task.key, from: task.state, to, action: args.action },
    });

    await this.syncService.queueMarkdownUpdate(task.key);

    return Ok(updated);
  }
}
```

**Pontos importantes:**

1. **Atomicidade SQLite** dentro de `runInTransaction()` — se algo falha, rollback automático.
2. **Side effects (audit, sync)** rodam **depois** da transação SQLite. Se audit falhar, SQLite já está consistente.
3. **Audit é fire-and-forget? Não.** Se audit falha, a operação falha. Estado sem auditoria correspondente é pior que operação rejeitada.

### 5.3 SyncService — push e buffer

```typescript
```typescript
// src/services/sync-service.ts
import type { TaskRepository } from '@/storage/sqlite/repositories/task-repository.js';
import type { MarkdownIo } from '@/storage/markdown/markdown-io.js';
import type { SyncBuffer } from '@/storage/buffer/sync-buffer.js';

/**
 * Modo de sincronização: push imediato ou buffer acumulado.
 */
export enum SyncMode {
  Push = 'push',
  Buffer = 'buffer',
}

/**
 * Entrada pendente no buffer de sync.
 */
export interface PendingSync {
  readonly kind: 'task' | 'decision';
  readonly key: string;
  readonly mdTarget: string;
}

/**
 * Sincroniza estado do SQLite com markdowns. Suporta dois modos:
 * - Push: grava markdown imediatamente (CLI humano)
 * - Buffer: acumula em arquivo persistente, flush periódico (MCP agente)
 */
export class SyncService {
  private mode: SyncMode = SyncMode.Push;

  constructor(
    private readonly taskRepository: TaskRepository,
    private readonly markdownIo: MarkdownIo,
    private readonly buffer: SyncBuffer,
  ) {}

  /**
   * Sets the active sync mode. Push flushes immediately; Buffer accumulates.
   *
   * @param mode - The sync mode to apply for subsequent operations
   */
  setMode(mode: SyncMode): void {
    this.mode = mode;
  }

  /**
   * Queues a markdown update for a task. Behavior depends on current mode.
   *
   * @param taskKey - Task key to sync
   */
  async queueMarkdownUpdate(taskKey: string): Promise<void> {
    if (this.mode === SyncMode.Push) {
      await this.flushOne(taskKey);
      return;
    }

    await this.buffer.append({
      kind: 'task',
      key: taskKey,
      mdTarget: this.pathForTaskKey(taskKey),
    });
    await this.checkAutoFlush();
  }

  /**
   * Flushes all pending entries from the buffer to markdown files.
   * Truncates the buffer atomically after successful flush.
   */
  async flushAll(): Promise<void> {
    const entries = await this.buffer.readAll();
    for (const entry of entries) {
      await this.flushOne(entry.key);
    }
    await this.buffer.truncate();
  }

  /** Triggers auto-flush when buffer hits volume threshold. */
  private async checkAutoFlush(): Promise<void> {
    const size = await this.buffer.size();
    if (size >= 50) {
      await this.flushAll();
    }
  }

  /** Writes a single task's markdown from current SQLite state. */
  private async flushOne(taskKey: string): Promise<void> {
    const task = this.taskRepository.findByKey(taskKey);
    if (task === null) return;

    const filePath = this.pathForTaskKey(taskKey);
    this.markdownIo.updateMnema(filePath, {
      key: task.key,
      state: task.state,
      estimate: task.estimate,
      // ... outros campos managed
    });
  }

  /** Resolves the markdown file path for a task key. */
  private pathForTaskKey(taskKey: string): string {
    // Implementation depends on workflow state
    return '';
  }
}
```

**Modo push** é setado pela CLI. **Modo buffer** é setado pelo MCP server, com flush em três eventos: tempo (30s), volume (50 muts), `agent_run_end`.

### 5.4 IdentityService

```typescript
// src/services/identity-service.ts
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import { ActorKind } from '@/domain/enums/actor-kind.js';
import type { ActorRepository } from '@/storage/sqlite/repositories/actor-repository.js';

/**
 * Metadata fornecida pelo MCP client durante a conexão.
 */
export interface McpClientMetadata {
  readonly agent_handle?: string;
}

/**
 * Gerencia identidade do humano e resolução de agentes via MCP metadata.
 */
export class IdentityService {
  constructor(private readonly actorRepository: ActorRepository) {}

  /**
   * Loads the default human actor from local config or environment.
   * Resolution order: MNEMA_ACTOR env var, then ~/.config/mnema/identity.json.
   *
   * @returns Handle of the default human actor
   * @throws If no identity is configured
   */
  getDefaultActor(): string {
    const envActor = process.env.MNEMA_ACTOR;
    if (envActor !== undefined && envActor.length > 0) {
      return envActor;
    }

    const configPath = path.join(homedir(), '.config', 'mnema', 'identity.json');
    if (!existsSync(configPath)) {
      throw new Error('E_IDENTITY_NOT_CONFIGURED');
    }

    const config = JSON.parse(readFileSync(configPath, 'utf-8')) as { default_actor?: string };
    if (config.default_actor === undefined) {
      throw new Error('E_IDENTITY_NOT_CONFIGURED');
    }

    return config.default_actor;
  }

  /**
   * Extracts the agent handle from MCP client metadata.
   * Returns null when no agent_handle is provided (direct CLI use case).
   *
   * @param metadata - Client metadata from MCP connection
   * @returns Prefixed agent handle (e.g., "agent:claude-code") or null
   */
  resolveAgentActor(metadata: McpClientMetadata): string | null {
    if (metadata.agent_handle === undefined || metadata.agent_handle.length === 0) {
      return null;
    }
    return `agent:${metadata.agent_handle}`;
  }

  /**
   * Ensures an actor exists in the database, creating if absent.
   *
   * @param handle - Actor handle (e.g., "daniel" or "agent:claude-code")
   * @param kind - Whether this is a human or agent actor
   * @returns The actor's internal ID
   */
  ensureActor(handle: string, kind: ActorKind): string {
    return this.actorRepository.upsert(handle, kind);
  }
}
```

---

## 6. Camada de Interface

### 6.1 CLI — comando `task move`

CLI commands são classes que registram seus subcomandos no Commander root.

```typescript
// src/cli/commands/task-command.ts
import type { Command } from 'commander';

import { loadConfig } from '@/config/config-loader.js';
import { createServiceContainer } from '@/services/service-container.js';
import { SyncMode } from '@/services/sync-service.js';
import { printError } from '@/errors/error-printer.js';
import { printTask } from '../formatters/human-formatter.js';

/**
 * Registra o grupo de comandos `mnema task` no Commander.
 */
export class TaskCommand {
  /**
   * Registers task subcommands on the parent Commander program.
   *
   * @param program - Root Commander program
   */
  register(program: Command): void {
    const taskGroup = program.command('task').description('Manage tasks');

    taskGroup
      .command('move <key> <action> [payload...]')
      .description('Move a task to a new state via a workflow action')
      .action(async (key: string, action: string, payloadArgs: string[]) => {
        await this.handleMove(key, action, payloadArgs);
      });
  }

  /** Handles `mnema task move <key> <action>` execution. */
  private async handleMove(key: string, action: string, payloadArgs: string[]): Promise<void> {
    const config = loadConfig();
    const services = createServiceContainer(config, { syncMode: SyncMode.Push });
    const actor = services.identity.getDefaultActor();

    const payload = this.parsePayloadArgs(payloadArgs);

    const result = await services.task.transition({
      taskKey: key,
      action,
      payload,
      actor,
    });

    if (!result.ok) {
      printError(result.error);
      process.exit(1);
    }

    printTask(result.value);
  }

  /** Parses `--field=value` style arguments into a payload object. */
  private parsePayloadArgs(args: string[]): Record<string, unknown> {
    const payload: Record<string, unknown> = {};
    for (const arg of args) {
      // Implementation
    }
    return payload;
  }
}
```

### 6.2 MCP — tool de transição (gerada)

Geração ocorre no boot do MCP server, lendo o workflow ativo. Cada transição vira uma instância de `TransitionTool`:

```typescript
// src/mcp/tools/transition-tool-generator.ts
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

import type { Transition } from '@/domain/state-machine/state-machine.js';
import type { McpTool, McpToolHandler, McpToolInput } from './mcp-tool-types.js';
import type { TaskService } from '@/services/task-service.js';
import type { IdentityService } from '@/services/identity-service.js';
import type { McpSessionContext } from '../mcp-session-context.js';

/**
 * Gera tools MCP a partir de transições declaradas em workflows.
 */
export class TransitionToolGenerator {
  constructor(
    private readonly taskService: TaskService,
    private readonly identityService: IdentityService,
    private readonly sessionContext: McpSessionContext,
  ) {}

  /**
   * Generates a single MCP tool from a workflow transition.
   *
   * @param action - Action name (e.g., "submit", "start")
   * @param transition - Transition definition from the workflow
   * @returns A registered McpTool ready to attach to the server
   */
  generate(action: string, transition: Transition): McpTool {
    const toolName = `task_${action}`;

    return {
      name: toolName,
      description: `${transition.description}\n\nUse when: ${transition.useWhen}`,
      inputSchema: zodToJsonSchema(
        z.object({
          task_key: z.string(),
          expected_updated_at: z.string().optional(),
          ...transition.requires.shape,
        }),
      ),
      handler: this.buildHandler(action),
    };
  }

  /** Builds the async handler that delegates to TaskService. */
  private buildHandler(action: string): McpToolHandler {
    return async (input: McpToolInput) => {
      const { task_key: taskKey, expected_updated_at: expectedUpdatedAt, ...payload } = input;
      const actor = this.identityService.getDefaultActor();
      const via = this.identityService.resolveAgentActor(this.sessionContext.getClientMetadata());
      const runId = this.sessionContext.getCurrentRunId();

      if (runId === null) {
        return {
          ok: false,
          error: 'NO_ACTIVE_RUN',
          message: 'Call agent_run_start before mutations',
        };
      }

      const result = await this.taskService.transition({
        taskKey: taskKey as string,
        action,
        payload,
        actor,
        via: via ?? undefined,
        runId,
        expectedUpdatedAt: expectedUpdatedAt as string | undefined,
      });

      if (!result.ok) {
        return { ok: false, error: result.error.kind, ...result.error };
      }
      return { ok: true, task: result.value };
    };
  }
}
```

### 6.3 MCP — universal tool `agent_run_start`

```typescript
// src/mcp/tools/universal/agent-run-start-tool.ts
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

import type { AgentRunService } from '@/services/agent-run-service.js';
import type { IdentityService } from '@/services/identity-service.js';
import type { McpSessionContext } from '../../mcp-session-context.js';
import type { McpTool, McpToolInput } from '../mcp-tool-types.js';

/**
 * Tool MCP universal pra iniciar um agent_run.
 * Chamada obrigatória antes de qualquer mutação na sessão.
 */
export class AgentRunStartTool {
  constructor(
    private readonly agentRunService: AgentRunService,
    private readonly identityService: IdentityService,
    private readonly sessionContext: McpSessionContext,
  ) {}

  /**
   * Builds the McpTool definition for registration with the server.
   *
   * @returns Configured MCP tool
   */
  build(): McpTool {
    return {
      name: 'agent_run_start',
      description: 'Start a new agent run. REQUIRED before any mutations.',
      inputSchema: zodToJsonSchema(
        z.object({
          goal: z.string().min(3),
          parent_run_id: z.string().optional(),
        }),
      ),
      handler: async (input: McpToolInput) => {
        const actor = this.identityService.getDefaultActor();
        const clientMetadata = this.sessionContext.getClientMetadata();
        const agentActor = this.identityService.resolveAgentActor(clientMetadata);

        if (agentActor === null) {
          return {
            ok: false,
            error: 'NO_AGENT_HANDLE',
            message: 'MCP client did not provide agent_handle',
          };
        }

        const run = await this.agentRunService.start({
          goal: input.goal as string,
          invokedBy: actor,
          agentActor,
          parentRunId: input.parent_run_id as string | undefined,
          clientMetadata,
        });

        if (!run.ok) {
          return { ok: false, error: run.error.kind, ...run.error };
        }

        this.sessionContext.setCurrentRunId(run.value.id);

        return { ok: true, run_id: run.value.id };
      },
    };
  }
}
```

---

## 7. Fluxos completos

### 7.1 Fluxo: agente inicia sessão e cria task

```
Claude Code (cliente MCP) — sessão recém-iniciada
  ↓ chama: context_bootstrap()
MCP Server
  ↓ lê AGENTS.md, memory/INDEX.md, decisions/INDEX.md
  ↓ consulta active_sprint, recent_decisions, blockers
  ↓ retorna estrutura completa de contexto

Claude Code
  ↓ agora "conhece" o projeto, workflow, decisões prévias
  ↓ chama: agent_run_start({ goal: "audit auth" })
MCP Server
  ↓ valida agent_handle do client_metadata
  ↓ cria agent_run no SQLite
  ↓ guarda run_id na sessão
  ↓ retorna { ok: true, run_id }

Claude Code
  ↓ chama: task_create({ title: "Fix SQL injection in login", ... })
MCP Server (universal tool)
  ↓ valida payload com Zod
  ↓ pega run_id da sessão
  ↓ chama TaskService.create()
TaskService
  ↓ valida com domain (initial state = DRAFT)
  ↓ db.transaction:
  ↓   insere em tasks
  ↓   insere em transitions (action: 'create')
  ↓ audit.write({ kind: 'task_created', ... })
  ↓ sync.appendBuffer({ task_key, md_target })  [persiste em .app/buffer.jsonl]
  ↓ retorna Ok(task)

MCP Server
  ↓ converte Result em response JSON
  ↓ retorna { ok: true, task: { key: 'WEBAPP-58', updated_at: '...' } }

Claude Code
  ↓ recebe response, decide próximo passo
  ↓ (pode usar updated_at em mutações futuras pra versionamento otimista)
```

### 7.2 Fluxo: humano observa via watch

```
Daniel digita: mnema watch --agent=claude-code
CLI
  ↓ carrega config
  ↓ resolve audit dir
  ↓ abre stream:
  ↓   1. lê .audit/current.jsonl existente (catchup se --catchup=Nm)
  ↓   2. fs.watch() em current.jsonl
  ↓   3. para cada linha nova: parse JSON, filtra por --agent
  ↓   4. formata e imprime (humano | table | json)

(Em paralelo, agente cria task)
  ↓ AuditWriter.append() escreve nova linha em current.jsonl

CLI
  ↓ fs.watch() dispara evento
  ↓ lê a partir do offset anterior
  ↓ parseia, filtra, imprime nova linha
```

### 7.3 Fluxo: agent_run termina, plans são archived

```
Claude Code chama: agent_run_end({ status: 'completed' })
MCP Server
  ↓ AgentRunService.end({ run_id, status: 'completed' })
AgentRunService
  ↓ db.transaction:
  ↓   UPDATE agent_runs SET status='completed', ended_at=now WHERE id=run_id
  ↓   [trigger SQL trg_archive_plans_on_run_end dispara]
  ↓   UPDATE agent_plans SET archived_at=now WHERE agent_run_id=run_id
  ↓ audit.write({ kind: 'run_ended', ... })
  ↓ sync.flushAll()  [força flush do buffer da sessão]
```

---

## 8. Identidade dupla — implementação

### 8.1 Captura

**No CLI:**
```typescript
const actor = identityService.getDefaultActor();   // "daniel"
// via e runId ficam undefined
```

**No MCP:**
```typescript
// MCP client (Claude Code) configurado pelo humano:
{
  "mcpServers": {
    "mnema": {
      "command": "mnema",
      "args": ["mcp", "serve"],
      "metadata": { "agent_handle": "claude-code" }
    }
  }
}

// Server lê isso da conexão e injeta em cada chamada:
const via = identityService.resolveAgentActor(connectionMetadata);
// via = "agent:claude-code"

// runId vem do estado da sessão (setado por agent_run_start)
const runId = sessionState.current_run_id;
```

### 8.2 Persistência

```sql
INSERT INTO transitions (
  id, task_id, from_state, to_state, action,
  actor_id,         -- sempre humano (daniel)
  via_actor_id,     -- agente (agent:claude-code) ou NULL
  agent_run_id,     -- run UUID ou NULL
  payload, at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
```

### 8.3 Display

```typescript
function formatTransition(t: Transition, actors: Map<string, Actor>): string {
  const actor = actors.get(t.actor_id)!.handle;
  if (!t.via_actor_id) {
    return `${actor} ${t.action}`;
  }
  const via = actors.get(t.via_actor_id)!.handle;
  return `${actor} via ${via} ${t.action}`;
}
```

---

## 9. Decisões de implementação chave

### 9.1 Sync atomicidade

**Problema:** SQLite e markdown podem divergir se crash entre operações.

**Solução:**
1. **SQLite é fonte da verdade durante operação.** Markdown é cache.
2. **Markdown só é gravado depois do commit do SQLite.**
3. **Em crash, SQLite está OK.** `mnema sync` reconcilia markdown.

### 9.2 Concorrência MCP

**Problema:** múltiplos agentes mutando ao mesmo tempo.

**Solução:**
- SQLite WAL + `busy_timeout` resolve a maioria
- Cada operação é uma transaction curta
- Conflitos lógicos (mesmo task, dois moves) são detectados via versão otimista (campo `updated_at` checado no `WHERE` do UPDATE)

### 9.3 Buffer de sync no MCP

**Problema:** push imediato em cada mutação MCP gera I/O excessivo durante runs longos.

**Solução:**
- Buffer in-memory por sessão
- Flush em três triggers: tempo (30s desde última mutação), volume (50 entries), `agent_run_end`
- Crash perde buffer — `mnema sync` reconcilia

### 9.4 Erros estruturados pra LLM

**Problema:** LLMs respondem mal a strings de erro humanas.

**Solução:**
- Toda response de tool MCP tem schema fixo: `{ ok: true, ... } | { ok: false, error: KIND, ... }`
- `error: 'GATE_FAILED'` sempre vem com `missing: string[]` ou `issues: Issue[]`
- LLM lê estruturado, ajusta payload, retry

### 9.5 Workflow como dado, não código

**Problema:** se workflow muda, precisa recompilar?

**Solução:**
- Workflow vive em `workflows/*.json` no projeto
- Carregado em runtime
- Tools MCP são **regeradas** quando workflow muda (no boot do MCP server)
- Mudar workflow é editar JSON + reiniciar MCP server

---

## 10. Concorrência e Crash Recovery

### 10.1 Cenários de concorrência

Mnema lida com 4 cenários:

| # | Cenário | Estratégia |
|---|---|---|
| 1 | CLI humano sozinho | Trivial — single writer |
| 2 | Agente MCP sozinho | Trivial — single writer com buffer |
| 3 | CLI + MCP simultâneos | SQLite WAL + versionamento otimista |
| 4 | Múltiplos MCPs simultâneos (Claude Code + Cursor) | SQLite WAL + versionamento otimista |

### 10.2 Versionamento otimista

Toda entidade mutável tem coluna `updated_at`. Mutações:

```typescript
async function updateTaskState(
  taskId: string, 
  newState: string, 
  expectedUpdatedAt?: string
): Promise<Result<Task, TaskError>> {
  const now = currentTimestamp();
  
  let result;
  if (expectedUpdatedAt) {
    // Caller forneceu timestamp — verificar
    result = db.prepare(`
      UPDATE tasks 
      SET state = ?, updated_at = ?
      WHERE id = ? AND updated_at = ? AND deleted_at IS NULL
    `).run(newState, now, taskId, expectedUpdatedAt);
  } else {
    // Caller não verificou — last write wins (CLI direto)
    result = db.prepare(`
      UPDATE tasks 
      SET state = ?, updated_at = ?
      WHERE id = ? AND deleted_at IS NULL
    `).run(newState, now, taskId);
  }
  
  if (result.changes === 0) {
    if (expectedUpdatedAt) {
      const current = db.prepare('SELECT updated_at FROM tasks WHERE id = ?').get(taskId);
      return Err({ 
        kind: 'CONFLICT', 
        expected_updated_at: expectedUpdatedAt,
        current_updated_at: current?.updated_at,
        message: 'Task was modified concurrently'
      });
    }
    return Err({ kind: 'TASK_NOT_FOUND', task_key: '...' });
  }
  
  return Ok(reloadTask(taskId));
}
```

**Política de uso:**

- **CLI direto:** geralmente NÃO passa `expected_updated_at`. Comportamento "última escrita ganha" é OK pra interação humana sequencial. Exceção: comandos que fazem leitura → modificação → escrita explícitas.
- **MCP agente:** SEMPRE passa `expected_updated_at` (vem do `task_show` anterior). Conflito vira erro estruturado, agente decide retry.

### 10.3 SQLite WAL e busy_timeout

```typescript
db.pragma('journal_mode = WAL');      // múltiplos readers + 1 writer
db.pragma('synchronous = NORMAL');    // suficiente com WAL
db.pragma('busy_timeout = 5000');     // espera 5s antes de E_DB_LOCKED
db.pragma('foreign_keys = ON');       // integridade
db.pragma('wal_autocheckpoint = 1000'); // checkpoint a cada 1000 frames
```

WAL permite leitura sem bloqueio enquanto write rola. `busy_timeout` faz o cliente esperar caso outra transação esteja escrevendo. Após 5s, retorna `E_DB_LOCKED` — cliente decide retry com backoff.

### 10.4 Buffer persistente do MCP

**Problema:** modo buffer do MCP acumula sync pendente em memória. Crash perde tudo.

**Solução:** buffer é arquivo `.app/buffer.jsonl`, write-ahead.

```
.app/
├── state.db          # SQLite com estado canônico
├── buffer.jsonl      # mutações pendentes de flush pra markdown
├── attachments/      # anexos
└── activity.log      # log efêmero (rotaciona)
```

Cada linha do buffer:
```json
{"v":1,"at":"2026-04-30T14:23:05.123Z","kind":"task_updated","task_key":"WEBAPP-42","md_target":"backlog/READY/WEBAPP-42.md","action":"task_start","run_id":"abc"}
```

**Fluxo de write:**

```
1. Service.transition() faz UPDATE em SQLite (transaction)
2. Service.audit.write() append em .audit/current.jsonl (sync)
3. Service.sync.appendBuffer() append em .app/buffer.jsonl (sync)
4. Return Ok ao cliente
   ─── ponto seguro: se crash aqui, recuperação no próximo boot ───
5. (eventualmente) Service.sync.flush() processa buffer → markdown
```

**Fluxo de boot/recovery:**

```typescript
async function bootRecovery(): Promise<void> {
  const bufferPath = '.app/buffer.jsonl';
  if (!fs.existsSync(bufferPath)) return;
  
  const lines = fs.readFileSync(bufferPath, 'utf-8').trim().split('\n');
  if (lines.length === 0 || lines[0] === '') return;
  
  logger.info({ pending: lines.length }, 'Recovering pending sync from buffer');
  
  for (const line of lines) {
    const entry = JSON.parse(line);
    await flushOne(entry);  // idempotente
  }
  
  // Truncate buffer atomicamente
  const tmpPath = bufferPath + '.tmp';
  fs.writeFileSync(tmpPath, '');
  fs.renameSync(tmpPath, bufferPath);
  
  logger.info('Buffer recovery complete');
}
```

**Idempotência:** flush re-aplica mesmo conteúdo do SQLite no markdown. Se markdown já está atualizado, é no-op. Se está desatualizado, fica atualizado. Sem efeito colateral em re-execução.

### 10.5 Detecção e correção de divergência

`mnema sync` é o comando recovery. Modos:

```bash
mnema sync                    # processa buffer pendente, resolve drift normal
mnema sync --bootstrap        # rebuilda markdowns do zero a partir do SQLite
mnema sync --rebuild          # rebuilda SQLite a partir de markdowns + audit (catastrófico)
```

`mnema doctor` detecta:
- Buffer não-vazio mas sem MCP server rodando (orfão)
- Markdown sem entrada correspondente no SQLite
- SQLite com entrada sem markdown
- Frontmatter inválido

---

## 11. Lifecycle do MCP Server

### 11.1 Modelo: stdio per-session

Mnema **não roda como daemon**. Cada cliente MCP (Claude Code, Cursor) faz `spawn` quando a sessão começa. Servidor termina quando cliente fecha.

```
Daniel inicia Claude Code no projeto /home/daniel/myproj
  └─> Claude Code lê config MCP (~/.config/claude-code/mcp.json)
       └─> spawn("mnema", ["mcp", "serve"], { cwd: "/home/daniel/myproj" })
            ├─> Mnema lê mnema.config.json a partir do cwd
            ├─> Roda migrations se schema desatualizado
            ├─> Carrega workflow ativo
            ├─> Gera tools dinâmicas
            ├─> Recovery do buffer se necessário
            └─> Loop: lê stdin (JSON-RPC), escreve stdout
```

### 11.2 Resolução de cwd

**Cliente MCP é responsável** por iniciar o servidor com cwd correto. Configurações típicas:

**Claude Code:**
```json
{
  "mcpServers": {
    "mnema": {
      "command": "mnema",
      "args": ["mcp", "serve"],
      "metadata": { "agent_handle": "claude-code" },
      "cwd": "${workspaceFolder}"
    }
  }
}
```

**Cursor:** similar com `${workspaceRoot}`.

**Sem `cwd` explícito:** Mnema usa `process.cwd()` que é o diretório de onde o cliente foi iniciado. Pode levar a "config not found" se cliente foi iniciado de pasta errada.

### 11.3 Múltiplas instâncias

Daniel abre 2 sessões: Claude Code + Cursor. Resultado:

```
~/myproj/
└── 2 processos `mnema mcp serve` rodando, ambos lendo .app/state.db
```

Comportamento:
- **Reads:** WAL permite múltiplos readers simultâneos
- **Writes:** SQLite serializa, busy_timeout (5s) absorve contenção curta
- **Buffer:** cada server tem seu buffer in-memory. Persistem juntos no mesmo `.app/buffer.jsonl` com lock cooperativo (file lock) durante append.
- **Identidade:** cada server tem `agent_handle` diferente (vem do metadata do cliente). Mutações ficam corretamente atribuídas.

### 11.4 Graceful shutdown

Servidor escuta `SIGINT` e `SIGTERM`. Handler:

```typescript
let shuttingDown = false;

async function gracefulShutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    logger.warn({ signal }, 'Force shutdown');
    process.exit(1);
  }
  shuttingDown = true;
  
  logger.info({ signal }, 'Graceful shutdown started');
  
  // 1. Stop aceitando novas tool calls
  server.setStatus('shutting_down');
  
  // 2. Esperar tool calls em-andamento (max 3s)
  await waitForInflightCompletion({ timeoutMs: 3000 });
  
  // 3. Flush do buffer
  try {
    await syncService.flushAll();
  } catch (err) {
    logger.error({ err }, 'Flush failed during shutdown — buffer preserved');
  }
  
  // 4. Close SQLite
  db.close();
  
  // 5. Encerrar runs ativos como 'aborted' (signal)
  // (Já registrado no audit antes do close)
  
  logger.info('Graceful shutdown complete');
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Hard timeout: 5s
setTimeout(() => {
  if (shuttingDown) {
    logger.fatal('Shutdown timeout — forcing exit');
    process.exit(1);
  }
}, 5000).unref();
```

### 11.5 Comando `mnema mcp install-instructions <client>`

Imprime configuração pra adicionar ao cliente. Exemplos suportados no MVP:

```bash
mnema mcp install-instructions claude-code
mnema mcp install-instructions cursor
mnema mcp install-instructions aider
mnema mcp install-instructions generic       # exemplo agnóstico
```

Output inclui path absoluto do binário Mnema (descoberto via `which mnema` ou `process.execPath`), agent_handle sugerido, e lembrete de definir `cwd` corretamente.

---

## 12. Logging Interno

### 12.1 Stack: Pino

```typescript
// src/utils/logger.ts
import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';
const isTty = process.stderr.isTTY;
const format = process.env.MNEMA_LOG_FORMAT ?? (isTty && isDev ? 'pretty' : 'json');

export const logger = pino({
  level: process.env.MNEMA_LOG_LEVEL ?? 'info',
  base: { pid: process.pid, name: 'mnema' },
  redact: {
    paths: [
      '*.title', '*.description', '*.content',     // conteúdo privado
      '*.metadata', '*.payload',                    // pode conter dados sensíveis
      '*.acceptance_criteria',
      '*.token', '*.api_key', '*.password',         // óbvios
    ],
    censor: '[REDACTED]',
  },
  transport: format === 'pretty'
    ? { target: 'pino-pretty', options: { destination: 2, colorize: true } }
    : undefined,  // JSON pro stderr direto
});
```

### 12.2 Variáveis de ambiente

| Variável | Default | Função |
|---|---|---|
| `MNEMA_LOG_LEVEL` | `info` | trace/debug/info/warn/error/fatal |
| `MNEMA_LOG_FORMAT` | `pretty` em TTY, `json` caso contrário | força formato |
| `MNEMA_LOG_FILE` | (não-setado) | se setado, redireciona pra arquivo (rotaciona em 10MB) |

### 12.3 Quando logar o quê

| Situação | Nível | Exemplo |
|---|---|---|
| Entrada/saída de função em domain | `trace` | `entering validateTransition` |
| Decisões internas de fluxo | `debug` | `chose buffer mode for sync` |
| Boot, shutdown, migration | `info` | `migration 003 applied` |
| Retry, busy_timeout, recoverable | `warn` | `db locked, retrying` |
| Erro de operação | `error` | `task_create failed: ...` |
| Antes de exit forçado | `fatal` | `cannot recover, exiting` |

### 12.4 Separação clara de responsabilidades

| Tipo de evento | Onde vai | Por quê |
|---|---|---|
| Eventos de domínio (task moveu, decisão registrada) | `.audit/*.jsonl` | Auditoria, fonte da verdade do trabalho |
| Atividade efêmera do agente (reads, errors triviais) | `.app/activity.log` | Não polui audit |
| Logs do **sistema** Mnema (trace, debug, internal errors) | stderr / `MNEMA_LOG_FILE` | Debug do código |

**Logger NUNCA imprime conteúdo de tasks/decisions.** `redact` previne acidentes.

### 12.5 Logging em modo MCP server

CRITICAL: logs vão pra **stderr** (não stdout), porque stdout é o canal JSON-RPC do MCP. Stdout poluído quebra o protocolo.

`pino` default é stderr (file descriptor 2). Confirmar nunca redirecionar pra stdout.

---

## 13. Meta-schema do Workflow JSON

### 13.1 Estrutura completa

```typescript
// src/domain/stateMachine/meta-schema.ts
import { z } from 'zod';

const StringFormatEnum = z.enum(['url', 'email', 'uuid', 'iso8601', 'task_key']);

const FieldSpecBase = z.object({
  optional: z.boolean().optional(),
  default: z.unknown().optional(),
  description: z.string().optional(),
});

const StringFieldSpec: z.ZodType = FieldSpecBase.extend({
  type: z.literal('string'),
  min: z.number().int().nonnegative().optional(),
  max: z.number().int().positive().optional(),
  format: StringFormatEnum.optional(),
  pattern: z.string().optional(),
});

const NumberFieldSpec: z.ZodType = FieldSpecBase.extend({
  type: z.literal('number'),
  min: z.number().optional(),
  max: z.number().optional(),
  integer: z.boolean().optional(),
  enum: z.array(z.number()).optional(),
});

const BooleanFieldSpec: z.ZodType = FieldSpecBase.extend({
  type: z.literal('boolean'),
});

const ArrayFieldSpec: z.ZodType = z.lazy(() => FieldSpecBase.extend({
  type: z.literal('array'),
  items: FieldSpec,
  min: z.number().int().nonnegative().optional(),
  max: z.number().int().positive().optional(),
  unique: z.boolean().optional(),
}));

const ObjectFieldSpec: z.ZodType = z.lazy(() => FieldSpecBase.extend({
  type: z.literal('object'),
  properties: z.record(FieldSpec),
}));

const FieldSpec: z.ZodType = z.discriminatedUnion('type', [
  StringFieldSpec, NumberFieldSpec, BooleanFieldSpec, ArrayFieldSpec, ObjectFieldSpec,
]);

const TransitionSpec = z.object({
  to: z.string(),
  description: z.string().min(10),
  use_when: z.string().min(10),
  requires: z.record(FieldSpec).default({}),
});

export const WorkflowMetaSchema = z.object({
  schema_version: z.literal('1.0'),
  name: z.string().min(1),
  description: z.string().optional(),
  states: z.array(z.string()).min(2),
  initial: z.string(),
  terminal: z.array(z.string()).default([]),
  features: z.object({
    sprints: z.boolean().default(false),
    epics: z.boolean().default(false),
    review_workflow: z.boolean().default(false),
    blocked_state: z.boolean().default(false),
  }).default({}),
  transitions: z.record(z.record(TransitionSpec)),
}).refine(
  (w) => w.states.includes(w.initial),
  { message: 'initial state must be in states[]' }
).refine(
  (w) => w.terminal.every((t) => w.states.includes(t)),
  { message: 'all terminal states must be in states[]' }
);
```

### 13.2 Tabela de tradução pra Zod

| JSON spec | Zod equivalente |
|---|---|
| `{ "type": "string", "min": 3 }` | `z.string().min(3)` |
| `{ "type": "string", "min": 3, "max": 200 }` | `z.string().min(3).max(200)` |
| `{ "type": "string", "format": "url" }` | `z.string().url()` |
| `{ "type": "string", "format": "email" }` | `z.string().email()` |
| `{ "type": "string", "format": "uuid" }` | `z.string().uuid()` |
| `{ "type": "string", "format": "iso8601" }` | `z.string().datetime()` |
| `{ "type": "string", "format": "task_key" }` | `z.string().regex(/^[A-Z][A-Z0-9]*-\d+$/)` |
| `{ "type": "string", "pattern": "^foo" }` | `z.string().regex(/^foo/)` |
| `{ "type": "number" }` | `z.number()` |
| `{ "type": "number", "integer": true }` | `z.number().int()` |
| `{ "type": "number", "min": 0, "max": 100 }` | `z.number().min(0).max(100)` |
| `{ "type": "number", "enum": [1, 2, 3] }` | `z.number().refine(v => [1,2,3].includes(v))` |
| `{ "type": "boolean" }` | `z.boolean()` |
| `{ "type": "array", "items": <spec> }` | `z.array(<traduzido>)` |
| `{ "type": "array", "items": ..., "min": 1 }` | `z.array(...).min(1)` |
| `{ "type": "array", ..., "unique": true }` | `z.array(...).refine(arr => new Set(arr).size === arr.length)` |
| `{ "type": "object", "properties": {...} }` | `z.object({...})` |
| `{ ..., "optional": true }` | `.optional()` |
| `{ ..., "default": ... }` | `.default(...)` |

### 13.3 Implementação de `jsonRequiresToZod`

```typescript
// src/domain/stateMachine/Workflow.ts
function fieldSpecToZod(spec: FieldSpec): z.ZodType {
  let schema: z.ZodType;
  
  switch (spec.type) {
    case 'string': {
      let s = z.string();
      if (spec.min !== undefined) s = s.min(spec.min);
      if (spec.max !== undefined) s = s.max(spec.max);
      if (spec.format === 'url') s = s.url();
      if (spec.format === 'email') s = s.email();
      if (spec.format === 'uuid') s = s.uuid();
      if (spec.format === 'iso8601') s = s.datetime();
      if (spec.format === 'task_key') s = s.regex(/^[A-Z][A-Z0-9]*-\d+$/);
      if (spec.pattern) s = s.regex(new RegExp(spec.pattern));
      schema = s;
      break;
    }
    case 'number': {
      let n = z.number();
      if (spec.integer) n = n.int();
      if (spec.min !== undefined) n = n.min(spec.min);
      if (spec.max !== undefined) n = n.max(spec.max);
      if (spec.enum) {
        const allowed = spec.enum;
        n = n.refine(v => allowed.includes(v), { message: `Must be one of ${allowed.join(', ')}` });
      }
      schema = n;
      break;
    }
    case 'boolean':
      schema = z.boolean();
      break;
    case 'array': {
      let a = z.array(fieldSpecToZod(spec.items));
      if (spec.min !== undefined) a = a.min(spec.min);
      if (spec.max !== undefined) a = a.max(spec.max);
      if (spec.unique) a = a.refine(arr => new Set(arr).size === arr.length, { message: 'Items must be unique' });
      schema = a;
      break;
    }
    case 'object': {
      const shape: Record<string, z.ZodType> = {};
      for (const [k, v] of Object.entries(spec.properties)) {
        shape[k] = fieldSpecToZod(v);
      }
      schema = z.object(shape);
      break;
    }
  }
  
  if (spec.optional) schema = schema.optional();
  if (spec.default !== undefined) schema = schema.default(spec.default);
  return schema;
}

export function jsonRequiresToZod(requires: Record<string, FieldSpec>): z.ZodObject<any> {
  const shape: Record<string, z.ZodType> = {};
  for (const [k, v] of Object.entries(requires)) {
    shape[k] = fieldSpecToZod(v);
  }
  return z.object(shape);
}
```

### 13.4 Erro de validação amigável

Quando workflow JSON falha a validação:

```
workflows/custom.json is invalid:
  transitions.DRAFT.submit.requires.title.format: unsupported format "phone"
  transitions.READY.start.to: state "DOING" not in states[]
hint: Supported string formats: url, email, uuid, iso8601, task_key
```

Implementação extrai `path` do `ZodError.issues` e formata.

### 13.5 Fora de escopo (v2 ou nunca)

Não suportado no MVP, documentado:

- `$ref` (refs entre definitions) — adia
- `oneOf`/`anyOf` — adia
- Validações cross-field ("se A=true, B é required") — adia
- Tipos custom registrados pelo projeto — adia

Workflow tenta usar feature não-suportada → `E_WORKFLOW_INVALID` com mensagem clara.

---

## 14. Testes

### 14.1 Estratégia em pirâmide

```
        ┌──────────┐
        │   E2E    │  ~10 testes
        │  (CLI)   │
        └────┬─────┘
       ┌─────┴──────┐
       │ Integration │ ~50 testes
       │ (SQLite real)│
       └─────┬──────┘
      ┌──────┴───────┐
      │     Unit      │ ~200+ testes
      │ (TS puro)     │
      └───────────────┘
```

### 10.2 Unit — testar domain isoladamente

```typescript
describe('StateMachine', () => {
  it('rejects transition from invalid state', () => {
    const sm = new StateMachine(loadDefaultWorkflow());
    const result = sm.validateTransition('DONE', 'submit', {});
    expect(result.ok).toBe(false);
    expect(result.error.kind).toBe('INVALID_TRANSITION');
  });
  
  it('validates payload against gates', () => {
    const sm = new StateMachine(loadDefaultWorkflow());
    const result = sm.validateTransition('DRAFT', 'submit', {
      title: 'x',  // too short
    });
    expect(result.ok).toBe(false);
    expect(result.error.kind).toBe('GATE_FAILED');
  });
});
```

### 10.3 Integration — testar com SQLite real em /tmp

```typescript
describe('TaskService.transition', () => {
  let services: Services;
  let tmpDir: string;
  
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mnema-'));
    services = createServicesForTest(tmpDir);
    seedProjectAndActor(services);
  });
  
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
  
  it('records transition in audit and DB', async () => {
    const task = await services.task.create({ ... });
    
    const result = await services.task.transition({
      taskKey: task.value.key,
      action: 'submit',
      payload: { title: '...', description: '...', acceptance_criteria: ['...'], estimate: 5 },
      actor: 'daniel',
    });
    
    expect(result.ok).toBe(true);
    expect(result.value.state).toBe('READY');
    
    // Verifica audit
    const auditLines = fs.readFileSync(path.join(tmpDir, '.audit/current.jsonl'), 'utf-8')
      .trim().split('\n').map(l => JSON.parse(l));
    expect(auditLines.some(l => l.kind === 'task_transitioned')).toBe(true);
    
    // Verifica transitions table
    const transitions = services.repos.task.transitionsFor(task.value.id);
    expect(transitions.length).toBe(2);  // create + submit
  });
});
```

### 10.4 E2E — CLI rodando como subprocess

```typescript
describe('mnema CLI', () => {
  it('init creates expected structure', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mnema-e2e-'));
    
    const result = await execa('mnema', ['init', '--name=Test', '--key=TEST', '--actor=tester', '--yes'], {
      cwd: tmpDir,
    });
    
    expect(result.exitCode).toBe(0);
    expect(fs.existsSync(path.join(tmpDir, 'mnema.config.json'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'AGENTS.md'))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.app/state.db'))).toBe(true);
  });
});
```

---

## 15. Performance — orçamentos

| Operação | Orçamento alvo | Como medir |
|---|---|---|
| `mnema --version` | < 50ms | `time mnema --version` |
| `mnema task list` (1k tasks) | < 200ms | bench com seed |
| `mnema task move ...` | < 100ms | bench |
| MCP `task_create` (cold) | < 200ms | bench in-process |
| MCP `task_create` (warm, buffered) | < 20ms | bench in-process |
| `mnema watch` latência | < 100ms | timestamp diff |
| `mnema sync` (rebuild full) | < 5s pra 10k tasks | bench |

**Estratégias:**
- Lazy loading de módulos pesados (importar `better-sqlite3` só quando necessário)
- Connection pooling não aplicável (SQLite single-process), mas pragmas certos no boot
- FTS5 pra search em vez de LIKE
- Indexes corretos (já no schema 001)

---

## 16. Segurança

### 12.1 Threat model

Mnema **não é multi-tenant**. Confiamos no usuário operador. Mas há vetores a considerar:

| Ameaça | Mitigação |
|---|---|
| Agente malicioso forja `agent_handle` | `client_metadata` (pid, hostname) capturado da conexão, dificulta spoof |
| Path traversal via task key | Validação Zod em todos os inputs, `[A-Z]+-\d+` regex |
| SQL injection | Prepared statements em 100% das queries (better-sqlite3 default) |
| Anexos maliciosos | Limite de tamanho, scan de extensão, hash não-executável |
| Audit log adulterado | `.audit/` versionado no Git — divergência é detectável via `git diff` |
| Config carregado de árvore acima | `mnema.config.json` validado com Zod estrita; recusa se schema inválido |

### 12.2 Não é uma sandbox

Mnema **não restringe** o que agentes podem fazer no projeto. Se o agente tem acesso ao filesystem do projeto, ele pode editar tudo. Mnema só **registra** o que o agente reportou.

Mitigação no nível do agente: Claude Code tem sandbox próprio, configurações de permissão, etc. Não é responsabilidade do Mnema.

---

## 17. Versionamento e compatibilidade

### 13.1 Semver pro CLI

- **Major:** mudança de schema SQLite, mudança de formato JSON do workflow, breaking change em API MCP
- **Minor:** novos comandos, novas tools MCP, novas migrations aditivas
- **Patch:** bugfixes

### 13.2 Schema versioning

`schema_migrations` table. Novas migrations adicionam registros. Downgrade não é suportado — Mnema bloqueia se schema é mais novo que código.

### 13.3 Workflow JSON versioning

```json
{ "schema_version": "1.0", "name": "default", ... }
```

Loader checa `schema_version`. Se incompatível, sugere upgrade.

---

## Apêndice A — Princípios gerais de código

- **TypeScript estrito** (`strict: true`, `noUncheckedIndexedAccess: true`, `noImplicitOverride: true`)
- **Sem `any`** — usar `unknown` + validação Zod
- **Imports absolutos** via path alias (`@/services/...`)
- **Erros tipados, nunca `throw`** dentro de Services. `throw` só em violação de invariante (ex: connection lost, programming error)
- **Logs estruturados** (JSON em produção, pretty em dev) via Pino
- **Imports ordenados:** stdlib → external → `@/` interno → relativo

---

## Apêndice B — Convenções de código (obrigatórias)

> **Este apêndice é normativo, não descritivo.** O agente de IA implementando Mnema **deve** seguir cada regra. Em caso de dúvida, este documento prevalece sobre intuição.

### B.1 Naming de arquivos: kebab-case sempre

**Obrigatório:** todos os arquivos `.ts` em kebab-case, inclusive testes.

```
✅ task-service.ts
✅ task-service.test.ts
✅ state-machine.ts
✅ workflow-schema-translator.ts
✅ mnema-config-schema.ts

❌ TaskService.ts
❌ taskService.ts
❌ task_service.ts
```

**Sufixos descritivos:**
- `*-service.ts` — classes de serviço (orquestração)
- `*-repository.ts` — classes de acesso a dados
- `*-tool.ts` — implementações de tool MCP
- `*-command.ts` — comandos CLI
- `*-validator.ts` — validadores Zod compostos
- `*-adapter.ts` — adapters de I/O externo
- `*-helpers.ts` — funções utilitárias soltas
- `*-formatter.ts` — formatadores de output

**Migrations** mantêm o formato existente: `001_initial.sql`, `002_fts_attachments.sql`.

### B.2 Estruturas: OOP-first, funções soltas como exceção

**Use class quando o código:**
- Tem estado interno (campos)
- Tem lifecycle (construtor, métodos relacionados)
- Tem múltiplas operações relacionadas em torno de uma responsabilidade
- É injetado como dependência (services, repositories, adapters)

```typescript
✅ class TaskService {
  constructor(
    private readonly repository: TaskRepository,
    private readonly stateMachine: StateMachine,
    private readonly auditService: AuditService,
  ) {}

  async transition(args: TransitionArgs): Promise<Result<Task, TaskError>> { ... }
  async create(args: CreateArgs): Promise<Result<Task, TaskError>> { ... }
}
```

**Use funções soltas exportadas quando o código é:**
- Stateless (sem estado interno)
- Puro (mesmo input → mesmo output, sem side effects)
- Utility focado em uma única operação

```typescript
✅ // src/domain/id-generator.ts
export function generateUuid(): string {
  return v7();
}

export function generateTaskKey(projectKey: string, sequence: number): string {
  return `${projectKey}-${sequence}`;
}

export function parseTaskKey(key: string): { projectKey: string; sequence: number } | null { ... }
```

**Anti-padrão a evitar:**

```typescript
❌ // Classe com métodos estáticos só pra agrupar utility — não use
class IdGenerator {
  static generateUuid(): string { ... }
  static generateTaskKey(...): string { ... }
}
```

Prefira funções soltas em `id-generator.ts`.

### B.3 Enums: TypeScript enum nativo com string values

**Obrigatório:** TypeScript enum nativo com valores string.

```typescript
✅ // src/domain/enums/task-state.ts
export enum TaskState {
  Draft = 'DRAFT',
  Ready = 'READY',
  InProgress = 'IN_PROGRESS',
  Blocked = 'BLOCKED',
  InReview = 'IN_REVIEW',
  Done = 'DONE',
  Canceled = 'CANCELED',
}

// Uso:
const task: Task = { state: TaskState.Draft, ... };
if (task.state === TaskState.InProgress) { ... }
```

**Por que:** valor string é serializável em JSON/SQLite, enum nativo provê namespace e autocomplete, evita strings mágicas espalhadas.

**Convenção de nome:**
- Nome do enum em `PascalCase`, singular: `TaskState`, `AgentRunStatus`
- Membros em `PascalCase`: `Draft`, `InProgress` (não `DRAFT`, não `IN_PROGRESS`)
- Valores string em `SCREAMING_SNAKE_CASE`: `'DRAFT'`, `'IN_PROGRESS'`
- Razão: distingue identificador (membro) de valor serializado (string)

**Anti-padrões:**

```typescript
❌ // Enum numérico — perde legibilidade ao serializar
enum TaskState { Draft, Ready, InProgress }

❌ // Const object com 'as const' — não use, prefira enum nativo
const TaskState = { Draft: 'DRAFT', ... } as const;

❌ // Union literal — só pra valores realmente livres (ex: nome de workflow customizado)
type TaskState = 'DRAFT' | 'READY' | 'IN_PROGRESS';
```

### B.4 Interfaces vs Types: regra clara

**Use `interface` para:**
- Entidades de domínio (Task, Decision, Sprint, Actor, AgentRun, AgentPlan)
- Contratos/portas (TaskRepository, AuditService) quando há implementação
- Estruturas estendíveis ou implementáveis

```typescript
✅ // src/domain/entities/task.ts
export interface Task {
  readonly id: string;
  readonly key: string;
  readonly projectId: string;
  readonly state: TaskState;
  readonly title: string;
  readonly description: string;
  readonly acceptanceCriteria: readonly string[];
  readonly estimate: number | null;
  readonly assigneeId: string | null;
  readonly reporterId: string;
  readonly sprintId: string | null;
  readonly epicId: string | null;
  readonly reopenCount: number;
  readonly metadata: Record<string, unknown>;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly deletedAt: string | null;
}
```

**Use `type` para:**
- Unions e discriminated unions (TaskError, ErrorOutput)
- Aliases compostos (`Result<T, E>`)
- Mapped, conditional, ou tipos derivados

```typescript
✅ // src/services/result.ts
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

✅ // src/services/task-errors.ts
export type TaskError =
  | { kind: 'GATE_FAILED'; issues: readonly Issue[]; missing: readonly string[] }
  | { kind: 'INVALID_TRANSITION'; from: TaskState; action: string }
  | { kind: 'TASK_NOT_FOUND'; taskKey: string }
  | { kind: 'CONFLICT'; expectedUpdatedAt: string; currentUpdatedAt: string }
  | { kind: 'DUPLICATE_KEY'; taskKey: string };
```

**Convenção:**
- Nome em `PascalCase`, singular
- Sem prefixo `I` em interfaces (estilo TS moderno, não Java)
- `readonly` em campos de entidades imutáveis

### B.5 Result<T, E>: factories soltas

```typescript
✅ // src/services/result.ts

/**
 * Discriminated union representing success or failure of an operation.
 * Use the Ok and Err factories to construct values.
 */
export type Result<T, E> = 
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/**
 * Constructs a successful Result containing the given value.
 *
 * @param value - The success value to wrap
 * @returns A Result indicating success
 */
export function Ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/**
 * Constructs a failed Result containing the given error.
 *
 * @param error - The error value to wrap
 * @returns A Result indicating failure
 */
export function Err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}
```

**Uso:**

```typescript
return Ok(task);
return Err({ kind: 'TASK_NOT_FOUND', taskKey: 'WEBAPP-42' });
```

### B.6 JSDoc: completo em APIs públicas

**Obrigatório:** todas as funções e métodos exportados/públicos têm JSDoc completo com `@param`, `@returns` e descrição.

**Formato:**

```typescript
✅ /**
 * Transitions a task to a new state by executing a workflow action.
 * Validates the transition against the active workflow's gates and
 * persists the change atomically with audit trail.
 *
 * @param args.taskKey - Human-readable task identifier (e.g., "WEBAPP-42")
 * @param args.action - Action name as defined in the workflow (e.g., "submit")
 * @param args.payload - Field values required by the action's gate
 * @param args.actor - Human responsible for this mutation
 * @param args.via - Optional agent intermediary (omit for direct CLI use)
 * @param args.runId - Required when via is provided
 * @param args.expectedUpdatedAt - Optional optimistic concurrency token
 * @returns Result with the updated task on success, or a typed error
 */
async transition(args: TransitionArgs): Promise<Result<Task, TaskError>> {
  // implementation
}
```

**Para classes:**

```typescript
✅ /**
 * Orchestrates task lifecycle: creation, state transitions, queries.
 * All mutations are atomic (single SQLite transaction) and audited.
 *
 * Reads do not require an active agent run; mutations do.
 */
export class TaskService {
  // ...
}
```

**Métodos privados:**
- JSDoc opcional, mas recomendado quando lógica não é óbvia
- Pode ser uma linha sem `@param`/`@returns`

```typescript
✅ /** Loads the task and validates it exists and is not deleted. */
private async loadActiveTask(taskKey: string): Promise<Result<Task, TaskError>> { ... }
```

**Funções soltas exportadas:** mesmo padrão de JSDoc completo.

```typescript
✅ /**
 * Generates a sortable UUID v7 (time-ordered).
 *
 * @returns A UUID v7 string in canonical form
 */
export function generateUuid(): string {
  return v7();
}
```

### B.7 Comentários: regras estritas

**O que comentários DEVEM fazer:**
- Descrever **o que** o código faz (intenção)
- Documentar **como usar** (contrato, pre/post-condições)
- Explicar **constraints técnicas** relevantes (limites, edge cases)
- Apontar trade-offs ativos no código (não no histórico)

**O que comentários NÃO PODEM ter:**

```typescript
❌ // Decidido na sprint 3 que isso seria assim
❌ // Daniel pediu pra mudar isso em 2026-04-30
❌ // Antes era X mas mudamos pra Y depois da reunião
❌ // TODO: rever depois da revisão com o time
❌ // Por causa do issue #142, agora é assim
❌ // Como conversamos, vou deixar pendente
❌ // FIXME: workaround temporário até resolver com PM
```

**Histórico vai pra:**
- Git commits (mensagem descritiva do "por quê")
- ADRs em `memory/decisions/` (decisões arquiteturais)
- Changelog (releases públicas)

**Comentários aceitáveis no código:**

```typescript
✅ // better-sqlite3 is synchronous — no Promise needed despite async signature
✅ // Caller must provide expectedUpdatedAt for optimistic concurrency
✅ // Returns Err on conflict; caller decides retry strategy
✅ // Order matters: audit must succeed before sync to maintain consistency
✅ // SAFETY: triggers in migration 003 ensure plans are archived
```

**Regra prática:** se o comentário explicaria contexto histórico ou conversacional, não escreva. Se o comentário ajudaria alguém lendo pela primeira vez a entender contrato/intenção, escreva.

### B.8 Convenções de classes

**Construtor com dependency injection:**

```typescript
✅ export class TaskService {
  constructor(
    private readonly repository: TaskRepository,
    private readonly stateMachine: StateMachine,
    private readonly auditService: AuditService,
    private readonly syncService: SyncService,
  ) {}
}
```

- Dependências como `private readonly`
- Sem mutação de campos depois do construtor (preferir imutabilidade)
- Sem lógica complexa em construtor (use factory method se necessário)

**Métodos:**

```typescript
✅ class TaskService {
  /** JSDoc... */
  async transition(args: TransitionArgs): Promise<Result<Task, TaskError>> { ... }

  /** JSDoc... */
  async create(args: CreateArgs): Promise<Result<Task, TaskError>> { ... }

  // Privados sem JSDoc obrigatório
  private buildTransitionEvent(task: Task, action: string): AuditEvent { ... }
}
```

- Public API com JSDoc completo
- Privates com prefixo de visibilidade explícito (`private`)
- Sem getters/setters quando propriedade simples basta

**Sem herança rasa por estilo:**

```typescript
❌ // Anti-padrão: herança só por reuso
abstract class BaseService {
  protected logger = createLogger();
  protected handleError(err: unknown) { ... }
}
class TaskService extends BaseService { ... }

✅ // Preferir composição
class TaskService {
  constructor(private readonly logger: Logger) { ... }
}
```

Herança só quando há **subtipagem real** (Liskov substitution).

### B.9 Imutabilidade

- **Entidades de domínio:** todos os campos `readonly`
- **Arrays em entidades:** `readonly` (`readonly string[]`)
- **Records em entidades:** preferir `Readonly<...>` quando possível

```typescript
✅ export interface Task {
  readonly id: string;
  readonly acceptanceCriteria: readonly string[];
  readonly metadata: Readonly<Record<string, unknown>>;
}
```

- Atualização produz nova instância via spread:

```typescript
const updated: Task = { ...task, state: TaskState.Ready, updatedAt: now() };
```

### B.10 async/await sempre, evitar callbacks

```typescript
✅ async function loadConfig(): Promise<Config> {
  const raw = await fs.readFile(path, 'utf-8');
  return ConfigSchema.parse(JSON.parse(raw));
}

❌ function loadConfig(callback: (err, config) => void) { ... }
```

Exceção: callbacks aceitos quando API externa exige (ex: `fs.watch` em watch mode).

### B.11 Erros: nunca throw em Services, sempre Result

```typescript
✅ async transition(args: TransitionArgs): Promise<Result<Task, TaskError>> {
  const task = await this.repository.findByKey(args.taskKey);
  if (task === null) {
    return Err({ kind: 'TASK_NOT_FOUND', taskKey: args.taskKey });
  }
  // ...
  return Ok(updatedTask);
}

❌ async transition(args: TransitionArgs): Promise<Task> {
  const task = await this.repository.findByKey(args.taskKey);
  if (task === null) {
    throw new Error('Task not found');
  }
  // ...
}
```

**Throw é permitido em:**
- Storage layer quando SQLite/fs falham catastroficamente (será capturado em service e convertido em Result)
- Programming errors (assertion failures, invariantes violadas) — usar `throw new Error('Invariant violated: ...')` faz sentido aqui

### B.12 Imports

**Ordem:**
1. Standard library Node (`node:fs`, `node:path`)
2. Externos npm (sem prefixo)
3. Internos com path alias (`@/...`)
4. Relativos (`./...`, `../...`)

**Uma linha em branco entre grupos.**

```typescript
✅ import { readFileSync } from 'node:fs';
import path from 'node:path';

import { z } from 'zod';
import matter from 'gray-matter';

import { TaskState } from '@/domain/enums/task-state.js';
import { Task } from '@/domain/entities/task.js';
import { Ok, Err, Result } from '@/services/result.js';

import { TaskRepository } from './task-repository.js';
```

**Use `.js` em imports** mesmo importando `.ts` (NodeNext requirement).

### B.13 Resumo executivo das regras

| Aspecto | Regra |
|---|---|
| Naming de arquivos | kebab-case sempre, inclusive testes |
| Estado/lifecycle/dependências | class |
| Util stateless puro | função solta exportada |
| Enums | `enum` nativo com string values |
| Entidades | `interface` com `readonly` |
| Unions/aliases | `type` |
| Result | factories `Ok`/`Err` soltas |
| JSDoc | completo (`@param`, `@returns`) em públicos |
| Comentários proibidos | histórico, sprints, conversas, TODOs com data |
| Erros em Services | `Result<T, E>`, nunca throw |
| Imutabilidade | `readonly` em entidades |
| async | `async/await`, sem callbacks |
| Imports | ordenados, com `.js`, path alias `@/` |
