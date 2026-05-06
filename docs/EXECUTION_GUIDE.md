# Mnema — Guia de Execução pra IA

> **Audiência primária:** agente de IA (Claude Code, Cursor, Aider) implementando Mnema do zero.
> **Audiência secundária:** humano supervisionando/revisando o trabalho.
> **Versão:** v1.2 · **Pré-requisitos obrigatórios:** ler `DESIGN.md`, `ARCHITECTURE.md` (com atenção ao Apêndice B), e `errors-catalog.md` ANTES de começar.
>
> **Mudanças v1.2:** Convenções de código formalizadas como obrigatórias. Princípio operacional 0 adicionado (consultar Apêndice B do ARCHITECTURE.md). Snippets de código revisados pra usar kebab-case, classes pra estado, funções soltas pra util, JSDoc completo, enums nativos. Anti-padrões expandidos com violações de convenções.
>
> **Mudanças v1.1:** Atualizado pra refletir resolução dos 8 gaps críticos. Stack consolidada (Commander, Biome, Pino, gray-matter). Markdown agora usa YAML frontmatter. MCP Fase 5 inclui `context_bootstrap` como tool obrigatória. Catálogo de erros referenciado.

Este documento converte o design em um plano de execução acionável. Está organizado em **fases**, cada fase com **objetivos**, **entregas verificáveis**, **ordem de implementação**, e **critérios de pronto**.

---

## Princípios operacionais (leia antes de escrever uma linha)

### 0. Convenções de código são obrigatórias

**Antes de escrever qualquer linha, leia o Apêndice B do `ARCHITECTURE.md`.** As convenções não são preferência — são obrigatórias e não-negociáveis. Resumo executivo das regras:

- **Naming de arquivos:** kebab-case sempre, inclusive testes (`task-service.ts`, `task-service.test.ts`)
- **Estado/lifecycle/dependências:** classes com construtor `private readonly`
- **Util stateless puro:** funções soltas exportadas (ex: `generateUuid()`)
- **Enums:** `enum` nativo TS com valores string (não union literal, não const object)
- **Entidades:** `interface` exportada com `readonly` em todos os campos
- **Unions/aliases:** `type`
- **Result:** factories `Ok`/`Err` soltas (não classe)
- **JSDoc:** completo (`@param`, `@returns`) em toda função/método público
- **Comentários proibidos:** histórico de decisão, refs a sprints, conversas, TODOs com data
- **Erros em Services:** `Result<T, E>`, nunca `throw`
- **Imutabilidade:** `readonly` em entidades; updates produzem nova instância via spread
- **async:** `async/await` sempre, sem callbacks (exceto APIs externas que exigem)
- **Imports:** ordenados (stdlib → external → `@/` → relativo) com `.js` suffix

Se o agente de IA escrever código violando essas regras, deve refatorar antes de prosseguir. Code review é obrigatório no nível de cada incremento.

### 1. Pequeno, verificável, commit

Cada **incremento** entregue deve ser:
- **Pequeno** — 1 a 4 horas de trabalho equivalente
- **Verificável** — tem teste automatizado ou demo manual claramente especificada
- **Commit** — vai pra Git com mensagem descritiva ANTES de começar o próximo

Não acumule mudanças sem commit. Não pule testes. Não comece a próxima tarefa antes da anterior estar verde.

### 2. Camadas de baixo pra cima

**Sempre implemente da camada mais profunda primeiro:**
1. Storage (SQLite adapter, repos)
2. Domain (StateMachine, entities, validators)
3. Services (orquestração)
4. Interface (CLI, MCP)

Resista a tentação de "fazer um end-to-end fininho primeiro". Esse anti-padrão acumula débito técnico em camadas de fundação.

### 3. Testes acompanham o código, não vêm depois

Toda PR/incremento de Service ou Domain entra com:
- Testes unitários (TS puro, sem I/O)
- Testes de integração quando há SQLite envolvido

Tests-first é ideal mas não obrigatório. Tests-with é obrigatório.

### 4. Result<T, E> em todo lugar que pode falhar

Nunca lance `throw` em código de domínio ou serviço. Retorne `Result`. Throw é reservado pra violação de invariante (estado impossível) ou falha catastrófica de I/O.

### 5. Workflow é dado, não código

Nada do que estiver hardcoded em TS pode duplicar conhecimento que está em `workflows/*.json`. Se sentir necessidade de hardcodar estado ou transição, pare e passe pelo workflow loader.

### 6. Reportar progresso ao humano

Se você é um agente operando via Claude Code/Cursor:
- Use `mnema task create` (depois que o sistema existir) pra registrar trabalho
- Use `agent_run_start` antes de mutações
- Comente em PRs / commits o que foi feito e por quê

Antes do Mnema existir (Fase 0-2), use o sistema do projeto-mãe que estiver hospedando o desenvolvimento (provavelmente o próprio Mnema sendo desenvolvido em outro repo, ou Linear, ou GitHub Projects).

### 7. Quando travar, parar e pedir

Se uma decisão não tiver resposta clara em `DESIGN.md` ou `ARCHITECTURE.md`, NÃO escolha por conta. Pare, descreva o impasse, peça orientação humana. Decisão arbitrária no início vira débito enorme depois.

---

## Setup inicial — antes da Fase 0

### Pré-requisitos do humano

Antes de soltar o agente pra implementar, o humano deve garantir:

- [ ] Repo Git criado (vazio ou com README mínimo)
- [ ] Org `saurim` criada no npm (ou definida o nome final do scope)
- [ ] Org `saurim` (ou fallback `saurimhq`) criada no GitHub
- [ ] Node.js 20+ instalado
- [ ] pnpm ou npm instalado (recomendação: pnpm)
- [ ] Editor com TypeScript LSP funcionando

### Setup do agente

Antes de começar a escrever código, o agente deve:

1. Ler **`DESIGN.md`** completo (~1.400 linhas) — entendimento de visão e decisões
2. Ler **`ARCHITECTURE.md`** completo (~1.700 linhas) — entendimento técnico, **com atenção especial ao Apêndice B (Convenções de código obrigatórias)**
3. Ler **`errors-catalog.md`** completo (~500 linhas) — referência de erros
4. Ler **este documento** completo (`EXECUTION_GUIDE.md`) — entendimento de execução
5. Confirmar com humano: "Li os 4 documentos. Internalizei as convenções do Apêndice B. Vou começar pela Fase 0. Ok?"

---

## Fase 0 — Esqueleto do projeto

**Objetivo:** ter um repo TypeScript que compila, testa, e roda `mnema --version` retornando a versão. Sem nenhuma feature ainda.

**Duração estimada:** 4-8 horas

**Tarefas em ordem:**

### 0.1 Inicializar repo

```bash
pnpm init                         # cria package.json
pnpm add -D typescript @types/node tsx vitest @biomejs/biome
pnpm add -D @types/better-sqlite3
```

`package.json` deve ter:

```json
{
  "name": "@saurim/mnema",
  "version": "0.1.0",
  "type": "module",
  "bin": { "mnema": "./dist/index.js" },
  "files": ["dist/", "workflows/", "templates/"],
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "biome check src/",
    "lint:fix": "biome check --apply src/"
  },
  "engines": { "node": ">=20" }
}
```

### 0.2 Configurar TypeScript estrito

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src/**/*"]
}
```

### 0.3 Estrutura de pastas

Criar estrutura completa **vazia** (com `.gitkeep` em pastas sem código ainda).
**Toda subpasta com nome em kebab-case** — ver Apêndice B do ARCHITECTURE.md.

```
src/
├── index.ts                       # entry point
├── cli/
│   ├── index.ts
│   ├── commands/.gitkeep
│   ├── prompts/.gitkeep
│   └── formatters/.gitkeep
├── mcp/
│   ├── mcp-server.ts              # virá depois (Fase 5)
│   ├── tools/
│   │   └── universal/.gitkeep
│   └── schemas/.gitkeep
├── services/
│   └── result.ts                  # Result<T,E>, Ok, Err — virá na Fase 1
├── domain/
│   ├── entities/.gitkeep
│   ├── enums/.gitkeep
│   ├── state-machine/.gitkeep
│   └── validators/.gitkeep
├── storage/
│   ├── sqlite/
│   │   ├── migrations/.gitkeep
│   │   └── repositories/.gitkeep
│   ├── markdown/.gitkeep
│   ├── audit/.gitkeep
│   ├── buffer/.gitkeep
│   └── files/.gitkeep
├── config/
│   ├── config-schema.ts           # criado em 0.7
│   └── config-loader.ts           # criado em 0.8
├── errors/.gitkeep
└── utils/
    ├── version.ts
    └── version-check.ts           # criado em 0.9

workflows/.gitkeep
templates/.gitkeep
tests/
├── unit/.gitkeep
├── integration/.gitkeep
└── e2e/.gitkeep
docs/
└── (DESIGN.md, ARCHITECTURE.md, EXECUTION_GUIDE.md, errors-catalog.md já aqui)
```

### 0.4 Implementar `mnema --version`

`src/utils/version.ts`:
```typescript
import pkg from '../../package.json' with { type: 'json' };

/**
 * Versão atual do Mnema, lida do package.json em build time.
 */
export const VERSION = pkg.version;
```

`src/cli/index.ts`:
```typescript
import { Command } from 'commander';
import { VERSION } from '@/utils/version.js';

/**
 * Creates the root Commander program with metadata.
 * Subcommands are registered separately by *-command.ts files.
 *
 * @returns Root Commander program ready for parse()
 */
export function createCli(): Command {
  const program = new Command();
  program
    .name('mnema')
    .description('Cognitive persistence for AI agents')
    .version(VERSION);
  return program;
}
```

`src/index.ts`:
```typescript
#!/usr/bin/env node
import { createCli } from './cli/index.js';
createCli().parse(process.argv);
```

### 0.5 Primeiro teste

`tests/unit/utils/version.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { VERSION } from '@/utils/version.js';

describe('VERSION', () => {
  it('matches semver pattern', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
```

### 0.6 Build e smoke test

```bash
pnpm build
node dist/index.js --version    # deve imprimir 0.1.0
pnpm test                        # deve passar
```

### 0.7 Schema do mnema.config.json

`src/config/config-schema.ts`:
```typescript
import { z } from 'zod';

export const ConfigSchema = z.object({
  version: z.literal('1.0'),
  mnema_version: z.string(),
  project: z.object({
    key: z.string().regex(/^[A-Z][A-Z0-9]{1,9}$/),
    name: z.string().min(1),
    description: z.string().optional(),
  }),
  paths: z.object({
    state: z.string().default('.app'),
    audit: z.string().default('.audit'),
    backlog: z.string().default('backlog'),
    sprints: z.string().default('sprints'),
    roadmap: z.string().default('roadmap'),
    memory: z.string().default('memory'),
    skills: z.string().default('skills'),
    workflows: z.string().default('workflows'),
  }).default({}),
  workflow: z.string().default('default'),
  mode: z.enum(['single', 'multi']).default('single'),
  audit_strategy: z.enum(['full', 'recent', 'local']).default('recent'),
  audit_retention_months: z.number().int().positive().default(12),
  enforcement_mode: z.enum(['advisory', 'strict', 'blocking']).default('advisory'),
  sync: z.object({
    mode: z.enum(['hybrid', 'push', 'buffer']).default('hybrid'),
    agent_buffer_flush_seconds: z.number().int().positive().default(30),
    agent_buffer_flush_count: z.number().int().positive().default(50),
    agent_buffer_flush_on_plan_complete: z.boolean().default(true),
  }).default({}),
  features: z.object({
    fts_search: z.boolean().default(true),
    attachments: z.boolean().default(true),
  }).default({}),
});

export type Config = z.infer<typeof ConfigSchema>;
```

### 0.8 ConfigLoader (sobe na árvore como git)

`src/config/config-loader.ts`:
```typescript
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { ConfigSchema, type Config } from './config-schema.js';

/**
 * Lançado quando mnema.config.json não é encontrado.
 */
export class ConfigNotFoundError extends Error {
  constructor() {
    super('mnema.config.json not found in current directory or any ancestor');
  }
}

/**
 * Lançado quando mnema.config.json existe mas viola o schema.
 */
export class ConfigInvalidError extends Error {
  constructor(public readonly issues: unknown) {
    super('mnema.config.json is invalid');
  }
}

/**
 * Carrega e valida mnema.config.json subindo na árvore de diretórios.
 * Funciona como o git: procura no cwd e em cada ancestral até a raiz.
 */
export class ConfigLoader {
  /**
   * Searches for mnema.config.json starting from the given directory,
   * walking up the parent chain until the filesystem root.
   *
   * @param startDir - Starting directory; defaults to process.cwd()
   * @returns Absolute path to the config file, or null if not found
   */
  findConfigFile(startDir: string = process.cwd()): string | null {
    let dir = path.resolve(startDir);
    const root = path.parse(dir).root;

    while (dir !== root) {
      const candidate = path.join(dir, 'mnema.config.json');
      if (existsSync(candidate)) return candidate;
      dir = path.dirname(dir);
    }
    return null;
  }

  /**
   * Loads, parses and validates mnema.config.json.
   *
   * @param startDir - Starting directory for the search
   * @returns Validated Config object
   * @throws ConfigNotFoundError if no config file is found
   * @throws ConfigInvalidError if the config violates the schema
   */
  load(startDir?: string): Config {
    const file = this.findConfigFile(startDir);
    if (file === null) throw new ConfigNotFoundError();

    const raw = JSON.parse(readFileSync(file, 'utf-8'));
    const parsed = ConfigSchema.safeParse(raw);
    if (!parsed.success) throw new ConfigInvalidError(parsed.error.issues);
    return parsed.data;
  }
}
```

### 0.9 Version check

`src/utils/version-check.ts`:
```typescript
import semver from 'semver';
import { VERSION } from './version.js';

/**
 * Resultado de uma verificação de compatibilidade de versão.
 */
export interface VersionCheckResult {
  readonly ok: boolean;
  readonly message?: string;
}

/**
 * Checks if the current Mnema version satisfies the project's required range.
 *
 * @param required - Semver range from mnema.config.json (e.g., "^1.2.0")
 * @returns Check result with ok flag and optional human-readable message
 */
export function checkVersion(required: string): VersionCheckResult {
  if (!semver.satisfies(VERSION, required)) {
    return {
      ok: false,
      message: `Project requires mnema ${required}, you have ${VERSION}. Update with: npm i -g @saurim/mnema`,
    };
  }
  return { ok: true };
}
```

### Critérios de pronto da Fase 0

- [ ] `pnpm build` sem erros
- [ ] `pnpm test` passa
- [ ] `pnpm lint` sem erros
- [ ] `node dist/index.js --version` imprime versão
- [ ] Estrutura de pastas em `src/` criada conforme `ARCHITECTURE.md` seção 2
- [ ] **Naming dos arquivos em kebab-case** (Apêndice B do ARCHITECTURE.md)
- [ ] `ConfigSchema` Zod definido cobrindo todos os campos do `DESIGN.md` seção 4.1
- [ ] `ConfigLoader` é classe (Apêndice B.2: classes pra estado/lifecycle)
- [ ] `ConfigLoader.load()` testado: encontra arquivo, valida, retorna typed object
- [ ] `checkVersion()` testado com 3 casos (compatível, major incompatível, build incompatível)
- [ ] **Todas as funções públicas têm JSDoc com @param e @returns** (Apêndice B.6)
- [ ] **Zero comentários históricos no código** (Apêndice B.7)
- [ ] Commit final: `feat: skeleton with config loader and version check`

---

## Fase 1 — Core Domain

**Objetivo:** ter `StateMachine`, entidades e validadores funcionando, com workflow `default.json` carregando corretamente. Ainda **sem persistência**.

**Duração estimada:** 12-20 horas

### 1.1 Workflow `default.json` (preset)

Criar `workflows/default.json` seguindo schema da seção 9.5 do `DESIGN.md`:

```json
{
  "schema_version": "1.0",
  "name": "default",
  "description": "Modern 7-state workflow for development teams",
  "states": ["DRAFT", "READY", "IN_PROGRESS", "BLOCKED", "IN_REVIEW", "DONE", "CANCELED"],
  "initial": "DRAFT",
  "terminal": ["DONE", "CANCELED"],
  "features": {
    "sprints": true,
    "epics": true,
    "review_workflow": true,
    "blocked_state": true
  },
  "transitions": {
    "DRAFT": {
      "submit": {
        "to": "READY",
        "description": "Submit work as ready to be picked up",
        "use_when": "Task is fully defined with title, description, criteria, and estimate",
        "requires": {
          "title": { "type": "string", "min": 3, "max": 200 },
          "description": { "type": "string", "min": 10 },
          "acceptance_criteria": { "type": "array", "items": "string", "min": 1 },
          "estimate": { "type": "number", "enum": [1, 2, 3, 5, 8, 13] }
        }
      },
      "cancel": {
        "to": "CANCELED",
        "description": "Cancel a draft task",
        "use_when": "Decided not to pursue this work",
        "requires": { "reason": { "type": "string", "min": 5 } }
      }
    },
    "READY": {
      "start": {
        "to": "IN_PROGRESS",
        "description": "Start working on this task",
        "use_when": "About to begin implementation",
        "requires": { "assignee_id": { "type": "string" } }
      },
      "cancel": {
        "to": "CANCELED",
        "description": "Cancel a ready task",
        "use_when": "Task no longer relevant",
        "requires": { "reason": { "type": "string", "min": 5 } }
      }
    },
    "IN_PROGRESS": {
      "block": {
        "to": "BLOCKED",
        "description": "Mark task as blocked",
        "use_when": "External dependency or information missing",
        "requires": { "reason": { "type": "string", "min": 5 } }
      },
      "submit_review": {
        "to": "IN_REVIEW",
        "description": "Submit task for code review",
        "use_when": "Implementation complete, PR opened",
        "requires": { "pr_url": { "type": "string", "format": "url" } }
      },
      "cancel": {
        "to": "CANCELED",
        "description": "Cancel in-progress task",
        "use_when": "Work proven unviable",
        "requires": { "reason": { "type": "string", "min": 5 } }
      }
    },
    "BLOCKED": {
      "unblock": {
        "to": "IN_PROGRESS",
        "description": "Unblock task and resume work",
        "use_when": "Blocker resolved",
        "requires": { "note": { "type": "string", "min": 5 } }
      }
    },
    "IN_REVIEW": {
      "approve": {
        "to": "DONE",
        "description": "Approve task as complete",
        "use_when": "Review passed, work merged",
        "requires": { "approval_note": { "type": "string", "min": 1 } }
      },
      "request_changes": {
        "to": "IN_PROGRESS",
        "description": "Request changes on the review",
        "use_when": "Review found issues to fix",
        "requires": { "feedback": { "type": "string", "min": 10 } }
      }
    },
    "DONE": {
      "reopen": {
        "to": "IN_PROGRESS",
        "description": "Reopen a completed task",
        "use_when": "Bug found or scope insufficient",
        "requires": { "reason": { "type": "string", "min": 5 } }
      }
    }
  }
}
```

### 1.2 Workflow loader

`src/domain/stateMachine/Workflow.ts`:
- Carregar JSON
- Validar meta-schema
- Traduzir `requires` em `ZodSchema`

Implementar `jsonRequiresToZod` cuidadosamente. Casos de teste obrigatórios:
- `string` com min/max
- `number` com enum
- `array` de `string` com min
- `string` com format url

### 1.3 StateMachine

`src/domain/stateMachine/StateMachine.ts` conforme seção 4.1 do `ARCHITECTURE.md`. Métodos:
- `canTransition(from, action): boolean`
- `validateTransition(from, action, payload): Result<...>`
- `listActionsFrom(state): Array<{ action, transition }>`
- `isTerminal(state): boolean`

### 1.4 Entidades

`src/domain/entities/`:
- `task.ts`
- `agent-run.ts`
- `agent-plan.ts`
- `decision.ts`
- `sprint.ts`
- `epic.ts`
- `actor.ts`
- `transition.ts`
- `note.ts`
- `dependency.ts`

Todas como `interface` exportada (Apêndice B.4). Campos `readonly` (Apêndice B.9). Sem classes, sem métodos.

### 1.5 Enums

`src/domain/enums/`:
- `task-state.ts` — TaskState (Draft, Ready, InProgress, Blocked, InReview, Done, Canceled)
- `agent-run-status.ts` — AgentRunStatus (Running, Completed, Failed, Aborted)
- `agent-plan-state.ts` — AgentPlanState (Pending, InProgress, Completed, Skipped, Failed)
- `actor-kind.ts` — ActorKind (Human, Agent)
- `decision-status.ts` — DecisionStatus (Proposed, Accepted, Rejected, Superseded)
- `enforcement-mode.ts` — EnforcementMode (Advisory, Strict, Blocking)

Todos como `enum` nativo TypeScript com valores string (Apêndice B.3). Ver exemplos completos em ARCHITECTURE.md §4.3.

### 1.6 Result e Ok/Err

`src/services/result.ts` (funções soltas, Apêndice B.5):
```typescript
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

### 1.7 Geradores de IDs

`src/domain/id-generator.ts` — funções soltas (utilities stateless puras, Apêndice B.2):

```typescript
import { v7 } from 'uuid';

/**
 * Generates a sortable UUID v7 (time-ordered).
 *
 * @returns A UUID v7 string in canonical form
 */
export function generateUuid(): string {
  return v7();
}

/**
 * Constructs a human-readable task key.
 *
 * @param projectKey - Uppercase project prefix (e.g., "WEBAPP")
 * @param sequence - Sequential number for the task
 * @returns Task key in the format "PROJECT-N"
 */
export function generateTaskKey(projectKey: string, sequence: number): string {
  return `${projectKey}-${sequence}`;
}

/**
 * Parses a task key into its components.
 *
 * @param key - Task key string (e.g., "WEBAPP-42")
 * @returns Parsed components, or null if format is invalid
 */
export function parseTaskKey(key: string): { projectKey: string; sequence: number } | null {
  const match = key.match(/^([A-Z][A-Z0-9]*)-(\d+)$/);
  if (match === null) return null;
  return {
    projectKey: match[1]!,
    sequence: Number.parseInt(match[2]!, 10),
  };
}
```

### Critérios de pronto da Fase 1

- [ ] `workflows/default.json` valida contra meta-schema
- [ ] `WorkflowLoader.load('workflows/default.json')` retorna `Workflow` typed
- [ ] `StateMachine` instanciada do workflow `default` aceita todas as transições válidas
- [ ] **Todas as entidades em kebab-case com camelCase nos campos** (Apêndice B.1, B.9)
- [ ] **Enums em arquivos dedicados** em `src/domain/enums/` (Apêndice B.3)
- [ ] **Result/Ok/Err como funções soltas** (Apêndice B.5)
- [ ] Testes unitários cobrem: transição inválida, gate failure, payload válido, payload inválido
- [ ] 3 outros workflows criados (`lean.json`, `kanban.json`, `jira-classic.json`) e validados
- [ ] Cobertura de teste >= 80% em `domain/`
- [ ] **JSDoc completo em todas as APIs públicas** (Apêndice B.6)
- [ ] Commit: `feat: state machine with declarative workflows`

---

## Fase 2 — Storage e identidade

**Objetivo:** SQLite persistindo, audit JSONL gravando, identidade dupla funcionando.

**Duração estimada:** 16-24 horas

### 2.1 Migrations

Copiar arquivos `.sql` (`001_initial.sql`, `002_fts_attachments.sql`, `003_agent_plans_and_identity.sql`) pra `src/storage/sqlite/migrations/`. **Não modificar** — eles foram validados em sessão de design.

### 2.2 SQLiteAdapter

`src/storage/sqlite/SQLiteAdapter.ts` conforme seção 3.1 do `ARCHITECTURE.md`. Pragmas obrigatórios.

### 2.3 MigrationRunner

`src/storage/sqlite/MigrationRunner.ts` conforme seção 3.2 do `ARCHITECTURE.md`. Runs em ordem, idempotente.

### 2.4 Repositórios

Um por entidade, em `src/storage/sqlite/repositories/`. Métodos só leem/gravam, sem lógica de negócio.

### 2.5 IdentityService

`src/services/IdentityService.ts`:
- `getDefaultActor()` — lê `~/.config/mnema/identity.json`, fallback pra `MNEMA_ACTOR` env var, fallback pra `whoami`
- `resolveAgentActor(metadata)` — extrai `agent_handle` de metadata MCP
- `ensureActor(handle, kind)` — upsert em `actors` table

### 2.6 AuditService e AuditWriter

- `AuditWriter` conforme seção 3.4 do `ARCHITECTURE.md`
- `AuditService` orquestra: rotação mensal, write, query

### 2.7 MarkdownIO

Conforme seção 3.3 do `ARCHITECTURE.md`. Suporte a managed sections.

### Critérios de pronto da Fase 2

- [ ] `pnpm test` passa com testes de integração usando SQLite real em `/tmp`
- [ ] Migrations rodam em DB vazio sem erro
- [ ] Migrations são idempotentes (rodar 2x não duplica)
- [ ] Triggers SQL funcionam (auto-archive de plans testado)
- [ ] FTS5 funciona (busca com diacríticos testada)
- [ ] AuditWriter rotaciona corretamente quando muda o mês
- [ ] MarkdownIO preserva free sections
- [ ] IdentityService carrega de identity.json e env var
- [ ] Commit: `feat: storage layer with SQLite, audit, markdown`

---

## Fase 3 — Services e CLI básico

**Objetivo:** comandos `mnema init`, `mnema task create/list/show/move` funcionando end-to-end no CLI.

**Duração estimada:** 16-24 horas

### 3.1 TaskService

Conforme seção 5.2 do `ARCHITECTURE.md`. Operações:
- `create(args)` — cria em DRAFT, registra transition `create`
- `transition(args)` — valida via state machine, atualiza, registra
- `findByKey(key)`
- `list(filter)`

### 3.2 SyncService

Conforme seção 5.3 do `ARCHITECTURE.md`. Modo `push` é o padrão na CLI.

### 3.3 Comando `mnema init`

`src/cli/commands/init.ts`. Wizard com `@inquirer/prompts`. Modo silencioso com flags. Detecção de conflitos.

Cria:
- `mnema.config.json`
- `AGENTS.md` (a partir de template)
- `.app/state.db` com migrations aplicadas
- `.audit/` com `current.jsonl` vazio
- Pastas: `backlog/{DRAFT,READY,...}`, `sprints/`, `roadmap/`, `memory/`, `skills/`, `workflows/`
- `.gitignore` adicionando `.app/`
- `workflows/default.json` copiado dos templates
- `skills/SKILL.md` + skills core copiadas

### 3.4 Comando `mnema task`

Subcomandos:
- `mnema task create` — wizard ou flags
- `mnema task list [--state=...]`
- `mnema task show <key>`
- `mnema task move <key> <action> --field=value`

### 3.5 Comando `mnema doctor`

Valida:
- `mnema.config.json` existe e é válido
- Schema do DB está atualizado
- Paths configurados existem
- Workflow JSON é válido

### Critérios de pronto da Fase 3

- [ ] `mnema init` em pasta vazia cria estrutura completa
- [ ] `mnema task create` em projeto inicializado cria task em DRAFT
- [ ] `mnema task list` mostra task criada
- [ ] `mnema task move PROJ-1 submit --title=... --description=... --acceptance-criteria=... --estimate=5` move pra READY
- [ ] `mnema task move PROJ-1 submit ...` quando já está em READY retorna erro claro
- [ ] Markdown em `backlog/READY/PROJ-1.md` é gerado com managed section
- [ ] Audit em `.audit/current.jsonl` tem entrada `task_transitioned`
- [ ] Tests E2E rodando CLI como subprocess passam
- [ ] Commit: `feat: cli with init, task crud, basic workflow operations`

---

## Fase 4 — Identidade dupla, audit completo, sync

**Objetivo:** identidade dupla totalmente integrada, audit fragmentado por mês funcionando, sync robusto.

**Duração estimada:** 8-12 horas

### 4.1 AgentRunService

`src/services/AgentRunService.ts`:
- `start(args)` — cria agent_run, valida depth ≤ 5
- `end(runId, status)` — atualiza status, dispara trigger, flush sync

### 4.2 AgentPlanService

- `create(args)` — valida depth ≤ 5
- `updateState(planId, state, result?)`
- `list(runId, options)`

### 4.3 Identidade dupla em transitions

Atualizar `TaskService.transition` pra aceitar `via` e `runId` opcionais. Já está no schema.

### 4.4 Audit JSONL completo

- Rotação mensal automática
- Comando `mnema audit query [filters]`
- Estrutura de evento conforme `DESIGN.md` seção 10.5

### 4.5 Sync rebuild

- `mnema sync` reconstrói SQLite a partir de markdowns + audit
- Idempotente, preserva free sections

### Critérios de pronto da Fase 4

- [ ] `agent_run_start/end` no DB funcionam com metadata
- [ ] Mutações via test harness MCP registram `actor` + `via` + `run`
- [ ] Audit JSONL rotaciona quando muda o mês
- [ ] `mnema audit query --kind=task_transitioned --since=24h` funciona
- [ ] `mnema sync` em projeto sujo reconstrói corretamente
- [ ] Commit: `feat: dual identity, audit rotation, sync rebuild`

---

## Fase 5 — MCP Server

**Objetivo:** servidor MCP funcional com tools universais e geradas, conectável por Claude Code.

**Duração estimada:** 16-24 horas

### 5.1 Boot do MCP server

`src/mcp/server.ts`:
- Lê `mnema.config.json` do cwd
- Roda recovery do buffer (`.app/buffer.jsonl`) se necessário
- Carrega workflow ativo
- Registra tools universais (incluindo `context_bootstrap`)
- Gera tools de transição
- Captura `client_metadata` da conexão
- Registra handlers de SIGINT/SIGTERM pra graceful shutdown
- Loga via Pino em stderr (NUNCA stdout — quebra MCP)

### 5.2 Tool `context_bootstrap` (PRIMEIRA tool a implementar)

Esta é a tool de **inicialização canônica** do agente. Implementar primeiro porque AGENTS.md e skills referenciam.

`src/mcp/tools/universal/context-bootstrap-tool.ts`:

```typescript
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import { TaskState } from '@/domain/enums/task-state.js';
import type { TaskService } from '@/services/task-service.js';
import type { DecisionService } from '@/services/decision-service.js';
import type { SprintService } from '@/services/sprint-service.js';
import type { Config } from '@/config/config-schema.js';
import type { Workflow } from '@/domain/state-machine/state-machine.js';
import type { McpTool } from '../mcp-tool-types.js';

/**
 * Tool MCP universal pra bootstrap do agente.
 * Lê config, workflow ativo e arquivos de memória pra montar o contexto inicial.
 * Deve ser a PRIMEIRA tool chamada por qualquer agente em uma sessão.
 */
export class ContextBootstrapTool {
  constructor(
    private readonly config: Config,
    private readonly workflow: Workflow,
    private readonly projectRoot: string,
    private readonly taskService: TaskService,
    private readonly decisionService: DecisionService,
    private readonly sprintService: SprintService,
  ) {}

  /**
   * Builds the McpTool definition for registration with the server.
   *
   * @returns Configured MCP tool
   */
  build(): McpTool {
    return {
      name: 'context_bootstrap',
      description:
        "Bootstrap the agent's understanding of this project. Call this once at the start of every session, BEFORE any other tool. Returns project identity, active workflow, recent decisions, and pointers to memory.",
      inputSchema: { type: 'object', properties: {} },
      handler: async () => this.handle(),
    };
  }

  /** Builds the bootstrap response with all relevant project context. */
  private async handle(): Promise<Record<string, unknown>> {
    return {
      ok: true,
      project: {
        key: this.config.project.key,
        name: this.config.project.name,
        description: this.config.project.description ?? null,
      },
      workflow: {
        name: this.workflow.name,
        states: this.workflow.states,
        available_actions_summary: this.summarizeActions(),
      },
      agents_md: this.readTruncated('AGENTS.md', 8 * 1024),
      memory_index: this.readTruncated(`${this.config.paths.memory}/INDEX.md`, 4 * 1024),
      decisions_index: this.readTruncated(
        `${this.config.paths.memory}/decisions/INDEX.md`,
        4 * 1024,
      ),
      active_sprint: this.sprintService.getActive(),
      recent_decisions: this.decisionService.listRecent({ limit: 5 }),
      open_blockers: this.taskService.listByState(TaskState.Blocked),
      statistics: {
        total_tasks: this.taskService.count(),
        in_progress: this.taskService.countByState(TaskState.InProgress),
        blocked: this.taskService.countByState(TaskState.Blocked),
      },
    };
  }

  /** Reads a file relative to project root, truncated to maxBytes. */
  private readTruncated(relativePath: string, maxBytes: number): string | null {
    const fullPath = path.join(this.projectRoot, relativePath);
    if (!existsSync(fullPath)) return null;

    const content = readFileSync(fullPath, 'utf-8');
    if (content.length <= maxBytes) return content;
    return `${content.slice(0, maxBytes)}\n\n[...truncated]`;
  }

  /** Builds a human-readable summary of available actions in the workflow. */
  private summarizeActions(): string {
    const lines: string[] = [];
    for (const [from, actions] of Object.entries(this.workflow.transitions)) {
      for (const [action, transition] of Object.entries(actions)) {
        lines.push(`${action}: ${from} → ${transition.to}`);
      }
    }
    return lines.join('\n');
  }
}
```

### 5.3 Tools universais (tabela completa)

Implementar nessa ordem:

| Ordem | Tool | Categoria |
|---|---|---|
| 1 | `context_bootstrap` | Bootstrap (já feito acima) |
| 2 | `agent_run_start` | Agent runs (necessário pra mutações) |
| 3 | `agent_run_end` | Agent runs |
| 4 | `agent_run_show` | Agent runs (read) |
| 5 | `task_create` | Tasks (write) |
| 6 | `tasks_list` | Tasks (read) |
| 7 | `task_show` | Tasks (read) |
| 8 | `tasks_search` (FTS5) | Tasks (read) |
| 9 | `decision_record` | Decisões (write) |
| 10 | `decision_show` | Decisões (read) |
| 11 | `decisions_list` | Decisões (read) |
| 12 | `note_add` | Notas (write) |
| 13 | `agent_plan_create` | Plans (write) |
| 14 | `agent_plan_update_state` | Plans (write) |
| 15 | `agent_plans_list` | Plans (read) |
| 16 | `sprint_show`, `sprints_list`, `sprint_add_task` | Sprints (se workflow tem) |
| 17 | `epic_show`, `epics_list` | Epics (se workflow tem) |
| 18 | `audit_query` | Audit (read) |
| 19 | `history_get` | Audit (read) |

### 5.4 Tools de transição (geradas)

Em `src/mcp/tools/generated.ts`:
- Itera workflow.transitions
- Gera uma tool por transição (`task_${action}`)
- Description = `${transition.description}\n\nUse when: ${transition.use_when}`
- Input schema = derivado de `requires` via `jsonRequiresToZod` + `zodToJsonSchema`
- Toda transition tool aceita `expected_updated_at` opcional pra versionamento otimista

### 5.5 Erros estruturados

Toda tool retorna usando `errors-catalog.md`:

```typescript
import { Errors } from '@/errors/error-catalog.js';

// Em handler:
if (task === null) {
  return Errors.TASK_NOT_FOUND({ taskKey }).structured;
}
```

Ver `errors-catalog.md` pra lista completa de erros e estruturas.

### 5.6 Sync mode buffer

MCP server seta `SyncService` em modo buffer **persistente** (`.app/buffer.jsonl`). Flush em:
- `agent_run_end` (sempre)
- 30s desde última mutação
- 50 mutações acumuladas
- `agent_plan_update_state` quando state='completed' E `agent_buffer_flush_on_plan_complete=true` no config

### 5.7 Graceful shutdown

Implementar handler conforme ARCHITECTURE seção 11.4:
- SIGINT/SIGTERM disparam shutdown
- Stop accepting new tools (`status: shutting_down`)
- Wait inflight tools (max 3s)
- Flush buffer
- Close SQLite
- Hard timeout: 5s

### 5.8 `mnema mcp install-instructions <client>`

Subcomando que imprime instruções de configuração pro cliente especificado:
- `claude-code`
- `cursor`
- `aider`
- `generic`

Output deve incluir:
- Path absoluto do binário Mnema (descoberto via `process.execPath` ou `which`)
- `agent_handle` sugerido
- Lembrete de definir `cwd` corretamente

### 5.5 `mnema mcp install-instructions <client>`

Subcomando que imprime instruções de configuração pro cliente especificado:
- `claude-code`
- `cursor`
- `aider`

Formato pra Claude Code:
```
Add to ~/.config/claude-code/mcp.json:

{
  "mcpServers": {
    "mnema": {
      "command": "mnema",
      "args": ["mcp", "serve"],
      "metadata": { "agent_handle": "claude-code" }
    }
  }
}
```

### Critérios de pronto da Fase 5

- [ ] `mnema mcp serve` roda sem erros
- [ ] **Tool `context_bootstrap` retorna estrutura completa** (project, workflow, agents_md, memory_index, etc.)
- [ ] Tool harness (mock client) consegue chamar `agent_run_start` e receber `run_id`
- [ ] Mutações sem `run_id` ativo retornam erro estruturado `NO_ACTIVE_RUN`
- [ ] **Versionamento otimista funciona:** mutação com `expected_updated_at` errado retorna `CONFLICT` com `current_updated_at`
- [ ] Tools geradas refletem workflow ativo (mudar workflow → reiniciar → tools mudam)
- [ ] Buffer flush testado (volume, tempo, agent_run_end)
- [ ] **Buffer recovery testado:** matar processo no meio, reiniciar, mutações pendentes processadas
- [ ] **Graceful shutdown testado:** SIGTERM faz flush antes de exit
- [ ] **Logs vão pra stderr (NUNCA stdout)** — verificar não corrompe protocolo MCP
- [ ] Cliente real (Claude Code) consegue conectar e operar
- [ ] Commit: `feat: mcp server with bootstrap, universal and generated tools`

---

## Fase 6 — Observação humana

**Objetivo:** comandos `history`, `watch`, `inbox`, `agent inspect` funcionando.

**Duração estimada:** 8-12 horas

### 6.1 `mnema history`

Lê de `.audit/`. Filtros: `--since`, `--actor`, `--via`, `--run`, `--kind`. Agregação inteligente (plans aparecem como `[N steps]`). Formatos: humano, table, json.

### 6.2 `mnema watch`

`fs.watch()` no `current.jsonl`. Filtros completos. Stateless. `--catchup=Nm`. Formatos: humano, `--table`, `--json`. `--verbose` adiciona `.app/activity.log`.

### 6.3 `mnema inbox`

Query no SQLite por:
- Tasks em `IN_REVIEW` (esperando aprovação)
- Tasks em `BLOCKED` mencionando o usuário
- Decisões em `proposed`
- Outras "filas" de aprovação humana

### 6.4 `mnema agent inspect <run_id>`

Mostra detalhe completo de um run:
- Goal, status, tempo
- Plans (árvore)
- Mutações causadas

### Critérios de pronto da Fase 6

- [ ] `mnema history --since=today` mostra atividade do dia formatada
- [ ] `mnema watch` exibe mutações ao vivo
- [ ] Filtros combinados funcionam (`--agent=X --kind=task_transitioned`)
- [ ] `mnema inbox` mostra fila de aprovação humana
- [ ] `mnema agent inspect <run_id>` mostra detalhe completo
- [ ] Commit: `feat: observation commands for humans`

---

## Fase 7 — Sprints, busca, anexos

**Objetivo:** features secundárias completas.

**Duração estimada:** 8-12 horas

- `SprintService` + comandos
- `mnema search` (FTS5)
- Sistema de anexos com `FileStore`

### Critérios de pronto da Fase 7

- [ ] `mnema sprint plan/start/close` funcional
- [ ] `mnema search "oauth login"` retorna tasks/notes/decisions
- [ ] Anexar arquivo a task funciona, dedup verificado
- [ ] Commit: `feat: sprints, search, attachments`

---

## Fase 8 — Init avançado, presets, importadores

**Objetivo:** UX de init completa, presets, importadores.

**Duração estimada:** 8-12 horas

- Wizard interativo polido
- Modo `--minimal` + `mnema adopt`
- Importador GitHub Issues
- Importador Markdown
- Templates AGENTS.md por workflow

### Critérios de pronto da Fase 8

- [ ] `mnema init` em pasta com conflito oferece resolução
- [ ] `mnema init --minimal` cria só esqueleto
- [ ] `mnema adopt skills` adiciona pasta sem afetar resto
- [ ] `mnema import github-issues --repo=user/repo` funciona
- [ ] `mnema import markdown --from=TODO.md` funciona
- [ ] Commit: `feat: init wizard, adoption, importers`

---

## Fase 9 — Skills, memory, polish

**Objetivo:** skills completas, memory consolidate, último polish.

**Duração estimada:** 6-10 horas

- `mnema skill lint`
- `mnema memory consolidate`
- INDEX.md generation
- Performance tuning (orçamentos da seção 15 do ARCHITECTURE.md)
- Documentação de usuário

### Critérios de pronto da Fase 9

- [ ] Todas as skills core escritas e linted
- [ ] `mnema memory consolidate` funciona
- [ ] INDEX.md regenerado automaticamente
- [ ] Performance dentro dos orçamentos
- [ ] README.md de usuário escrito
- [ ] Commit: `feat: skills, memory consolidation, polish`

---

## Checklist de release v1.0.0

Antes de publicar `@saurim/mnema@1.0.0` no npm:

- [ ] Todas as fases 0-9 completas
- [ ] Cobertura de testes >= 80% global
- [ ] `pnpm build` e `pnpm test` verdes em CI
- [ ] CHANGELOG.md preenchido
- [ ] README.md cobre: instalação, quickstart, link pra docs
- [ ] LICENSE escolhido (sugestão: MIT ou Apache 2.0)
- [ ] `package.json` com `repository`, `homepage`, `bugs`
- [ ] Smoke test: `npm pack` + instalar tarball + `mnema init` em pasta limpa funciona
- [ ] Tag git `v1.0.0`
- [ ] `npm publish --access=public`

---

## Anti-padrões a evitar

### ❌ "Vou só fazer o init mais elaborado primeiro"
Não. Init é Fase 3+. Sem core domain (Fase 1) e storage (Fase 2), init é castelo de cartas.

### ❌ "Vou hardcodar os estados pra ir mais rápido"
Não. Estados vivem no workflow JSON. Hardcoding cria duplicação que vira bug.

### ❌ "Vou pular testes nessa parte porque é simples"
Não. Tudo o que entra precisa de teste. Simples hoje vira complexo amanhã.

### ❌ "Vou usar `any` aqui só pra resolver"
Não. `any` é dívida técnica que se espalha. Use `unknown` + Zod.

### ❌ "Vou commitar tudo junto no final"
Não. Commits pequenos com mensagens claras. Histórico do Git é documentação.

### ❌ "Vou fazer end-to-end fininho primeiro"
Não. Camadas de baixo pra cima. End-to-end é consequência, não estratégia.

### ❌ "Vou implementar o MCP antes do CLI"
Não. CLI é a fundação porque CLI e MCP compartilham Services. CLI também é a interface mais simples pra testar.

### ❌ "Decido isso depois"
Não. Se uma decisão afeta o que você está construindo agora, pare e resolva. Decisões adiadas viram débito.

### ❌ "Vou usar PascalCase no nome do arquivo só dessa vez"
Não. **Apêndice B.1** é regra absoluta. `task-service.ts`, nunca `TaskService.ts`. Zero exceções.

### ❌ "Vou criar uma classe estática só pra agrupar utils"
Não. Use funções soltas exportadas em arquivo dedicado. Ver Apêndice B.2 — anti-padrão explícito.

### ❌ "Vou comentar aqui que isso foi decidido depois da reunião"
Não. Apêndice B.7 proíbe comentários históricos. Histórico vai pro Git, ADRs, ou changelog. Código contém apenas: o que faz, como usar, constraints técnicas.

### ❌ "Vou usar `const TaskState = {...} as const` em vez de enum"
Não. Apêndice B.3 exige `enum` nativo TypeScript com valores string.

### ❌ "Vou pular o JSDoc nesse método público porque é óbvio"
Não. Apêndice B.6 exige JSDoc completo (`@param`, `@returns`) em toda API pública. Sem exceções.

---

## Quando pedir ajuda ao humano

Pare e pergunte se:

- Decisão arquitetural não está em `DESIGN.md` ou `ARCHITECTURE.md`
- Tradeoff entre performance e simplicidade não tem orientação clara
- Migration nova é necessária e quebra dados
- Dependência nova proposta não consta na stack do `DESIGN.md` (Section 3.3)
- Critério de pronto não está claro
- Teste falha de forma que sugere problema de design, não de implementação

Forma de pedir:

> Travei na Fase X, tarefa Y.
>
> Contexto: [resumo curto]
>
> Opção A: [descrição] — pros/cons
> Opção B: [descrição] — pros/cons
>
> Recomendação: [sua leitura]
>
> Posso prosseguir com [A/B] ou prefere outra direção?

---

## Apêndice: dependências mínimas

Stack final (todas em `package.json`):

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^X.Y.Z",
    "@inquirer/prompts": "^X.Y.Z",
    "better-sqlite3": "^X.Y.Z",
    "commander": "^X.Y.Z",
    "gray-matter": "^X.Y.Z",
    "pino": "^X.Y.Z",
    "semver": "^X.Y.Z",
    "zod": "^X.Y.Z",
    "picocolors": "^X.Y.Z"
  },
  "devDependencies": {
    "@biomejs/biome": "^X.Y.Z",
    "@types/better-sqlite3": "^X.Y.Z",
    "@types/node": "^X.Y.Z",
    "@types/semver": "^X.Y.Z",
    "execa": "^X.Y.Z",
    "pino-pretty": "^X.Y.Z",
    "tsx": "^X.Y.Z",
    "typescript": "^X.Y.Z",
    "vitest": "^X.Y.Z"
  }
}
```

**Justificativa por dependência:**

- `commander` — CLI framework maduro, ecossistema Node padrão
- `@inquirer/prompts` — wizards interativos modernos (substituto do inquirer clássico)
- `better-sqlite3` — síncrono, performance superior, ergonomia
- `gray-matter` — parser de YAML frontmatter padrão
- `pino` — logger JSON estruturado, alto desempenho
- `pino-pretty` — formatador legível em dev (apenas dev)
- `picocolors` — colors no terminal sem peso (substitui chalk)
- `zod` — validação runtime + tipos TS
- `semver` — version check
- `@modelcontextprotocol/sdk` — protocolo MCP

Antes de instalar, **verifique versão atual de cada um** com `npm view <pkg> version`. Não confie em snapshots de design que ficam desatualizados.

---

## Apêndice: ordem sugerida de leitura para a IA

Quando começar uma sessão de trabalho:

1. `EXECUTION_GUIDE.md` (este arquivo) — onde estamos no plano
2. `DESIGN.md` seções relevantes — visão e decisões
3. `ARCHITECTURE.md` seções relevantes — estrutura técnica
4. `errors-catalog.md` se for tocar em mensagens de erro
4. Código existente do incremento atual
5. Testes existentes do incremento atual

Ao terminar:

1. Rodar `pnpm build && pnpm test && pnpm lint`
2. Commit
3. Atualizar este documento se decisões novas surgiram
4. Reportar humano com:
   - O que foi feito
   - O que está pronto vs em progresso
   - Próximo incremento previsto
   - Bloqueios ou dúvidas
