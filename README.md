# Mnema

> Cognitive persistence for AI agents.
> *You drive, the AI executes, everything is recorded.*

Mnema is a local-first MCP server that gives any external AI agent
(Claude Code, Cursor, Aider, …) typed tools to record work, maintain
contextual memory, and leave an auditable trail. Humans drive through
the terminal and observe through the history. Mnema does not run
agents — it stores everything they touch.

## Quickstart

> **Status:** Mnema is in `0.1.0-alpha`, not yet published to npm. The
> only supported install path right now is from source — see the
> [Install](#install) section below. Public alpha on npm comes after
> the dogfooding cycle stabilises (likely with `0.2.0-alpha`).

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

Mnema is not on npm yet. Install from source:

```bash
git clone https://github.com/saurim/mnema.git
cd mnema
pnpm install
pnpm build
# Either symlink the entry point or use the bundled wrapper:
ln -s "$PWD/mnema" /usr/local/bin/mnema   # optional, for global access
mnema --version
```

Requires Node 20+. The bundled `./mnema` shell script in the repo
forwards to `dist/index.js` — useful for dogfooding without a global
install.

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

Mnema is **alpha** (`0.1.0-alpha.x`). The core surface is in place
(tasks, sprints, decisions, notes, epics, attachments, FTS search,
audit log, MCP tools), and the package is being shaken out before
public release. Currently install-from-source only — npm publish is
planned for `0.2.0-alpha` once the dogfood cycle settles. See
[CHANGELOG.md](CHANGELOG.md) for the per-phase history.

## License

MIT — see [LICENSE](LICENSE).
