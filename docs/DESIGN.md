# Mnema — Documento de Design

> **Status:** Draft v2.3 · Última atualização: 2026-04-30
> **Autor original:** Daniel · **Validado com:** sessão de design colaborativa
>
> **Mudanças v2.3:** Convenções de código formalizadas em `ARCHITECTURE.md` Apêndice B. kebab-case obrigatório, OOP-first com funções soltas só pra utils, enums nativos, JSDoc completo, comentários históricos proibidos. Stack consolidada: Commander + Biome.
>
> **Mudanças v2.2:** Resolução dos 8 gaps críticos identificados em revisão. Decisões: (G1) versionamento otimista + buffer persistente em `.app/buffer.jsonl`; (G2) MCP server stdio per-session, multi-instance OK; (G3) sem permissões granulares no MVP, documentado como out-of-scope; (G4) logging com Pino + stderr; (G5) catálogo central de erros (`errors-catalog.md`); (G6) meta-schema fechado pro workflow JSON; (G7) **YAML frontmatter** substitui blocos HTML em markdown; (G8) tool MCP `context_bootstrap` é o protocolo canônico de inicialização do agente. Stack consolidada: Commander e Biome escolhidos.
>
> **Mudanças v2.1:** Nome final cristalizado — produto **Mnema** (raíz grega de memória), publicado pela org **Saurim** (do sobrenome Sauer + sufixo místico, "Filho do Sol" em algumas tradições). Pacote único `@saurim/mnema` (CLI + MCP server no mesmo binário). Binário CLI continua sendo `mnema`. Todas as referências a "orq" substituídas.
>
> **Mudanças v2.0:** Reposicionamento como produto agente-cêntrico (MCP-first). Cenário X confirmado (sistema não roda agentes embutidos). Novas seções sobre identidade dupla, agent_plans, observação, audit fragmentado.

---

## Sumário executivo

**Mnema** é uma **camada de persistência cognitiva** pra agentes de IA. É um servidor MCP local-first que dá a qualquer agente externo (Claude Code, Cursor, Aider, etc.) três coisas:

1. **Tools tipadas** pra registrar trabalho — tasks, decisões, planos de execução
2. **Memória estratificada** versionada em markdown
3. **Auditoria observável** que o humano consome via CLI

A premissa central: **Mnema não executa trabalho — ela registra trabalho**. Agentes externos (que sabem ler arquivos, rodar comandos, analisar código) são os executores. Mnema é o sistema de memória e gestão que sobrevive entre execuções.

O nome vem do grego μνήμη (mneme) — memória. Mnema é publicada pela **Saurim**, organização de ferramentas pra colaboração humano-IA.

### Tagline

> **Mnema — você dirige, a IA executa, tudo fica registrado.**

### O que distingue esse projeto

- **Categoria nova** — não é mais um task tracker, não é um framework de agente, não é um sistema de memória avulso. É a interseção dos três, otimizada pra colaboração humano-IA.
- **Funciona em qualquer projeto** — Node, Python, Go, projetos sem código. Independente da stack.
- **MCP-first** — agentes operam nativamente via tools tipadas. CLI é a janela do humano pra observar.
- **Workflow declarativo customizável** — máquina de estados via JSON com presets prontos
- **Identidade dupla** — toda mutação registra responsável humano + agente intermediário + execução
- **Auditoria portável e versionável** — `.audit/YYYY-MM.jsonl` no Git por padrão, configurável
- **agent_plans separado de tasks** — trabalho intra-agente é cidadão de primeira classe, não polui backlog
- **Adoção gradual** — funciona em projetos existentes sem poluir, com importadores e modos minimal
- **Version-locked por projeto** — protege contra drift entre membros do time

### O que Mnema NÃO é

Pra evitar confusão de escopo desde o início:

- ❌ **Não é um agente.** Não tem LLM embutido, não roda inferência. Agentes externos é que operam.
- ❌ **Não é um framework de agente.** Você não escreve agentes em Mnema. Você escreve agentes em Claude Code/Cursor/etc., e eles falam com Mnema via MCP.
- ❌ **Não é um executor de código.** Não lê arquivos do projeto, não roda testes, não faz refactor. O agente externo faz isso.
- ❌ **Não é um SaaS.** É local-first. Sem servidor central, sem auth, sem sync remoto built-in.
- ❌ **Não é um substituto pro Jira/Linear.** Pode complementar, mas o foco é colaboração com IA, não gestão tradicional de time grande.

---

## 1. Conceitos fundamentais

### 1.1 Dois artefatos distintos

| Artefato | O que é | Onde vive |
|---|---|---|
| **Mnema (a ferramenta)** | Pacote npm com CLI + MCP server, publicado por Saurim | `node_modules` global ou cache do `npx` |
| **Projeto Mnema (o repo operado)** | Qualquer repositório onde alguém rodou `mnema init` | Qualquer pasta do usuário |

A ferramenta **não precisa** de Node.js no projeto-alvo. Roda em repositórios Python, Go, Rust, projetos de marketing, etc.

### 1.2 Os 3 atores

| Ator | Papel | Como interage |
|---|---|---|
| **Humano** | Configura projeto, observa atividade, aprova decisões críticas | CLI (`mnema init`, `mnema history`, `mnema watch`, `mnema inbox`) |
| **Agente externo** (Claude Code, Cursor, etc.) | Executa trabalho substantivo, registra resultado | MCP tools (`task_create`, `agent_run_start`, etc.) |
| **Mnema (o sistema)** | Persiste estado, audita mutações, expõe contexto | Roda como MCP server local + processador CLI |

### 1.3 Analogias mentais

Mnema é mais próxima de:
- **`git`** — funciona em qualquer projeto, pasta `.mnema/` oculta, comandos operam no cwd
- **`direnv`** — config visível na raiz, estado oculto, sobe na árvore pra encontrar config
- **Servidor de banco de dados local** — agentes conectam, fazem queries/mutações, desconectam

Não é como:
- ~~Lib que você importa~~ (não é dependência de runtime)
- ~~Framework de aplicação~~ (não é Next.js, Rails, etc.)
- ~~Agente autônomo~~ (não tem LLM próprio)

### 1.4 Princípio agente-cêntrico

Mnema é otimizada pra **agente operar, humano observar**. Isso significa:

- **MCP é a interface primária.** CLI existe, mas é secundária e focada em observação.
- **Tools são desenhadas pra LLM consumir.** Schemas Zod com descrições ricas, mensagens de erro estruturadas pra iteração.
- **Comandos cotidianos** (criar task, mover, fechar sprint) são feitos pelo agente. O humano vê o resultado.
- **A UI mais importante pro humano** é a superfície de observação: `mnema history`, `mnema watch`, `mnema inbox`.

### 1.5 Identidade de marca

| Camada | Nome | Significado / Origem |
|---|---|---|
| **Org / publisher** | **Saurim** | Derivado do sobrenome Sauer + sufixo `-im` (plural sacro: cherubim, seraphim). Em algumas tradições, "Filho do Sol". |
| **Produto** | **Mnema** | Do grego μνήμη (mneme), "memória". Raíz da palavra mnemonic. |
| **Comando CLI** | `mnema` | Curto, pronunciável globalmente |
| **Pacote npm** | `@saurim/mnema` | Pacote único contendo CLI + MCP server. Validado como livre no npm. |
| **GitHub** | `github.com/saurim` (org) | A confirmar no setup |
| **Domínios sugeridos** | `saurim.dev`, `mnema.dev` | A registrar |

Modelo de marca: similar a "**Vercel + Next.js**" — empresa com nome próprio, produto com nome próprio. Saurim pode publicar outros produtos no futuro mantendo Mnema como a primeira ferramenta da casa.

Narrativa de marca:
> *Saurim — cognitive infrastructure for AI agents.*
> *Our first product is Mnema, a memory system for AI-driven development.*

---

## 2. Distribuição e instalação

### 2.1 Pacote npm

Distribuído como **`@saurim/mnema`** sob o scope **`@saurim`**. Pacote único contém:
- Binário CLI (`mnema`)
- MCP server (mesmo binário, subcomando `mnema mcp serve`)
- Domain logic, services, state machine
- Scripts de migração do schema
- Templates de skills, workflows, AGENTS.md
- Importadores

**Por que pacote único:** menos coordenação de versões, release mais simples, sem matriz de compatibilidade interna. Internamente o código é organizado em módulos (`src/cli/`, `src/mcp/`, `src/core/`, `src/services/`) com fronteiras claras, mas distribuído como uma unidade.

**Quando fragmentar:** se no futuro alguém precisar consumir parte isolada (ex.: `@saurim/mnema-core` pra reutilizar lógica de domínio em outro produto), aí sim cria sub-pacote. Por padrão YAGNI — não fragmentar antes da demanda real.

### 2.2 Modos de instalação

| Modo | Comando | Quando usar |
|---|---|---|
| **Global** (primário) | `npm i -g @saurim/mnema` | Uso pessoal, dev individual |
| **Dev dependency** | `npm i -D @saurim/mnema` | Time que quer travar versão por projeto |
| **Sem instalar** | `npx @saurim/mnema` | Experimentar |

### 2.3 Version check

Todo projeto declara em `mnema.config.json`:

```json
{ "mnema_version": "^1.2.0" }
```

E todo comando valida antes de operar. Bloqueia por padrão se incompatível, com flag `--no-version-check` pra forçar.

---

## 3. Arquitetura

### 3.1 Camadas

| Camada | Responsabilidade | Tecnologia |
|---|---|---|
| Storage | Persistência | SQLite (better-sqlite3) + Markdown + JSONL |
| Domain | Lógica pura, state machines, gates | TypeScript puro, sem I/O |
| Services | Orquestra domain, transações, eventos, sync | TypeScript |
| MCP Server | Tools tipadas pra agentes externos | @modelcontextprotocol/sdk |
| CLI | Janela do humano pra observar | Commander/Clipanion + @inquirer/prompts |
| Skills/Workflow | Instruções declarativas | Markdown + JSON |

**Regra de ouro:** toda mutação passa pelos Services. Nada acessa SQLite direto. Auditoria, gates e sync sempre rodam.

### 3.2 Princípio dos dois clientes (humano e agente)

CLI e MCP são duas portas pra mesma casa:

```
Humano no terminal → CLI → TaskService.transition()
                                  ↓
Agente externo  →  MCP tool  ─────┘
```

Quando o humano digita `mnema task move PROJ-12 start` ou o agente chama `task_start({task_id, ...})`, ambos caem no mesmo `TaskService.transition()`.

### 3.3 Stack técnica

- **Runtime:** Node.js 20+ (LTS)
- **Linguagem:** TypeScript estrito (`strict: true`, `noUncheckedIndexedAccess: true`)
- **CLI:** Commander
- **Prompts interativos:** @inquirer/prompts
- **DB:** better-sqlite3
- **Validação:** Zod
- **State machine:** declarativa em JSON
- **MCP:** @modelcontextprotocol/sdk
- **Logging:** Pino (com pino-pretty em dev)
- **Markdown frontmatter:** gray-matter
- **Versionamento:** semver
- **Testes:** Vitest
- **Lint/Format:** Biome (substitui ESLint + Prettier)

---

## 4. Configuração do projeto

### 4.1 `mnema.config.json` na raiz

Único arquivo obrigatório na raiz. Versionado no Git. Estrutura:

```json
{
  "version": "1.0",
  "mnema_version": "^1.0.0",
  "project": {
    "key": "WEBAPP",
    "name": "Web Application",
    "description": "Frontend e backend"
  },
  "paths": {
    "state": ".app",
    "audit": ".audit",
    "backlog": "backlog",
    "sprints": "sprints",
    "roadmap": "roadmap",
    "memory": "memory",
    "skills": "skills",
    "workflows": "workflows"
  },
  "workflow": "default",
  "mode": "single",
  "audit_strategy": "recent",
  "audit_retention_months": 12,
  "enforcement_mode": "advisory",
  "sync": {
    "mode": "hybrid",
    "agent_buffer_flush_seconds": 30,
    "agent_buffer_flush_count": 50,
    "agent_buffer_flush_on_plan_complete": true
  },
  "features": {
    "fts_search": true,
    "attachments": true
  }
}
```

### 4.2 Localização configurável

Default: tudo na raiz do projeto. Mas todos os paths são configuráveis. Time que quer isolamento total pode fazer:

```json
"paths": {
  "state": ".mnema/state",
  "audit": ".mnema/audit",
  "backlog": ".mnema/backlog",
  "..."
}
```

Resultado: tudo numa única pasta `.mnema/`, raiz fica intocada (exceto pelo `mnema.config.json`).

### 4.3 Resolução de path

Comandos sobem na árvore como o git, procurando `mnema.config.json`.

### 4.4 Modos de enforcement

`enforcement_mode` controla quão rígido o sistema é:

- **`advisory`** (default) — Mnema sugere, agente decide o que registrar
- **`strict`** — Mnema alerta visivelmente quando regras são violadas
- **`blocking`** — Mnema impede operações que violam regras

Regras configuráveis incluem `code_changes_require_task`, `decisions_require_documentation`, etc. (a definir caso a caso).

---

## 5. Estrutura gerada pelo `init`

```
meu-projeto/
├── mnema.config.json              # SEMPRE na raiz, versionado
├── AGENTS.md                    # Manifesto operacional pra agentes externos
│
├── .app/                        # Estado local (configurável, .gitignore)
│   ├── state.db                 # SQLite (estado, FTS)
│   ├── attachments/             # Arquivos anexados (hash-named)
│   └── activity.log             # Atividade efêmera (rotacionado)
│
├── .audit/                      # Histórico versionado (configurável, vai pro Git)
│   ├── current.jsonl            # Mês corrente
│   ├── 2026-04.jsonl            # Meses anteriores
│   └── 2026-03.jsonl
│
├── backlog/                     # Markdown por estado (versionado)
│   ├── DRAFT/
│   ├── READY/
│   └── ...
│
├── sprints/
│   ├── current.md
│   └── archive/
│
├── roadmap/
│   ├── epics/
│   └── 2026-Q2.md
│
├── memory/
│   ├── context.md               # Contexto persistente
│   ├── INDEX.md                 # Sempre lido por agentes
│   ├── decisions/
│   │   ├── INDEX.md             # Sempre lido
│   │   └── 0001-*.md            # Lidos sob demanda
│   └── notes/
│       └── INDEX.md
│
├── skills/                      # Procedimentos pra agentes
│   ├── SKILL.md                 # Entry point (índice)
│   ├── creating-tasks.md
│   └── ...
│
├── workflows/
│   └── default.json             # Máquina de estados
│
└── README.md                    # Gerado, explica tudo
```

### 5.1 Quatro grupos

| Grupo | Conteúdo | Versionado? |
|---|---|---|
| **Config** | `mnema.config.json`, `AGENTS.md` | **Sim** |
| **Estado local** | `.app/` | **Não** |
| **Histórico** | `.audit/` | **Sim** (configurável) |
| **Conteúdo** | `backlog/`, `sprints/`, `roadmap/`, `memory/` | **Sim** |
| **Instruções** | `skills/`, `workflows/` | **Sim** |

### 5.2 `.gitignore` automático

`init` adiciona:
```
# mnema
.app/
```

(ajustando se path foi customizado)

### 5.3 Markdown como fonte portável

Markdowns têm **estado atual** + **seções livres** preservadas em sync. SQLite é cache. `.audit/*.jsonl` é histórico imutável. Bootstrap (`mnema sync --bootstrap`) reconstrói SQLite a partir desses dois.

---

## 6. UX do `mnema init`

### 6.1 Modo wizard (sem flags)

```
$ mnema init

Bem-vindo ao Mnema! Vamos configurar seu projeto.

? Nome do projeto: Web Application
? Key (prefixo das tasks): WEBAPP
? Seu handle (será o actor padrão): daniel

? Workflow:
  ❯ default      (7 estados modernos)
    lean         (4 estados, ideal para solo dev)
    kanban       (5 estados, fluxo contínuo sem sprints)
    jira-classic (7 estados clássicos do Jira)

? Localização:
  ❯ Raiz do projeto
    Pasta dedicada (.mnema/)
    Customizada

? Estratégia de auditoria:
  ❯ recent     (últimos 12 meses no Git)
    full       (tudo no Git)
    local      (só local, não vai pro Git)

? Importar tasks de fonte externa?
  ❯ Não, começar do zero
    GitHub Issues
    Arquivo Markdown

✓ mnema.config.json criado
✓ AGENTS.md gerado
✓ Estrutura criada
✓ Workflow "default" instalado
✓ Skills templates criados
✓ .gitignore atualizado

Próximos passos:
  1. Conecte seu agente de IA ao MCP do Mnema:
     mnema mcp install-instructions claude-code
  2. Crie sua primeira task:
     mnema task create
  3. Acompanhe atividade:
     mnema watch
```

### 6.2 Modo silencioso

```bash
mnema init \
  --name="Web App" --key=WEBAPP \
  --actor=daniel \
  --workflow=default \
  --paths-mode=root \
  --audit-strategy=recent \
  --yes
```

### 6.3 Detecção de conflitos

Se há pasta conflitante (`backlog/` já existe), oferece mover paths ou usar `.mnema/`.

### 6.4 Re-execução

Em projeto já inicializado, oferece atualizar (preserva dados, atualiza templates) ou recriar.

### 6.5 Modo minimal + adoção gradual

```bash
mnema init --minimal
# cria apenas mnema.config.json, AGENTS.md, .app/, workflows/default.json

mnema adopt skills      # depois
mnema adopt memory
mnema adopt all
```

---

## 7. Adoção em projetos existentes

### 7.1 Detecção não-destrutiva

`init` nunca sobrescreve sem confirmação. Detecta, mostra, pede aprovação.

### 7.2 Importadores no MVP

**GitHub Issues:**
```bash
mnema init --import=github-issues --repo=user/repo --token=$GH_TOKEN
mnema import github-issues --repo=user/repo  # após init
```

Mapeamento: issue aberto → READY; fechado → DONE/CANCELED; labels → metadata; milestone → epic; comments → notes; author → actor.

**Markdown:**
```bash
mnema import markdown --from=./TODOS.md
mnema import markdown --from=./planning/ --recursive
```

Heurísticas: headers `## STATE Title` viram tasks; bullets viram acceptance_criteria; texto solto vira description.

Importadores são **one-shot**, não sync contínuo.

### 7.3 Comandos de adoção gradual

| Comando | Adiciona |
|---|---|
| `mnema adopt skills` | Pasta `skills/` com templates default |
| `mnema adopt memory` | Pasta `memory/` com `context.md` e `INDEX.md` |
| `mnema adopt roadmap` | Pasta `roadmap/` com estrutura |
| `mnema adopt all` | Tudo que ainda não existe |

Idempotentes — rodar 2x não duplica.

### 7.4 Desinstalação

```bash
mnema destroy
# Confirma duas vezes, remove .app/, mnema.config.json
# Pergunta sobre markdowns e .audit/
```

---

## 8. Modelo de domínio

### 8.1 Máquina de estados (workflow `default`)

| Estado | Descrição |
|---|---|
| `DRAFT` | Rascunho |
| `READY` | Pronto pra ser pego (DoR cumprida) |
| `IN_PROGRESS` | Em execução ativa |
| `BLOCKED` | Pausado por dependência |
| `IN_REVIEW` | Code review e/ou testes |
| `DONE` | Concluída |
| `CANCELED` | Descartada |

Reabertura: `DONE → IN_PROGRESS` incrementa `reopen_count`. Sem estado `REOPENED`.

### 8.2 Transições e gates

| Transição | Gate / requisito |
|---|---|
| `DRAFT → READY` (`submit`) | título + descrição + critérios + estimativa |
| `READY → IN_PROGRESS` (`start`) | assignee_id |
| `IN_PROGRESS → BLOCKED` (`block`) | razão (texto) |
| `BLOCKED → IN_PROGRESS` (`unblock`) | nota de desbloqueio |
| `IN_PROGRESS → IN_REVIEW` (`submit_review`) | link de PR ou evidência |
| `IN_REVIEW → DONE` (`approve`) | aprovação registrada |
| `IN_REVIEW → IN_PROGRESS` (`request_changes`) | feedback (texto) |
| `* → CANCELED` (`cancel`) | razão |
| `DONE → IN_PROGRESS` (`reopen`) | razão |

---

## 9. Presets de workflow

`mnema` vem com 4 presets prontos.

### 9.1 `default`

7 estados modernos. Times de dev com revisão formal.

### 9.2 `lean`

4 estados (TODO, DOING, DONE, CANCELED). Sem sprints, in_review, blocked. Solo dev.

### 9.3 `kanban`

5 estados (BACKLOG, READY, DOING, DONE, CANCELED). Sem sprints. Fluxo contínuo.

### 9.4 `jira-classic`

7 estados originais do Jira (DRAFT, OPEN, IN_PROGRESS, RESOLVED, IN_TEST, CLOSED, REOPENED). Pra times migrando.

### 9.5 Estrutura verbose de um workflow

Workflow define gates **com schema Zod-friendly inline**:

```json
{
  "name": "default",
  "version": "1.0",
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
        "description": "submits work for review and ready state",
        "use_when": "task is fully defined and ready for someone to pick up",
        "requires": {
          "title": { "type": "string", "min": 3, "max": 200 },
          "description": { "type": "string", "min": 10 },
          "acceptance_criteria": { "type": "array", "items": "string", "min": 1 },
          "estimate": { "type": "number", "enum": [1, 2, 3, 5, 8, 13] }
        }
      }
    }
  }
}
```

Os campos `description` e `use_when` são **gerados como descrição da tool MCP correspondente**, dando ao LLM contexto sobre quando usar.

### 9.6 Comandos de workflow

```bash
mnema workflow list / show / current
mnema workflow apply kanban           # warning se há tasks ativas em estado removido
mnema workflow customize              # copia preset pra workflows/custom.json
mnema workflow validate
```

---

## 10. Persistência

### 10.1 Visão geral

- **SQLite** (`paths.state/state.db`) — estado, índices, FTS
- **Markdown** (pastas configuráveis) — conteúdo legível, versionável
- **JSONL** (`paths.audit/*.jsonl`) — histórico append-only versionável
- **Arquivos** (`paths.state/attachments/`) — anexos físicos hash-nomeados

### 10.2 Schema (resumo)

| Tabela | Função |
|---|---|
| `projects` | Raiz |
| `tasks` | Entidade principal, estado mutável |
| `epics` | Agrupador temático |
| `sprints` | Ciclos (apenas um ACTIVE por projeto) |
| `transitions` | **Append-only**, com identidade dupla (actor + via_actor + run) |
| `notes` | Anotações tipadas |
| `dependencies` | Relacionamentos entre tasks |
| `decisions` | ADRs |
| `actors` | Humanos e agentes unificados |
| `agent_runs` | Execuções de agentes externos |
| **`agent_plans`** | **Trabalho intra-agente, separado de tasks** |
| `attachments` | Polimórfico: task/note/decision |
| `workspace_config` | Modo, audit_strategy, enforcement_mode |

Tabelas FTS5: `tasks_fts`, `notes_fts`, `decisions_fts`.

Migrations: `001_initial.sql`, `002_fts_attachments.sql`, `003_agent_plans_and_identity.sql` (todas validadas).

### 10.3 Decisões importantes

1. **UUIDs internos + keys humanas** (`PROJ-42`)
2. **Append-only via triggers** em `transitions`
3. **Soft delete** com `deleted_at`
4. **JSON columns** pra listas pequenas
5. **Actors polimórficos** (`kind`: human/agent)
6. **Identidade dupla** em transitions (`actor_id`, `via_actor_id`, `agent_run_id`)
7. **Auto-archive** de plans ao fim do agent_run (via trigger)
8. **Limite anti-loop** em `agent_runs` (depth ≤ 5) e `agent_plans` (depth ≤ 5)
9. **Sprint ativa única** via unique partial index
10. **FTS5 com unicode61** removendo diacríticos

### 10.4 Sync entre SQLite e Markdown

**Estratégia híbrida por contexto:**

- **CLI humano:** push imediato (markdown atualizado junto com SQLite)
- **MCP agente, durante run:** acumula em buffer **persistido em disco** (`.app/buffer.jsonl`)
- **MCP agente, ao final do run:** flush atômico
- **Triggers de flush em runs longos:** tempo (30s), volume (50 muts), ou plan completed
- **Manual `mnema sync`:** força flush em qualquer momento

**Crash recovery:** buffer é persistido a cada mutação ANTES de retornar success ao cliente. Se crash, próximo boot detecta `buffer.jsonl` não-vazio e completa flush pendente automaticamente. `mnema sync` é idempotente e pode ser rodado a qualquer momento.

**Direção:** unidirecional (SQLite → Markdown) com **conteúdo livre preservado**. Markdowns usam **YAML frontmatter** (padrão da comunidade markdown — Jekyll, Hugo, Obsidian, GitHub):

```markdown
---
mnema:
  key: WEBAPP-42
  state: IN_REVIEW
  estimate: 5
  acceptance_criteria:
    - User can authenticate via OAuth
    - Token persisted across reloads
  metadata:
    pr_url: https://github.com/example/repo/pull/123
  reporter: daniel
  assignee: daniel
  reopen_count: 0
---

# Implementar OAuth2 callback

[Conteúdo livre, editável à mão pelo humano, preservado no sync.]

## Notes

[Qualquer markdown adicional. Mnema não toca.]
```

**Regras do frontmatter:**

- **Chave `mnema:` é gerenciada pelo sistema.** Sobrescrita em cada sync.
- **Outras chaves no frontmatter são preservadas.** Útil pra integração com outras tools (Hugo, Astro, etc.)
- **Conteúdo após `---` é totalmente livre.** Mnema nunca toca.
- **Frontmatter ausente** → sync recria com defaults
- **Frontmatter `mnema:` malformado** → erro `E_MARKDOWN_INVALID_FRONTMATTER`, sync aborta com path do arquivo
- **Key no frontmatter diferente do esperado pelo path** → erro `E_MARKDOWN_KEY_MISMATCH`

**Por que YAML frontmatter ao invés de blocos HTML:**

- Renderiza corretamente em qualquer visualizador markdown (GitHub, Obsidian, VSCode preview)
- Padrão universal — parsers maduros disponíveis (`gray-matter` é referência)
- YAML é mais legível e estruturado que dialect próprio
- Permite coexistência com outras tools que usam frontmatter

### 10.5 Auditoria fragmentada

Histórico vive em `.audit/YYYY-MM.jsonl` (versionado por padrão). Formato:

```jsonl
{"v":1,"at":"2026-04-30T14:23:05.123Z","kind":"task_created","actor":"daniel","via":"agent:claude-code","run":"abc123","data":{"key":"WEBAPP-58","title":"Fix SQL injection"}}
```

`current.jsonl` é o ativo. No início de cada mês, é renomeado pra `YYYY-MM.jsonl` e novo `current.jsonl` é criado.

**Audit strategy** (configurável):
- `full` — tudo no Git, sem rotação
- `recent` — últimos N meses no Git (default: 12), antigos em `.audit/archive/` (gitignored ou git-lfs)
- `local` — `.audit/` inteiro gitignored, histórico só na máquina

### 10.6 agent_plans separado de tasks

Trabalho intra-agente vive em entidade própria. Schema completo em migration 003:

- Cada `agent_run` pode ter N plans
- Plans podem ter parent (árvore opcional, max 5 níveis)
- Public read, private write (modelo GitHub: qualquer agente lê plans de outros runs, só dono modifica)
- Auto-archive ao fim do run (trigger SQL)
- **NÃO sincronizam pra markdown** (vivem só em SQLite)
- **NÃO vão pro Git** (são processo, não estado)

Tools MCP:
- `agent_plan_create({run_id, content, parent_plan_id?, position?})`
- `agent_plan_update_state({plan_id, state, result?})`
- `agent_plans_list({run_id, include_archived?, as_tree?})`

### 10.7 Multi-projeto: modo híbrido

`workspace_config.mode = 'single' | 'multi'`. Default um banco por projeto. Multi permite portfólio.

---

## 11. Identidade e auditoria

### 11.1 Identidade dupla

Toda mutação registra três campos:

| Campo | O que é | Quando NULL |
|---|---|---|
| `actor` | Humano responsável | Nunca (sempre tem) |
| `via` | Agente intermediário | Quando humano direto via CLI |
| `run` | agent_run_id | Quando humano direto via CLI |

Exemplos:

```jsonl
# Daniel digitou direto no CLI
{"actor":"daniel","via":null,"run":null,"kind":"task_created",...}

# Daniel iniciou Claude Code, que criou task
{"actor":"daniel","via":"agent:claude-code","run":"run_abc","kind":"task_created",...}
```

### 11.2 Protocolo de identidade

**Passo 1:** `mnema init` configura humano default em `~/.config/mnema/identity.json`. Pode ser sobrescrito via env `MNEMA_ACTOR=jose`.

**Passo 2:** Agente externo, ao iniciar trabalho, chama:
```
agent_run_start({
  goal: "...",
  agent_handle: "claude-code",   // injetado pelo MCP client, não auto-declarado
  client_metadata: {...}          // pid, hostname, model, etc
})
```

Retorna `run_id`. Agente usa em todas as mutações subsequentes.

**Passo 3:** Toda mutação inclui `actor` (do identity.json), `via` (do agent_handle do MCP client) e `run` (do agent_run_start).

### 11.3 Handle do agente

**Configurado pelo MCP client, não auto-declarado pelo LLM.** O MCP client (Claude Code, Cursor, Aider) é configurado pelo humano — exemplo pra Claude Code:

```json
{
  "mcpServers": {
    "mnema": {
      "command": "mnema",
      "args": ["mcp", "serve"],
      "metadata": {
        "agent_handle": "claude-code"
      }
    }
  }
}
```

`mnema init` mostra essas instruções ao final do wizard.

### 11.4 Run obrigatório pra mutações

Mutações **exigem** `run_id` válido. Não pode haver task criada sem run associado. Reads (`tasks_list`, `task_show`) são livres.

Skills no `AGENTS.md` ensinam: "antes de qualquer mutação, sempre `agent_run_start`".

### 11.5 Múltiplos agentes simultâneos

Suportado naturalmente. Daniel pode ter Claude Code + Cursor rodando, cada um com seu próprio run, ambos com `actor=daniel`.

### 11.6 Spoofing

`via` é "soft truth" — agente pode mentir. Mas `client_metadata` (pid, hostname) é capturado da conexão MCP, mais difícil de falsificar. Pra forense, use ambos.

### 11.7 Auditoria como memória vs auditoria como evento

Distinção importante:

| Dimensão | Auditoria (`.audit/*.jsonl`) | Memória (`memory/`) |
|---|---|---|
| Pergunta | "O que aconteceu?" | "Por que aconteceu?" |
| Natureza | Factual, imutável | Semântica, curada |
| Captura | Automática | Semi-automática |
| Editável | **Nunca** | Sim, encorajado |

Auditoria captura **toda** mutação. Memória é destilada — gates extraem decisões importantes (razão de cancel vira nota), comandos explícitos registram (`mnema decision record`), agentes propõem documentar.

### 11.8 ADRs

`memory/decisions/` no padrão clássico (contexto, decisão, rationale, consequências, status). Status: `proposed`, `accepted`, `rejected`, `superseded`.

`memory/decisions/INDEX.md` é regenerado automaticamente — agentes leem ele primeiro pra saber o que existe sem ler tudo.

---

## 12. Tools MCP

### 12.1 Estratégia híbrida

| Camada | O que é | Onde mora |
|---|---|---|
| **Universais** | Tools que existem independente de workflow | Hardcoded em TS |
| **Transições** | Tools geradas a partir do workflow ativo | Geradas dinamicamente |
| **Customizadas** | Tools por projeto | Fase futura |

### 12.2 Bootstrap obrigatório do agente

Toda sessão de agente **deve** começar com duas chamadas, nessa ordem:

1. **`context_bootstrap()`** — retorna identidade do projeto, workflow, índices de memória e blockers atuais
2. **`agent_run_start({ goal })`** — cria o run pra rastrear mutações

Sem isso, mutações falham com `E_NO_ACTIVE_RUN`. Reads (`tasks_list`, `task_show`) funcionam livremente — não exigem run.

#### Tool `context_bootstrap`

```typescript
{
  name: "context_bootstrap",
  description: "Bootstrap the agent's understanding of this project. Call this once at the start of every session, BEFORE any other tool. Returns project identity, active workflow, recent decisions, and pointers to memory.",
  inputSchema: { type: "object", properties: {} },
  output: {
    project: { key: "WEBAPP", name: "...", description: "..." },
    workflow: { 
      name: "default", 
      states: ["DRAFT", "READY", "..."],
      available_actions_summary: "Use task_submit to move DRAFT→READY..."
    },
    agents_md: "...",          // até 8KB; truncated:true se maior
    memory_index: "...",        // até 4KB
    decisions_index: "...",     // lista títulos de ADRs
    active_sprint: { ... },     // se workflow tem sprints
    recent_decisions: [...],    // últimas 5 ADRs proposed/accepted
    open_blockers: [...],       // tasks BLOCKED
    statistics: { total_tasks, in_progress, blocked }
  }
}
```

`AGENTS.md` template gerado pelo init instrui o agente a fazer essas chamadas.

### 12.3 Tabela canônica de tools universais

Sempre presentes em qualquer projeto Mnema:

| Categoria | Tool | Mutação? | Requer run? |
|---|---|---|---|
| **Bootstrap** | `context_bootstrap` | ❌ | ❌ |
| **Tasks (read)** | `tasks_list` | ❌ | ❌ |
| | `task_show` | ❌ | ❌ |
| | `tasks_search` (FTS5) | ❌ | ❌ |
| **Tasks (write)** | `task_create` (cria em DRAFT) | ✅ | ✅ |
| **Decisões** | `decision_record` | ✅ | ✅ |
| | `decision_show` | ❌ | ❌ |
| | `decisions_list` | ❌ | ❌ |
| **Notas** | `note_add` | ✅ | ✅ |
| **Agent runs** | `agent_run_start` | ✅ | ❌ (cria o run) |
| | `agent_run_end` | ✅ | ✅ |
| | `agent_run_show` | ❌ | ❌ |
| **Agent plans** | `agent_plan_create` | ✅ | ✅ |
| | `agent_plan_update_state` | ✅ | ✅ |
| | `agent_plans_list` | ❌ | ❌ |
| **Sprints** (se workflow tem) | `sprint_show` | ❌ | ❌ |
| | `sprints_list` | ❌ | ❌ |
| | `sprint_add_task` | ✅ | ✅ |
| **Epics** (se workflow tem) | `epic_show` | ❌ | ❌ |
| | `epics_list` | ❌ | ❌ |
| **Audit** | `audit_query` | ❌ | ❌ |
| | `history_get` | ❌ | ❌ |

### 12.4 Tools de transição (geradas)

Uma tool por transição declarada no workflow ativo. Schema do input vem dos `requires` do gate. Todas são mutações que requerem run ativo.

Workflow `default` gera: `task_submit`, `task_start`, `task_block`, `task_unblock`, `task_submit_review`, `task_approve`, `task_request_changes`, `task_cancel`, `task_reopen`.

Workflow `kanban` gera: `task_ready`, `task_start`, `task_complete`, `task_back`, `task_cancel`.

LLM vê apenas tools relevantes ao workflow ativo — visão limpa.

### 12.5 Descrições ricas

Universais: descrições hardcoded em TS, com exemplos e anti-exemplos.

Transições: templates preenchidos com `description` e `use_when` do JSON do workflow:

```
Description: {transition.description}
Use when: {transition.use_when}
Required fields: {fields list with constraints}
```

### 12.6 Output schemas estruturados

Toda response tem schema fixo. Sucesso:

```typescript
type Success<T> = { ok: true } & T
```

Erro estruturado (alinhado com `errors-catalog.md`):

```typescript
type ErrorResponse =
  | { ok: false; error: "GATE_FAILED"; issues: Issue[]; missing: string[]; message: string }
  | { ok: false; error: "INVALID_TRANSITION"; from_state: string; action: string; available_actions: string[]; message: string }
  | { ok: false; error: "TASK_NOT_FOUND"; task_key: string; message: string }
  | { ok: false; error: "CONFLICT"; expected_updated_at: string; current_updated_at: string; message: string }
  | { ok: false; error: "DUPLICATE_KEY"; task_key: string; message: string }
  | { ok: false; error: "NO_ACTIVE_RUN"; message: string }
  | { ok: false; error: "NO_AGENT_HANDLE"; message: string }
  | { ok: false; error: "RUN_DEPTH_EXCEEDED"; max_depth: number; message: string }
  // ... ver errors-catalog.md pra lista completa
```

LLM lê o erro estruturado e ajusta payload sem alucinar reações. Mensagens humanas são adicionalmente fornecidas via campo `message`.

### 12.7 Versionamento otimista (CONFLICT)

Mutações em entidades existentes aceitam parâmetro opcional `expected_updated_at`. Se fornecido e não bater com valor atual, retorna erro `CONFLICT` com `current_updated_at`.

```typescript
// Exemplo
task_start({
  task_key: "WEBAPP-42",
  assignee_id: "daniel",
  expected_updated_at: "2026-04-30T14:23:05.123Z"  // do task_show anterior
})
// Se outro processo modificou WEBAPP-42 desde então:
// → { ok: false, error: "CONFLICT", current_updated_at: "...", message: "..." }
```

LLM pode então re-ler com `task_show`, decidir se ainda quer prosseguir, e tentar de novo.

---

## 13. Comandos de observação (humano-cêntrico)

Como o produto é agente-cêntrico, esses comandos são a interface principal pro humano.

### 13.1 `mnema history`

Mostra mutações passadas, agregadas inteligentemente.

```
$ mnema history --since=today

09:15  daniel                                    moved WEBAPP-42 → READY
14:23  daniel via agent:claude-code [run_abc]    started "audit src/auth/" [7 steps]
14:24  daniel via agent:claude-code [run_abc]    created WEBAPP-58, WEBAPP-59, WEBAPP-60
14:24  daniel via agent:claude-code [run_abc]    recorded ADR-0023
14:24  daniel via agent:claude-code [run_abc]    completed run [3 tasks · 1 ADR]
17:42  daniel                                    approved WEBAPP-42 → DONE
```

Plans aparecem agregados (`[7 steps]`). Detalhes via `--verbose` ou `mnema agent inspect <run_id>`.

### 13.2 `mnema watch`

Tail ao vivo do `.audit/current.jsonl`. Implementação simples (arquivo + `fs.watch`).

Filtros completos no MVP:
```bash
mnema watch --task=WEBAPP-42
mnema watch --agent=claude-code
mnema watch --run=run_abc123
mnema watch --since=1h
mnema watch --kind=transitions
```

Formatos:
- Texto humano (default)
- `--table` (tabela alinhada)
- `--json` (JSONL streaming)

`--verbose` adiciona atividade de `.app/activity.log` (reads, errors, thinking) — não vai pro audit, é efêmero.

Stateless por default. `--catchup=Nm` rebobina N minutos antes de live tail.

### 13.3 `mnema inbox`

Lista o que requer atenção humana:

```
⚠ Aguardando aprovação (3)
  WEBAPP-42 dark mode toggle           IN_REVIEW    2h ago
  ...

⚠ Bloqueadas precisando de você (1)
  WEBAPP-48 SAML integration           BLOCKED      "preciso credenciais SSO"

ℹ Decisões propostas pra revisar (2)
  ADR-0023 use Zustand instead of Redux
```

Inbox = "fila de aprovação humana", não lista geral de tasks.

### 13.4 `mnema agent inspect`

Detalha um agent_run específico:

```
$ mnema agent inspect run_abc123

Run: abc123
Started: 2026-04-30T14:23:01Z
Ended: 2026-04-30T14:24:35Z (1m 34s)
Actor: daniel · Via: agent:claude-code
Goal: "audit src/auth/"
Status: completed

Plans (7):
  ✓ scan SQL injection                 [completed, 25s]
  ✓ check auth bypass                  [completed, 18s]
  ✓ review session handling            [completed, 12s]
  ...

Mutations (4):
  - created task WEBAPP-58
  - created task WEBAPP-59
  - created task WEBAPP-60
  - recorded ADR-0023
```

---

## 14. Skills e AGENTS.md

### 14.1 AGENTS.md como manifesto operacional

Gerado pelo `init`. Lido por agentes externos automaticamente (Claude Code, Cursor já fazem isso). Contém:

- Identidade do projeto
- Required reading order (memory, workflow)
- Protocolos obrigatórios (run_start, mutações via tools)
- Convenções específicas (do wizard)
- Boundaries (o que nunca fazer)
- Memory write rules (depende de enforcement_mode)
- Useful patterns

### 14.2 Skills/

Procedimentos detalhados por operação. Frontmatter YAML + markdown narrativo.

```
skills/
├── SKILL.md               # Índice
├── creating-tasks.md
├── transitioning-tasks.md
├── recording-decisions.md
├── handling-blockers.md
└── ...
```

Validação: `mnema skill lint` valida frontmatter, refs a tools existentes, presença de exemplos, semver.

### 14.3 Memória estratificada

```
memory/
├── INDEX.md               # 1KB, sempre lido (índice)
├── context.md             # Identidade do projeto, sempre lido
├── decisions/
│   ├── INDEX.md           # Lista titles + tags, sempre lido
│   └── 0001-*.md          # Lidos sob demanda
└── notes/
    └── INDEX.md
```

Princípio: **arquivos `INDEX.md` são sempre lidos, conteúdo profundo é lido sob demanda**. Reduz tokens 10-20x sem perder contexto crítico.

`mnema memory consolidate` (rotina manual ou periódica): notas avulsas que ficaram relevantes viram decisões formais; decisões obsoletas viram superseded; snapshots agregam histórico.

---

## 15. Interfaces (CLI completo)

```bash
# Init e configuração
mnema init                              # wizard
mnema init --minimal --yes              # silencioso
mnema adopt <pasta>                     # adoção gradual
mnema destroy                           # remove tudo

# MCP
mnema mcp serve                         # roda MCP server (chamado pelo agent)
mnema mcp install-instructions claude-code   # imprime config pra Claude Code

# Workflow
mnema workflow list / show / current / apply / customize / validate

# Importadores
mnema import github-issues --repo=...
mnema import markdown --from=...

# Tasks (humanos)
mnema task create
mnema task list [--state=...] [--sprint=current]
mnema task show PROJ-42
mnema task move PROJ-42 start

# Sprints (se workflow tem)
mnema sprint plan / start / close / show

# Memória
mnema decision record
mnema note add PROJ-42 --content="..."
mnema memory consolidate

# Busca
mnema search "oauth login"

# Observação (CENTRAIS)
mnema history [--since=...] [--actor=...] [--via=...] [--run=...]
mnema watch [--filtros]
mnema inbox
mnema agent inspect <run_id>
mnema agent runs list

# Auditoria
mnema audit query [filters]
mnema audit task PROJ-42

# Sistema
mnema sync                              # reconstrói/sincroniza
mnema doctor                            # valida config, schema, paths
mnema skill lint
mnema --version
```

---

## 16. Roadmap de implementação

### Fase 0 — Esqueleto (1-2 dias)
- Repo único TypeScript (`@saurim/mnema`), scripts básicos (build, lint, test)
- Estrutura de pastas com fronteiras internas (`src/cli/`, `src/mcp/`, `src/core/`, `src/services/`, `src/storage/`)
- `mnema --version`
- `mnema.config.json` schema Zod
- Version check ativo
- `mnema init` cria estrutura básica (não-funcional)

### Fase 1 — Core domain (5-7 dias)
- Migrations 001, 002, 003
- State machine declarativa lê `workflows/*.json` com schema verbose
- TaskService + persistência SQLite
- Gates obrigatórios
- Comandos `task create/list/show/move`
- Validação Zod de tudo

### Fase 2 — Identidade, auditoria, sync (4-5 dias)
- Sistema de identidade (`~/.config/mnema/identity.json`, `MNEMA_ACTOR`)
- agent_runs com `agent_run_start/end`
- Identidade dupla em transitions
- `.audit/*.jsonl` fragmentado por mês
- Sync híbrido (CLI push, MCP buffer)
- `activity.log` rotacionado
- `mnema sync` rebuild idempotente
- `mnema doctor`

### Fase 3 — MCP server e tools (5-7 dias)
- `mnema mcp serve` rodando
- Tools universais (hardcoded)
- Tools de transição (geradas do workflow)
- Output schemas estruturados com erros tipados
- agent_plans tools (`agent_plan_create`, etc.)
- Test harness pra MCP (mock client)
- `mnema mcp install-instructions <client>`

### Fase 4 — Observação (3-4 dias)
- `mnema history` com filtros
- `mnema watch` com filtros e formatos
- `mnema inbox`
- `mnema agent inspect`
- `mnema agent runs list`

### Fase 5 — Sprints, busca, anexos (3-4 dias)
- Sprint e Epic
- Comandos `sprint plan/start/close`
- FTS5 + comando `search`
- Sistema de anexos

### Fase 6 — Init avançado, presets, importadores (3-4 dias)
- Wizard interativo com `@inquirer/prompts`
- Modo silencioso completo
- Detecção de conflitos
- Presets `default`, `lean`, `kanban`, `jira-classic`
- AGENTS.md generation
- Importador markdown
- Importador GitHub Issues
- `mnema adopt *`

### Fase 7 — Skills e memória (3-4 dias)
- `init` gera `skills/` e `memory/` reais
- Skill linter
- INDEX.md generation
- `mnema memory consolidate`

### Fase 8 — UX e polish
- TUI com Ink (kanban visual)
- Hooks customizáveis
- Audit strategy 'full' / 'local' modes
- Workspace mode (multi-projeto)

---

## 17. Decisões de design (registro completo)

| # | Decisão | Justificativa |
|---|---|---|
| 1 | Node.js + TS | Stack pedido, ecossistema rico |
| 2 | SQLite local-first | Offline, simples |
| 3 | better-sqlite3 síncrono | Performance |
| 4 | State machine declarativa em JSON | Customizável sem recompilar |
| 5 | 7 estados (não 6 do Jira) | DONE/CANCELED separados, BLOCKED, IN_REVIEW |
| 6 | Reabertura como metadado | Elimina REOPENED redundante |
| 7 | Gates obrigatórios desde MVP | Qualidade, captura de memória |
| 8 | Skills frontmatter + narrativo | Lido por runtime e LLM |
| 9 | UUIDs + keys humanas | Integridade + UX |
| 10 | Append-only via triggers | Auditoria não corrompível |
| 11 | Soft delete | Necessário pra auditoria |
| 12 | Multi-projeto híbrido | Padrão simples, escala |
| 13 | FTS5 nativo | Zero dep extra |
| 14 | Anexos com SHA-256 | Dedup automático |
| 15 | Global install primário | UX limpa |
| 16 | Version check obrigatório | Protege drift |
| 17 | Localização de paths configurável | Flexibilidade |
| 18 | `mnema.config.json` na raiz | Único arquivo sempre na raiz |
| 19 | Init híbrido (wizard + flags) | Padrão de ferramentas maduras |
| 20 | Presets de workflow no MVP | Cobre casos comuns |
| 21 | Importadores markdown + github | MVP cobre 80% dos casos |
| 22 | Adoção gradual via `mnema adopt` | Times grandes não migram tudo |
| 23 | Markdown como fonte portável | `mnema sync` reconstrói |
| **24** | **Cenário X: Mnema não roda agentes** | **Foco, alinhamento com Claude Code/Cursor** |
| **25** | **Reposicionamento agente-cêntrico** | **Otimiza pra agente operar, humano observar** |
| **26** | **agent_plans separado de tasks** | **Não polui backlog, cidadão de primeira classe** |
| **27** | **Audit fragmentado por mês JSONL** | **Resolve merge conflicts, organiza histórico** |
| **28** | **audit_strategy configurável** | **full/recent/local pra diferentes políticas** |
| **29** | **Identidade dupla (actor + via + run)** | **Métricas precisas + responsabilidade clara** |
| **30** | **Run obrigatório pra mutações** | **Disciplina de rastreabilidade** |
| **31** | **MCP client injeta agent_handle** | **Mais seguro que auto-declaração** |
| **32** | **Sync híbrido (push CLI, buffer MCP)** | **Performance + consistência** |
| **33** | **Markdown unidirecional + free sections** | **Permite edição manual sem complexidade** |
| **34** | **`mnema watch` via tail JSONL** | **Implementação simples, robusta** |
| **35** | **Memória estratificada (INDEX.md)** | **Reduz tokens lidos por agente em 10-20x** |
| **36** | **AGENTS.md gerado pelo init** | **Padrão emergente cross-tool** |
| **37** | **Tools híbridas (universais + geradas)** | **Type safety + customização** |
| **38** | **Schema verbose de gates no workflow JSON** | **Gera Zod precisamente** |
| **39** | **enforcement_mode configurável** | **Defaults frouxos, opções rígidas opt-in** |
| **40** | **Auto-archive de plans via trigger** | **Limpeza automática sem código de service** |
| **41** | **Pacote npm único `@saurim/mnema` (não fragmentado)** | **YAGNI: fragmentação em core/mcp/sdk só quando houver demanda real de consumo isolado** |
| **42** | **Versionamento otimista (`expected_updated_at` opcional)** | **Resolve concorrência sem perda silenciosa de dados; LLM-friendly via erro `CONFLICT` estruturado** |
| **43** | **Buffer persistido em `.app/buffer.jsonl`, não in-memory** | **Crash do MCP server não perde mutações pendentes de flush pra markdown** |
| **44** | **MCP server stdio per-session, sem daemon** | **Modelo padrão de MCP, evita complexidade de gerenciamento de processo** |
| **45** | **YAML frontmatter substitui blocos HTML em markdown** | **Padrão da comunidade markdown (Jekyll, Hugo, Obsidian); parsers maduros** |
| **46** | **Tool `context_bootstrap` como protocolo canônico de inicialização** | **AGENTS.md depende de cliente MCP suportar; bootstrap via tool é universal** |
| **47** | **Catálogo central de erros (`errors-catalog.md`)** | **Mensagens consistentes pro humano + estruturadas pro LLM, escritas antes da implementação** |
| **48** | **Sem permissões granulares no MVP** | **Time pequeno/dev solo é o use case primário; modelo de roles vira complexidade prematura** |
| **49** | **Zero telemetry, declarado como diferencial** | **Alinhado com local-first; respeito à privacidade vira parte do branding** |
| **50** | **Stack consolidada: Commander + Biome (não Clipanion/ESLint)** | **Maturidade do ecossistema + ferramenta única reduz overhead** |
| **51** | **Convenções de código formais (Apêndice B do ARCHITECTURE.md)** | **kebab-case, OOP-first, enums nativos, JSDoc completo, comentários históricos proibidos. Reduz variabilidade entre incrementos e padroniza output do agente de IA.** |

---

## 18. O que está fora de escopo

### Definitivamente out (nunca virá pra Mnema)

- ❌ **Agentes embutidos no Mnema** (Cenário X confirmado — agentes são externos)
- ❌ **Multi-tenant SaaS** — Mnema é local-first por princípio
- ❌ **Telemetry / analytics** — nenhum dado é enviado pra fora da máquina do usuário. Isso é diferencial declarado, não esquecimento.
- ❌ **UI web** — Mnema é CLI + MCP, sem servidor HTTP

### Out do MVP, possíveis futuros

- ❌ **Permissões granulares por agente** — no MVP, qualquer agente conectado pode executar qualquer tool. Apropriado pra dev solo ou time pequeno onde a "permissão" é decidida na configuração do MCP client. Modelo formal de roles/scopes fica pra fase futura quando houver demanda real.
- ❌ **Multi-agent coordination interna** (cadeia parent_run_id complexa, broker entre agentes)
- ❌ Sistema de tags (use `metadata` JSON livre)
- ❌ Notificações em tempo real
- ❌ Time tracking detalhado
- ❌ Tools MCP customizadas por projeto (plugin system)
- ❌ Sync contínuo com fontes externas (importadores são one-shot)
- ❌ Mais que 4 presets de workflow no MVP
- ❌ Sync bidirecional markdown → SQLite com watcher (markdown é unidirecional out)
- ❌ Internacionalização (i18n) — tudo em inglês no MVP. PT-BR pode vir depois sem breaking change.

---

## 19. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Skills mal escritas → comportamento errático | `skill lint` + testes com fixtures |
| LLM aluciona | Gates rejeitam payloads inválidos com erros estruturados |
| Schema engessado | Migrations versionadas, JSON metadata |
| Sync markdown ↔ SQLite diverge | SQLite cache, markdown fonte; `mnema sync` reconcilia |
| Anexos enchem disco | SHA-256 deduplica, limite por arquivo |
| Drift de versão entre devs | Version check obrigatório |
| Conflitos de pasta em projetos existentes | Detecção + opção de mover paths |
| Importadores divergem do source externo | Documentar como one-shot |
| Time não adota tudo de uma vez | `--minimal` + `mnema adopt *` |
| Customização de paths quebra LLMs | Skills referenciam paths via config |
| **Audit cresce sem controle** | **Fragmentação mensal + audit_strategy configurável** |
| **Spoofing de identidade do agente** | **Aceito; client_metadata pra forense** |
| **Plans poluem auditoria** | **Mostrados agregados em history, detalhe sob demanda** |
| **Race conditions em sync** | **File lock durante flush, transações SQLite** |
| **Crash de agente perde buffer** | **`mnema sync` idempotente reconcilia** |
| **MCP client mal-configurado não passa agent_handle** | **`mnema mcp install-instructions` gera config correta** |

---

## 20. Próximos passos imediatos

1. **~~Decidir nome final~~** ✅ Mnema (produto) + Saurim (org) — concluído na v2.1
2. **Validar org/domínios off-platform**: criar `saurim` no npm e GitHub, registrar `saurim.dev` e `mnema.dev`
3. **Setup do repo** (Fase 0): TypeScript, repo único `@saurim/mnema`, fronteiras internas em pastas
4. **Implementar Fase 0**: `mnema.config.json` schema Zod, version check, `mnema --version`
5. **Implementar Fase 1**: state machine declarativa, TaskService, SQLite, gates
6. **Aplicar migrations** 001, 002, 003 (todas validadas em sessão de design)
7. **Escrever skills core** que servirão de modelo (`creating-tasks.md`, `transitioning-tasks.md`, `recording-decisions.md`, `handling-blockers.md`)

**Recomendação forte:** seguir a ordem do roadmap. Fase 1 (core domain) sólida antes de plugar MCP. Fase 2 (identidade/audit) antes de Fase 3 (MCP). Fase 3 antes de Fase 4 (observação).

---

## Apêndice A: Glossário

- **Actor:** humano ou agente registrado
- **ADR:** Architecture Decision Record
- **Adoção gradual:** processo de adicionar features do Mnema aos poucos via `mnema adopt *`
- **Agente externo:** Claude Code, Cursor, Aider — qualquer LLM-driven tool com cliente MCP
- **agent_plan:** passo intra-execução de um agente, separado de task
- **agent_run:** execução completa de um agente externo
- **AGENTS.md:** manifesto operacional do projeto, lido por agentes externos automaticamente
- **Audit strategy:** política de retenção do `.audit/` (full, recent, local)
- **Camada de persistência cognitiva:** posicionamento do Mnema — registro + memória + auditoria pra agentes de IA
- **Drift de versão:** quando membros do time têm versões diferentes da CLI
- **Enforcement mode:** rigidez do Mnema (advisory, strict, blocking)
- **Gate:** requisito obrigatório de uma transição
- **Identidade dupla:** registro de actor (humano) + via (agente) + run (execução) em mutações
- **Importador:** adapter que converte fonte externa em entidades Mnema
- **INDEX.md:** arquivo lido sempre por agentes pra evitar ler todo conteúdo
- **Key:** identificador humano (`PROJ-42`)
- **MCP-first:** MCP é interface primária, CLI é janela de observação
- **Memória estratificada:** organização de memória que separa índice (sempre lido) de conteúdo (sob demanda)
- **Mnema:** o produto. Sistema de persistência cognitiva pra agentes de IA. Do grego μνήμη (mneme), "memória".
- **Preset:** workflow pré-construído (default, lean, kanban, jira-classic)
- **Project Mnema:** repositório onde alguém rodou `mnema init`
- **Run obrigatório:** mutações exigem agent_run_id, reads não
- **Saurim:** organização que publica Mnema. Sobrenome Sauer + sufixo `-im` (plural sacro). Em algumas tradições, "Filho do Sol".
- **Skill:** procedimento documentado pra agentes seguirem
- **Sync:** comando que reconstrói ou sincroniza SQLite ↔ Markdown
- **Sync híbrido:** push em CLI, buffer em MCP agent
- **Transition:** mudança de estado, sempre auditada
- **Workflow:** definição declarativa da máquina de estados

---

## Apêndice B: Arquivos de referência

- `001_initial.sql` — schema inicial (validado)
- `002_fts_attachments.sql` — FTS5 + anexos (validado)
- `003_agent_plans_and_identity.sql` — agent_plans + identidade dupla (validado)
- `workflows/default.json` — preset default (a criar)
- `workflows/lean.json` — preset lean (a criar)
- `workflows/kanban.json` — preset kanban (a criar)
- `workflows/jira-classic.json` — preset jira-classic (a criar)
- `skills/SKILL.md` — entry point das skills (a criar)
- `AGENTS.md` template — gerado pelo init (a criar)

---

## Apêndice C: Histórico de mudanças

### v2.3 (2026-04-30) — Convenções de código formalizadas

Sessão de definição de estilo. Decisões explícitas pra reduzir variabilidade e ambiguidade durante implementação:

- **Naming de arquivos:** kebab-case rigoroso, inclusive testes (`task-service.test.ts`)
- **Estruturas:** OOP-first — classes pra estado/lifecycle/dependências, funções soltas só pra utils stateless puros
- **Enums:** TypeScript enum nativo com valores string (não union literal, não const object)
- **Entidades:** `interface` com campos `readonly` e nomes em camelCase (mapeamento snake_case ↔ camelCase no repository)
- **Result:** factories `Ok`/`Err` como funções soltas (idiomático TS)
- **JSDoc:** completo (`@param`, `@returns`) obrigatório em toda API pública
- **Comentários proibidos:** histórico de decisão, refs a sprints/issues/conversas, TODOs com data
- **Stack consolidada:** Commander (não Clipanion), Biome (não ESLint+Prettier)

Documentação:

- **`ARCHITECTURE.md` v1.2** — novo Apêndice B normativo com 13 sub-seções de convenções obrigatórias + tabela resumo. Todos os exemplos de código revisados pra refletir as regras.
- **`EXECUTION_GUIDE.md` v1.2** — novo Princípio Operacional 0 (consultar Apêndice B antes de codar). Anti-padrões expandidos com violações específicas. Snippets atualizados.
- **Estrutura de pastas reescrita** com kebab-case e novas pastas (`enums/`, `buffer/`, sufixos descritivos).

Justificativa: convenções uniformes reduzem carga cognitiva durante review, facilitam ramp-up de novos contribuidores, e previnem inconsistência quando agentes de IA implementam código.

### v2.2 (2026-04-30) — Resolução dos 8 gaps críticos

Sessão de revisão crítica identificou 27 gaps no planejamento (categorizados em 8 críticos, 12 importantes, 7 polish). Os 8 críticos foram resolvidos antes de Fase 0 com as seguintes decisões:

- **G1 — Concorrência:** versionamento otimista com `expected_updated_at`, erro `CONFLICT` estruturado, buffer persistente em `.app/buffer.jsonl` pra crash recovery
- **G2 — Lifecycle MCP:** modelo stdio per-session (cliente spawna), multi-instance OK, SIGINT graceful shutdown com flush, cwd resolvido pelo cliente
- **G3 — Permissões:** sem permissões granulares no MVP, documentado como out-of-scope. Confiança no operador humano que configura quais agentes conectam.
- **G4 — Logging:** Pino (json em prod, pino-pretty em dev), stderr, env vars `MNEMA_LOG_LEVEL`, `MNEMA_LOG_FILE`, `MNEMA_LOG_FORMAT`. Redact automático de campos sensíveis.
- **G5 — Erros:** catálogo central em `errors-catalog.md` (38 erros), código + mensagem humana + estruturado MCP + exit code
- **G6 — Meta-schema workflow:** tipos suportados fechados (string/number/boolean/array/object com modificadores definidos), tradução tabular pra Zod, sem refs/oneOf/anyOf no MVP
- **G7 — Markdown frontmatter:** YAML frontmatter (`---`) substitui blocos HTML (`<!-- mnema:managed -->`). Padrão da comunidade markdown. Parser `gray-matter` adicionado à stack.
- **G8 — Bootstrap agente:** tool MCP `context_bootstrap` é o protocolo canônico. Toda sessão começa com ela, depois `agent_run_start`. AGENTS.md vira fallback descritivo.

Outras decisões consolidadas nessa rodada:

- **Stack definida sem ambiguidade:** Commander (não Clipanion), Biome (não ESLint+Prettier)
- **Telemetry:** zero, declarado como diferencial em out-of-scope
- **i18n:** inglês no MVP, PT-BR adiável

Documentos atualizados: DESIGN.md (esta seção), ARCHITECTURE.md (novas seções de concorrência, lifecycle MCP, logging, meta-schema), EXECUTION_GUIDE.md (Fase 1 com bootstrap, Fase 5 com tools atualizadas), errors-catalog.md (novo).

### v2.1 (2026-04-30) — Identidade de marca cristalizada
- **Nome do produto:** **Mnema** (do grego μνήμη/mneme, "memória"). Validado livre no npm raw e em todos os scopes derivados.
- **Nome da org:** **Saurim** (sobrenome Sauer + sufixo `-im` plural sacro; em algumas tradições, "Filho do Sol"). Validado livre no npm.
- **Estrutura de pacotes:** **pacote único** `@saurim/mnema` (CLI + MCP server + domain). YAGNI — fragmentação em sub-pacotes (`core`, `mcp`, `sdk`) fica reservada pra quando houver demanda real de consumo isolado.
- **Modelo de marca:** Vercel + Next.js — empresa com nome próprio, produto com nome próprio. Permite Saurim publicar outros produtos no futuro.
- **Substituições no documento:** todas as referências a "orq" (placeholder) substituídas pelos nomes finais. Comandos CLI (`orq init` → `mnema init`), config (`orq.config.json` → `mnema.config.json`), pastas (`.orq/` → `.mnema/`), env vars (`ORQ_ACTOR` → `MNEMA_ACTOR`), marcadores HTML (`<!-- orq:managed -->` → `<!-- mnema:managed -->`), config paths (`~/.config/orq/` → `~/.config/mnema/`).
- **Pesquisa de naming arquivada:** análise de 30+ alternativas (Memex, Engram, Vellum, Mnemex, Mnemon, Stele, Cairn, Almanac, etc.) revelou saturação massiva de termos óbvios em 2026. Mnema sobreviveu como única raíz grega de memória ainda livre. Saurim foi cunhado como neologismo único derivado do sobrenome.
- **Validações pendentes** (off-platform, responsabilidade do Daniel): criar org `saurim` no npm e GitHub; registrar domínios `saurim.dev` e `mnema.dev`; busca de marca registrada no INPI/USPTO.

### v2.0 (2026-04-30) — Reposicionamento agente-cêntrico
- **Cenário X confirmado:** Mnema NÃO roda agentes embutidos. Agentes são externos (Claude Code, etc.)
- **Reposicionamento:** "camada de persistência cognitiva pra agentes de IA"
- **Adicionado:** `agent_plans` como entidade separada de tasks (decisão #26)
- **Adicionado:** identidade dupla (`actor` + `via` + `run`) em transitions (decisão #29)
- **Adicionado:** audit fragmentado por mês em `.audit/YYYY-MM.jsonl` (decisão #27)
- **Adicionado:** `audit_strategy` configurável (full/recent/local) (decisão #28)
- **Adicionado:** sync híbrido por contexto (push CLI, buffer MCP) (decisão #32)
- **Adicionado:** seções "free" preservadas em markdown (decisão #33)
- **Adicionado:** memória estratificada com INDEX.md (decisão #35)
- **Adicionado:** AGENTS.md como manifesto operacional (decisão #36)
- **Adicionado:** tools híbridas universais + geradas (decisão #37)
- **Adicionado:** schema verbose de gates no workflow (decisão #38)
- **Adicionado:** enforcement_mode configurável (decisão #39)
- **Adicionado:** auto-archive de plans via trigger SQL (decisão #40)
- **Adicionado:** comandos centrais de observação (`history`, `watch`, `inbox`, `agent inspect`)
- **Adicionado:** `.app/activity.log` separado de audit
- **Removido do MVP:** agentes embutidos do Mnema, multi-agente interno, `agents/` folder
- **Migration 003** criada e validada
- **Roadmap** reorganizado em 8 fases (era 6)

### v1.1 (2026-04-30)
- Conceitos fundamentais (dois artefatos)
- Distribuição e instalação com modos npm
- `mnema.config.json` como ponto de entrada universal
- UX do init com wizard + flags
- Adoção em projetos existentes (importadores, `mnema adopt`)
- Presets de workflow (4 opções)
- Version check obrigatório

### v1.0 (2026-04-30)
- Versão inicial após sessão de design colaborativa
- Modelo de domínio, schema, máquina de estados, skills, agentes
