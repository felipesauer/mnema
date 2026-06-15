# Mnema

[![CI](https://github.com/felipesauer/mnema/actions/workflows/ci.yml/badge.svg)](https://github.com/felipesauer/mnema/actions/workflows/ci.yml)
[![version](https://img.shields.io/badge/version-0.4.0--alpha.0-orange)](./CHANGELOG.md)
[![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A520-green)](./package.json)

> A tamper-evident, local-first audit trail for AI-agent work.
> *You drive, agents execute — and you can prove what happened.*

Mnema is a local-first MCP server that gives external AI agents
(Claude Code, Cursor, Aider, …) typed tools to do work behind
workflow gates, while every action lands in a SHA-256 hash-chained
audit log that records **who** coordinated, **which** agent executed,
and in **which** run. Humans drive through the terminal and verify
through the history. Mnema does not run agents — it makes their work
accountable.

> **Not a semantic-memory layer.** Mnema does not do embeddings or
> similarity recall — if you want an agent to *remember facts* across
> sessions, reach for Mem0 or Cognee. Mnema answers a different
> question: *what did the agents do, who authorized it, and can you
> prove the record wasn't altered?* It pairs cleanly with a memory
> layer; it doesn't replace one.

## Table of contents

- [Quickstart](#quickstart)
- [What you get](#what-you-get)
- [Install](#install)
- [What it gives you](#what-it-gives-you)
- [Project layout after `mnema init`](#project-layout-after-mnema-init)
- [Common CLI commands](#common-cli-commands)
- [How the MCP loop works](#how-the-mcp-loop-works)
- [Configuration](#configuration)
- [Workflows](#workflows)
- [Status](#status)
- [Further reading](#further-reading)
- [License](#license)

## What you get

| Surface | What |
|---|---|
| **Tasks** | Create / move through workflow gates / soft delete / restore / history. Acceptance criteria + estimate + assignee. |
| **Sprints** | Plan / start / close (one active per project) with goal, capacity, attach tasks. |
| **Epics** | Group tasks under a single epic with state OPEN/CLOSED. |
| **Decisions (ADRs)** | proposed → accepted/rejected → superseded chain with `decision_promote_from_note` shortcut. |
| **Notes** | Typed (`agent_observation`, `review_feedback`, `block_reason`, …) attached to tasks. |
| **Attachments** | Hash-deduplicated; routed to task or decision by key shape. |
| **FTS5 search** | Across tasks, decisions, notes, skills, memories, observations; diacritic-insensitive. |
| **Agent runs & plans** | Wrap every batch of mutations; max depth 5; parent/child inspect via CLI. |
| **Audit log** | JSONL + SHA-256 hash chain (schema v2) mirrored to SQLite. `doctor` detects edits, truncation, replays, deletion. |
| **Skills + memories + observations** | Agent-authoritative via `*_record` MCP tools; mirrored to `.md` files. |
| **Workflows** | 4 shipping presets (`default`, `lean`, `kanban`, `jira-classic`); custom JSON validated by schema refines. |
| **`doctor`** | 16 checks: config, version, workflow shape, paths, DB, migrations, mirrors, audit integrity, task state drift. |
| **MCP tools** | 30+ universal tools + one per workflow action; `context_bootstrap` is the canonical session entry. |

## Quickstart

> **Status:** Mnema is in alpha. Releases are published to npm under
> the `alpha` dist-tag — see the [Install](#install) section below.
> The alpha surface is feature-rich (tasks, sprints, decisions, skills,
> memories, agent runs, hash-chained audit log, 4 shipping workflows)
> and is being hardened through a dogfooding cycle before a stable tag.

<!-- Asciinema cast: render via `bash scripts/record-quickstart.sh`
     then host on asciinema.org and replace the link below. -->
<!-- [![asciicast](https://asciinema.org/a/PLACEHOLDER.svg)](https://asciinema.org/a/PLACEHOLDER) -->

```bash
# 1. Initialise a project
cd my-project
mnema init --name "My App" --key "MYAPP"

# 2. Wire your AI client to the MCP server
mnema mcp install-instructions claude-code
# follow the printed snippet, restart your client

# 3. Start working — everything goes through tools
#    (the agent calls task_create, task_submit, … you see the result)
```

## Install

```bash
npm install -g @felipesauer/mnema@alpha
mnema --version
```

Requires Node 20+. While Mnema is in alpha, releases are published
under the `alpha` dist-tag (plain `npm install -g @felipesauer/mnema`
will not resolve until the first stable release).

Notes on the native SQLite binding (`better-sqlite3`):

- **npm / npx**: works out of the box — a prebuilt binary is
  downloaded for common platforms, no compiler toolchain needed.
- **pnpm**: pnpm blocks dependency build scripts by default, which
  leaves the binding missing at runtime. Run
  `pnpm approve-builds better-sqlite3` after installing (or add it
  to `onlyBuiltDependencies` in your project).
- Platforms without a prebuilt binary need a C++ toolchain
  (`python3`, `make`, `g++`) for the fallback source build.

To work from source instead:

```bash
git clone https://github.com/felipesauer/mnema.git
cd mnema
pnpm install
pnpm build
# Either symlink the entry point or use the bundled wrapper:
ln -s "$PWD/mnema" /usr/local/bin/mnema   # optional, for global access
mnema --version
```

The bundled `./mnema` shell script in the repo forwards to
`dist/index.js` — useful for dogfooding without a global install.

When you want a quick look at what the agent has been doing:

```bash
mnema history --since=today        # formatted activity log
mnema watch                        # live tail
mnema inbox                        # what's waiting on you
mnema agent inspect <run_id>       # detail of a single agent run
```

## What it gives you

- **Typed MCP tools** for tasks, agent runs, agent plans, decisions
  and the audit log — agents call them directly, no free-form prose.
- **Workflow as data**: state machines live in JSON
  ([workflows/default.json](workflows/default.json)), with gate
  validation per transition. Four presets ship out of the box —
  `default`, `lean`, `kanban`, `jira-classic`.
- **Dual identity** on every mutation: human actor, agent intermediary
  and run id. Lets you see *who* did *what* through *which* agent.
- **Append-only audit log** at `.mnema/audit/*.jsonl`. Goes to Git;
  rotates monthly; queryable with `mnema history` / `mnema audit query`.
- **Markdown + SQLite**: the SQLite database is the cache, the
  per-task markdown files are the portable source of truth. They
  survive without Mnema — open them in any text editor.
- **FTS5 search** over tasks, decisions and notes, diacritic-insensitive.
- **Adoption-friendly**: `mnema init --minimal` then
  `mnema adopt all` lets you ease into existing projects;
  `mnema import markdown` and `mnema import github-issues` ingest
  legacy work.
- **Zero telemetry**, zero remote dependencies. Everything stays in
  your repo.

## Project layout after `mnema init`

```
my-project/
├── AGENTS.md                 # operating manual for agents (versioned)
├── .gitignore                # pre-seeded ignores for local state
└── .mnema/                   # everything Mnema owns
    ├── mnema.config.json     # project configuration (versioned)
    ├── audit/                # append-only event log (versioned by default)
    │   └── current.jsonl
    ├── state/                # local cache — gitignored
    │   └── state.db          #   SQLite (FTS, tasks, runs, audit metadata)
    ├── backlog/              # one folder per workflow state
    │   ├── DRAFT/MYAPP-1.md
    │   ├── READY/
    │   └── …
    ├── sprints/              # sprint planning notes
    ├── roadmap/              # quarterly / theme docs
    ├── memory/               # human-curated context (decisions, notes)
    ├── skills/               # agent-recorded skills, mirrored to .md
    └── workflows/
        └── default.json      # active state machine
```

## Common CLI commands

| Command | What it does |
|---|---|
| `mnema init` | Create the full layout (use `--minimal` for adoption) |
| `mnema adopt <component>` | Add `skills/`, `memory/` or `roadmap/` later |
| `mnema task create / list / show / move` | Manage tasks |
| `mnema sprint plan / start / close / show / add` | Manage sprints |
| `mnema search <query>` | Full-text search across the project |
| `mnema attach add <task> <file>` | Attach a binary, deduped by SHA-256 |
| `mnema history --since=today` | Compact human activity view |
| `mnema watch` | Live tail of mutations |
| `mnema inbox` | Tasks awaiting review or blocked |
| `mnema agent inspect <run_id>` | Detail of an agent run with its plans and mutations |
| `mnema audit query [filters]` | Raw audit log access |
| `mnema sync` | Rebuild the SQLite cache from the markdowns |
| `mnema doctor` | Read-only diagnostic check |
| `mnema skill lint` | Validate `skills/` files (frontmatter, MCP tool refs, examples) |
| `mnema memory consolidate` | Regenerate the `INDEX.md` files under `memory/` |
| `mnema import markdown --from PATH` | One-shot import from `## STATE Title` headings |
| `mnema import github-issues --repo OWNER/REPO` | One-shot import from GitHub Issues |
| `mnema mcp serve` | Start the MCP server on stdio (called by your AI client) |
| `mnema mcp install-instructions <client>` | Print the right config snippet |

Run `mnema <command> --help` for full flags and examples.

## How the MCP loop works

1. Your AI client (Claude Code, Cursor, …) spawns `mnema mcp serve`
   with `cwd` pointing at your project. Configure it once via
   `mnema mcp install-instructions claude-code` (the printed snippet
   already includes the right `agent_handle`).
2. The agent calls `context_bootstrap` first — it gets the project
   identity, active workflow, recent decisions and pointers to
   memory.
3. Before any mutation it calls `agent_run_start({ goal })` — without
   an active run, mutations are rejected with `NO_ACTIVE_RUN`.
4. It then uses `task_create`, `task_submit`, `task_block`, … as the
   workflow allows. Every transition is validated against the gate
   (`task_submit` requires `title`, `description`,
   `acceptance_criteria`, `estimate`).
5. When done, `agent_run_end({ status: "completed" })` flushes the
   sync buffer and closes the run.

Throughout, you can `mnema watch` to see every mutation in real time.

## Configuration

`.mnema/mnema.config.json` is the only configuration. Minimal fields:

```json
{
  "version": "1.0",
  "mnema_version": "^0.4.0-alpha.0",
  "project": { "key": "MYAPP", "name": "My Application" },
  "workflow": "default"
}
```

Optional fields cover custom paths, audit retention, sync flush
thresholds and feature flags. Run `mnema doctor` after editing — it
re-validates the file against the schema and reports anything that
drifted.

## Workflows

Workflows are JSON files in `workflows/`. The default ships with
seven states — `DRAFT → READY → IN_PROGRESS → IN_REVIEW → DONE`,
with `BLOCKED` and `CANCELED` branches. Each transition declares
its gate (which fields are required, with min/max/enum/format
constraints expressed in a small JSON DSL) — Mnema translates the
gate into Zod at boot time and surfaces one MCP tool per transition.

To switch presets, edit `workflow` in `mnema.config.json` and run
`mnema doctor`. To author a new workflow, copy
[workflows/default.json](workflows/default.json) and tweak.

## Status

Mnema is **alpha** (`0.4.0-alpha.0` as of 2026-06-09). The
accountability core is the differentiator and it is in place: a
SHA-256 hash-chained audit log with `doctor` tamper-detection
(edits, truncation, replays, deletion), dual-identity capture
(human actor + agent + run) on every event, workflow gates that
reject invalid transitions, and optimistic-concurrency lost-write
protection in every mutation. Around it the full surface is built —
tasks, sprints, decisions, notes, epics, attachments, FTS search,
agent runs & plans, 9 skill/memory/observation MCP tools, 4 shipping
workflows (`default`, `lean`, `kanban`, `jira-classic`), and a
workflow schema with cross-cutting refines. The package is being
shaken out via adversarial sweeps (audit immutability, multi-actor
concurrency, custom workflow validation) and an end-to-end 21-phase
smoke suite before public release.

**436 tests, 0 skipped, lint + build clean.** Every release passes a
13-check publish gate ([scripts/publish-check.sh](scripts/publish-check.sh))
plus a 21-phase manual smoke before tagging. See
[CHANGELOG.md](CHANGELOG.md) for the per-version history.

## Further reading

- **[CHANGELOG.md](CHANGELOG.md)** — per-version + per-phase
  history, with rationale for every breaking change.
- **[CONTRIBUTING.md](CONTRIBUTING.md)** — dev setup, commit
  conventions, smoke run, things to watch out for when touching
  the schema, the audit log, or the workflow.
- **[evaluations/](evaluations/)** — friction reports from real-world
  tests and adversarial sweeps (audit immutability, multi-actor
  concurrency, custom workflow validation). Each doc is a snapshot
  of what broke, how it was diagnosed, and what shipped to fix it.
- **AGENTS.md** (generated by `mnema init`) — the contract a fresh
  AI agent reads on session start so it knows how to drive Mnema
  responsibly.

## License

MIT — see [LICENSE](LICENSE).
