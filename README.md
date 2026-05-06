# Mnema

> Cognitive persistence for AI agents.
> *You drive, the AI executes, everything is recorded.*

Mnema is a local-first MCP server that gives any external AI agent
(Claude Code, Cursor, Aider, …) typed tools to record work, maintain
contextual memory, and leave an auditable trail. Humans drive through
the terminal and observe through the history. Mnema does not run
agents — it stores everything they touch.

## Quickstart

```bash
# 1. Install (Node 20+ required)
pnpm add -g @saurim/mnema      # or: npm i -g @saurim/mnema

# 2. Initialise a project
cd my-project
mnema init --name "My App" --key "MYAPP"

# 3. Wire your AI client to the MCP server
mnema mcp install-instructions claude-code
# follow the printed snippet, restart your client

# 4. Start working — everything goes through tools
#    (the agent calls task_create, task_submit, … you see the result)
```

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
- **Append-only audit log** at `.audit/*.jsonl`. Goes to Git; rotates
  monthly; queryable with `mnema history` / `mnema audit query`.
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
├── mnema.config.json     # versioned configuration
├── AGENTS.md             # operating manual for agents (versioned)
├── .app/                 # local state — gitignored
│   ├── state.db          #   SQLite (FTS, tasks, runs, audit metadata)
│   └── attachments/      #   hash-named binary attachments
├── .audit/               # append-only event log (versioned by default)
│   └── current.jsonl
├── backlog/              # one folder per workflow state
│   ├── DRAFT/MYAPP-1.md
│   ├── READY/
│   └── …
├── sprints/              # sprint planning notes
├── roadmap/              # quarterly / theme docs
├── memory/               # human-curated context (decisions, notes)
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

`mnema.config.json` is the only configuration. Minimal fields:

```json
{
  "version": "1.0",
  "mnema_version": "^0.1.0",
  "project": { "key": "MYAPP", "name": "My Application" },
  "workflow": "default"
}
```

Optional fields with their defaults are listed in
[docs/DESIGN.md §4.1](docs/DESIGN.md). Custom paths, audit retention,
sync flush thresholds and feature flags all live there.

## Workflows

Workflows are JSON files in `workflows/`. The default ships with
seven states — `DRAFT → READY → IN_PROGRESS → IN_REVIEW → DONE`,
with `BLOCKED` and `CANCELED` branches. Each transition declares
its gate (which fields are required, with min/max/enum/format
constraints expressed in a small JSON DSL) — Mnema translates the
gate into Zod at boot time and surfaces one MCP tool per transition.

To switch presets, edit `workflow` in `mnema.config.json` and run
`mnema doctor`. To author a new workflow, copy
[workflows/default.json](workflows/default.json) and tweak — the
schema is documented in
[docs/ARCHITECTURE.md §13](docs/ARCHITECTURE.md).

## Status

Mnema is **pre-release** (`0.1.0`). Phases 0–9 of the build kit are
complete; secondary features (decisions, notes, full sprint MCP
surface, advanced wizard) are tracked in [docs/TECH_DEBT.md](docs/TECH_DEBT.md).

## License

MIT — see [LICENSE](LICENSE).
