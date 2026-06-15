# Mnema

[![CI](https://github.com/felipesauer/mnema/actions/workflows/ci.yml/badge.svg)](https://github.com/felipesauer/mnema/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@felipesauer/mnema/alpha?label=npm%20alpha&color=orange)](https://www.npmjs.com/package/@felipesauer/mnema)
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

- [Why Mnema](#why-mnema)
- [Quickstart](#quickstart)
- [Install](#install)
- [What you get](#what-you-get)
- [How the MCP loop works](#how-the-mcp-loop-works)
- [Project layout after `mnema init`](#project-layout-after-mnema-init)
- [Common CLI commands](#common-cli-commands)
- [Configuration](#configuration)
- [Workflows](#workflows)
- [Status](#status)
- [Getting help](#getting-help)
- [Further reading](#further-reading)
- [License](#license)

## Why Mnema

When an AI agent works in your repository, three questions usually go
unanswered: *what exactly did it change, did it skip the steps it was
supposed to follow, and can you trust the record after the fact?*
Mnema answers all three.

- **It makes agent work provable.** Every mutation appends to a
  SHA-256 hash-chained audit log. Change one past entry and the chain
  breaks — `mnema doctor` catches edits, truncation, replays, and
  deletion. This is the part most agent tooling doesn't have.
- **It keeps the human in the loop.** Agents move work through a
  workflow whose gates reject invalid transitions (no submitting a
  task with no acceptance criteria, no skipping review). You approve
  through the terminal; the agent can't route around you.
- **It records who did what.** Each event carries a dual identity —
  the human who coordinated, the agent that executed, the run it
  belonged to — so the history reads like a chain of custody.
- **It stays yours.** Local-first, zero telemetry, no remote
  services. SQLite + plain-text Markdown/JSONL in your repo; the
  files outlive Mnema and open in any editor.

| Instead of… | …you get |
|---|---|
| A task tracker with no cryptographic guarantee the log is intact | A tamper-evident hash chain with `doctor` verification |
| A semantic memory layer (Mem0, Cognee) that recalls facts | A provable record of *actions taken*, not facts remembered |
| A heavyweight Jira/web UI | An MCP server + CLI that lives next to your code |
| Free-form agent prose you have to trust | Typed tools behind workflow gates that reject bad input |

## Quickstart

> **Status:** Mnema is published on npm as an alpha (see
> [Install](#install)). The surface is feature-rich and is still being
> hardened toward a stable `1.0`.

```bash
# 1. Install and initialise a project
npm install -g @felipesauer/mnema@alpha
cd my-project
mnema init --name "My App" --key "MYAPP"

# 2. Wire your AI client to the MCP server
mnema mcp install-instructions claude-code
```

Step 2 prints the exact registration command and config for your
client. For Claude Code it looks like this:

```text
Register with `claude mcp add` (preferred), or paste the JSON
below into ~/.claude.json under `mcpServers`:

  claude mcp add mnema -s user -e MNEMA_AGENT_HANDLE=claude-code -- mnema mcp serve
```

Run that `claude mcp add` line, restart your client, and confirm the
project is healthy:

```bash
mnema doctor          # all checks green on a fresh project
```

From here your agent drives Mnema through MCP tools, and you watch
and approve from the terminal — walked through end to end in
[How the MCP loop works](#how-the-mcp-loop-works).

<!-- TODO before public launch: record an asciinema cast of the loop
     below (init → agent run → history → doctor) and embed it here —
     a tamper-detection demo is the most persuasive thing this README
     could show. -->

## What you get

| Surface | What it does |
|---|---|
| **Audit log** | Every action appends to a SHA-256 hash-chained JSONL log (mirrored to SQLite). `mnema doctor` detects edits, truncation, replays, and deletion. |
| **Workflow gates** | A state machine per task; each transition declares required fields and Mnema rejects invalid moves. |
| **Agent runs & plans** | Wrap every batch of mutations in a run (parent/child, max depth 5); inspect any run later via the CLI. |
| **Dual identity** | Each event records the human actor, the agent that executed, and the run — a built-in chain of custody. |
| **Tasks, sprints, epics** | Full work tracking: tasks with acceptance criteria/estimate/assignee, one active sprint per project, epics grouping tasks. |
| **Decisions (ADRs)** | proposed → accepted/rejected → superseded chains, with a shortcut to promote a note into a decision. |
| **Full-text search** | Search across tasks, decisions, notes and more — case- and accent-insensitive. |
| **Attachments** | Files attached to a task or decision, deduplicated by content hash. |
| **Skills, memories, observations** | Human-curated knowledge the agent records via MCP tools, mirrored to plain `.md` files (not semantic recall — see the note above). |
| **Workflows** | 4 presets (`default`, `lean`, `kanban`, `jira-classic`) plus custom JSON validated against a schema. |
| **MCP tools** | 30+ universal tools plus one per workflow action; `context_bootstrap` is the canonical session entry point. |

## Install

The Quickstart above covers the common path
(`npm install -g @felipesauer/mnema@alpha`). A few platform notes:

- Alpha releases live under the `alpha` dist-tag, so install with
  `@alpha` to be explicit about what you're getting. (Until the first
  stable `1.x` ships, `latest` also points at the current alpha.)
- The native SQLite binding (`better-sqlite3`) installs a **prebuilt
  binary** with npm/npx — no compiler needed. With **pnpm**, run
  `pnpm approve-builds better-sqlite3` afterwards (pnpm blocks build
  scripts by default). Platforms without a prebuilt binary need a C++
  toolchain (`python3`, `make`, `g++`).

To work from source instead:

```bash
git clone https://github.com/felipesauer/mnema.git
cd mnema
pnpm install
pnpm build
ln -s "$PWD/mnema" /usr/local/bin/mnema   # optional, for global access
mnema --version
```

The bundled `./mnema` shell script forwards to `dist/index.js` —
useful for dogfooding without a global install.

### Adopting an existing project

You don't have to start clean. `mnema init --minimal` then
`mnema adopt all` eases Mnema into a repo that already has work, and
`mnema import markdown` / `mnema import github-issues` pull legacy
items in.

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

### A concrete pass

An agent asked to "add a rate limiter" might: start a run, create
`MYAPP-12`, submit it through the gate (which forces acceptance
criteria and an estimate), move it to `IN_PROGRESS`, do the work,
then submit it for review. It cannot mark its own task `DONE` — the
`default` workflow routes that through your approval. Meanwhile you
watch and inspect from the terminal:

```bash
mnema watch                        # live tail of every mutation
mnema inbox                        # what's waiting on your review
mnema history --since=today        # formatted activity log
mnema agent inspect <run_id>       # one run, with its plans + mutations
mnema doctor                       # re-verify the audit chain anytime
```

Approve with `mnema task move MYAPP-12 approve`, and the whole
sequence — who, which agent, which run, in what order — is sitting in
the hash-chained audit log, verifiable forever.

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

Mnema is **alpha** and published on npm. The
accountability core is the differentiator and it is in place: a
SHA-256 hash-chained audit log with `doctor` tamper-detection
(edits, truncation, replays, deletion), dual-identity capture
(human actor + agent + run) on every event, workflow gates that
reject invalid transitions, and optimistic-concurrency lost-write
protection in every mutation. Around it the full surface is built —
tasks, sprints, decisions, notes, epics, attachments, FTS search,
agent runs & plans, 9 skill/memory/observation MCP tools, 4 shipping
workflows (`default`, `lean`, `kanban`, `jira-classic`), and a
workflow schema with cross-cutting refines. The package keeps being
shaken out via adversarial sweeps (audit immutability, multi-actor
concurrency, custom workflow validation) and an end-to-end 21-phase
smoke suite on the way to a stable `1.0`.

**436 tests, 0 skipped, lint + build clean.** Every release passes a
13-check publish gate ([scripts/publish-check.sh](scripts/publish-check.sh))
plus a 21-phase manual smoke before tagging. See
[CHANGELOG.md](CHANGELOG.md) for the per-version history.

## Getting help

- **Bug or unexpected behaviour?** Open an issue — the bug-report
  template asks for `mnema --version`, repro steps, and (if relevant)
  a snippet of `.mnema/audit/current.jsonl`.
- **Question or idea?** Use [GitHub Discussions](https://github.com/felipesauer/mnema/discussions).
- **Security issue?** Report it privately — see [SECURITY.md](SECURITY.md).
- **Want to contribute?** Start with [CONTRIBUTING.md](CONTRIBUTING.md).

## Further reading

- **[CHANGELOG.md](CHANGELOG.md)** — per-version history, with
  rationale for every notable change.
- **[CONTRIBUTING.md](CONTRIBUTING.md)** — dev setup, commit
  conventions, smoke run, and what to watch out for when touching
  the schema, the audit log, or the workflow.
- **AGENTS.md** (generated by `mnema init`) — the contract a fresh
  AI agent reads on session start so it knows how to drive Mnema
  responsibly.

## License

[MIT](LICENSE) © Felipe Sauer
