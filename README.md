<h1 align="center">
  <br>
  <img src="./docs/assets/logo.png" alt="mnema logo" width="180">
  <br>
  mnema
  <br>
</h1>

<p align="center"><em>a tamper-evident audit chain for AI-agent work</em></p>

<p align="center">
  <a href="https://www.npmjs.com/package/@felipesauer/mnema"><img src="https://img.shields.io/npm/v/@felipesauer/mnema/alpha?style=flat-square&logo=npm&logoColor=white&label=npm%20alpha&color=cb3837" alt="npm alpha version"></a>
  <a href="https://www.npmjs.com/package/@felipesauer/mnema"><img src="https://img.shields.io/npm/dm/@felipesauer/mnema?style=flat-square&logo=npm&logoColor=white&label=downloads&color=cb3837" alt="npm downloads per month"></a>
  <a href="https://modelcontextprotocol.io"><img src="https://img.shields.io/badge/platform-MCP-000000?style=flat-square&logo=anthropic&logoColor=white" alt="Model Context Protocol server"></a>
  <a href="https://www.npmjs.com/package/@felipesauer/mnema"><img src="https://img.shields.io/npm/types/@felipesauer/mnema?style=flat-square&logo=typescript&logoColor=white" alt="bundled TypeScript types"></a>
  <a href="./package.json"><img src="https://img.shields.io/node/v/@felipesauer/mnema?style=flat-square&logo=nodedotjs&logoColor=white&label=node&color=339933" alt="node engine"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="license MIT"></a>
</p>

> A tamper-evident, local-first audit trail for AI-agent work.
> *You drive, agents execute — every change stamped with who authorized it and which agent ran it, in a log you can prove wasn't altered.*

Mnema is a local-first MCP server that gives external AI agents
(Claude Code, Cursor, Aider, …) typed tools to do work behind
workflow gates, while every action lands in a **cryptographically
verifiable** audit log that records **who** coordinated, **which**
agent executed, and in **which** run. The log is protected in depth: a
hash chain catches accidental corruption, a keyed HMAC and per-machine
signatures resist a real adversary, and an optional external anchor
proves *when* the head existed (see
[Integrity model](#integrity-model)). Humans drive through the
terminal and verify through the history. Mnema does not run agents — it
makes their work accountable.

> **Not a semantic-memory layer.** Mnema does not do embeddings or
> similarity recall — if you want an agent to *remember facts* across
> sessions, reach for Mem0 or Cognee. Mnema answers a different
> question: *what did the agents do, who authorized it, and can you
> prove the record wasn't altered?* It pairs cleanly with a memory
> layer; it doesn't replace one.

## Why Mnema

When an AI agent works in your repository, three questions usually go
unanswered: *what exactly did it change, did it skip the steps it was
supposed to follow, and can you trust the record after the fact?*
Mnema answers all three.

- **It makes agent work provable.** Every mutation appends to a
  hash-chained audit log that is protected in depth: the chain catches
  accidental corruption, a keyed HMAC and per-machine Ed25519
  signatures make a *deliberate* rewrite detectable (not just a broken
  link an attacker could repair), and an optional external anchor
  timestamps the head. `mnema doctor` verifies all of it — edits,
  truncation, replays, deletion, and downgrade. This is the part most
  agent tooling doesn't have; the exact guarantees and their limits are
  spelled out in [Integrity model](#integrity-model).
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
| A task tracker with no cryptographic guarantee the log is intact | A keyed, signed audit chain that resists a deliberate rewrite, with `doctor` verification |
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

### See it in 30 seconds

Drive a task through the gates, `doctor` proves the audit chain, then a
hand-edit to a past log line is caught — every frame is real output:

<img src="docs/quickstart.gif" width="640" alt="Mnema demo — init, review, doctor proves the chain, a tamper is caught">


The same flow condensed, in case the animation doesn't play:

```console
$ mnema init --yes --name "Payments API" --key PAY
$ mnema task create --title "Add rate limiting"
$ mnema task move PAY-1 submit …   # drive it through the gates → approve → DONE
$ mnema doctor
  ✓ audit hash chain  verified

# now tamper: rewrite who did the work in a past audit line
$ mnema doctor
  ✗ audit hash chain  hash mismatch on a line in current.jsonl
```

<!-- The recording is docs/quickstart.cast (a real asciinema cast).
     Regenerate it with `node scripts/make-cast.mjs`, then re-render the GIF
     with `agg --speed 1.4 docs/quickstart.cast docs/quickstart.gif`. -->


## What you get

| Surface | What it does |
|---|---|
| **Audit log** | Every action appends to a hash-chained JSONL log (mirrored to SQLite), keyed with a per-project HMAC secret and periodically signed by a per-machine Ed25519 key, with optional external anchoring. `mnema doctor` detects edits, truncation, replays, deletion, and downgrade — see [Integrity model](#integrity-model). |
| **Workflow gates** | A state machine per task; each transition declares required fields and Mnema rejects invalid moves. |
| **Agent runs & plans** | Wrap every batch of mutations in a run (parent/child, max depth 5); inspect any run later via the CLI. |
| **Dual identity** | Each event records the human actor, the agent that executed, and the run — a built-in chain of custody. |
| **Tasks, sprints, epics** | Full work tracking: tasks with acceptance criteria, estimate, assignee, transversal **labels** (e.g. `area:api`) and a token `context_budget`; one active sprint per project (with measurable metrics); epics grouping tasks under a derived lifecycle. |
| **Decisions (ADRs)** | proposed → accepted/rejected → superseded chains, each able to record which artefacts it impacts, with a shortcut to promote a note into a decision. |
| **Traceability layer** | End-to-end: task↔task dependencies + readiness, a navigable **dependency graph** (cycles, ready/blocked frontier, critical path), epic/sprint coverage, acceptance-criteria evidence (commit refs verified against git), **file-collision** warnings, a walkable **provenance chain** (observation/note → decision → memory), wikilinks, and ADR impact queries. |
| **Queries & review flow** | An aggregate backlog query (by state/epic/sprint/label/date/text), a per-run diff of one session's changes, an **executive snapshot** (coverage + graph + inbox, Markdown/HTML), and an inbox surfacing review-SLA and per-state **WIP-limit** breaches and orphaned runs. |
| **Live dashboard & metrics** | `mnema serve` — a live, loopback-only **local dashboard** that streams each event as it lands (below). `mnema metrics` — a local adoption report, no telemetry. |
| **Full-text search & attachments** | Search across tasks, decisions, notes, skills, memories and observations (case/accent-insensitive); files attached to a task or decision, deduped by content hash. |
| **Skills, memories, observations** | Knowledge the agent records as it works (and humans curate), mirrored to `.md` so it travels with the repo. A skill can be **invocable** with **dynamic context** (read-only `mnema` output embedded when shown); a run-end **skill draft** is derived from the run's real trail; skills carry a **version diff** + rationale and a quality loop flags one that preceded rework. Memories **archive** when stale and carry a typed **contradicts/obsoletes** relation; both take an optional **scope** and merge user-level defaults read-only. |
| **Session orientation** | The agent opens knowing what's next: `context_bootstrap` returns a `next_action`, `agent_run_resume` reconstructs focus after a dropped session, and a re-pullable `focus` answers "what am I on right now". |
| **On-rails signals** | Tied to the model without blocking the hot path: `mnema drift` flags branch commits with no task, a lint flags terminal tasks with no evidence, `mnema guard` is a soft PreToolUse gate, task free-text rejects tool-invocation markup, and transitions are idempotent (a repeat is a safe no-op). |
| **Native git link (opt-in)** | `mnema watch --git` observes the repo **read-only** and links the in-progress task to its branch/commits (`branch`/`commits`/`pr` on the task). Off by default; never writes `.git`. |
| **Slash commands & workflows** | Reusable `mnema`-call flows versioned under `.mnema/commands/*.md` (e.g. `/standup`); 4 workflow presets plus custom JSON, with enforcement severity resolvable per gate field. Seed skills/commands/templates are planted at `init`. |
| **MCP tools** | Universal tools plus one per workflow action, entered via `context_bootstrap`. Every tool carries **risk annotations** (`readOnlyHint` / `destructiveHint` / …) in `tools/list` so a client judges blast radius before calling — see [docs/mcp-tools.md](docs/mcp-tools.md). |

## Integrity model

"Tamper-evident" is a claim that deserves to be precise. The protection
is layered — each catches what the one below it can't — and `mnema
doctor` verifies layers 1–2 offline on every run:

- **Layer 1 — hash chain (always on).** Each event carries the prior
  event's hash, so accidental corruption, reordering, and truncation
  break the links. A plain chain alone is *not* proof against a
  deliberate attacker, who could recompute every hash downstream — that
  is what the next layer closes.
- **Layer 2 — authenticity (keyed HMAC + machine signatures).** Two
  secrets an in-repo attacker doesn't have, both `0600` **outside the
  repo**: a **per-project HMAC key** (only its fingerprint is committed)
  so recomputing the chain needs the secret, not just the algorithm; and
  **per-machine Ed25519 signatures** on the chain head at each checkpoint
  (the `.pub` is committed so any clone verifies, and a signed checkpoint
  pins the length against rollback). A **content attestation** (opt-in,
  committed `.att` files) additionally lets *anyone* — a public clone
  with no secret — recompute the covered root and check the signature;
  `mnema audit verify` **never shows green beyond the last attestation**,
  so an unattested tail is never mistaken for verified.
- **Layer 3 — temporal anchoring (opt-in, default `none`).** A pluggable
  provider (`git-signed`, `rfc3161`) stamps the signed head into external,
  independently verifiable history, off the write path and fail-open —
  proving the head existed at a point in time.

| Attack | Caught by |
|---|---|
| Editing a past event | Layer 1 + Layer 2 (HMAC) |
| Editing an event, checked by someone *without* the secret | Content attestation (when `.att` is committed) |
| Recomputing hashes to hide an edit | Layer 2 — no HMAC secret, recomputed chain fails |
| Deleting or reordering events | Layer 1 |
| Rolling the log back below a signed checkpoint | Layer 2 signatures |
| Downgrading the keyed chain to the unkeyed format | Version monotonicity + fingerprint-implies-v3 |
| Backdating a forged history | Layer 3 anchor (when enabled) |

Defeating all of it requires compromising the machine's out-of-repo
keys — and even then an enabled anchor leaves a trace. The honest edges
(a fully compromised host, truncating the not-yet-attested tail, a
dishonest coordinator — it's a chain of custody, not a policy engine)
and the full per-layer detail are in the
**[integrity model](https://felipesauer.github.io/mnema/integrity)**
([docs/integrity.md](docs/integrity.md)).

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

## Project layout & what to commit

`mnema init` writes an `AGENTS.md`, a pre-seeded `.gitignore` /
`.gitattributes`, and a `.mnema/` directory holding everything Mnema owns
— the versioned markdown mirror (`backlog/`, `roadmap/`, `sprints/`,
`memory/`, `skills/`) and `audit/` log, the committed **public**
verification material in `keys/` (fingerprint + `.pub`, never a secret),
and a gitignored local `state/` cache rebuilt by `mnema sync`.

The short version of what goes in git: **commit** the mirror, the log,
`mnema.config.json`, `workflows/` and `keys/`; **ignore** `state/` and
`config.local.json` (both derived/local — `init` pre-seeds those
`.gitignore` lines); and the integrity **secrets** live outside the repo
under `~/.config/mnema/` (`0600`), never in `.mnema/`. The mirror changes
on every mutation — that churn is the trail, not noise — so `mnema
commit` makes **two commits** (the `.mnema/` trail first, then whatever
you staged) to keep it out of your code diffs, and a `union` merge driver
keeps two branches' audit tails from conflicting.

→ The full tree, the dirty-tree rationale, and log rotation are in
**[Project layout](https://felipesauer.github.io/mnema/project-layout)**
([docs/project-layout.md](docs/project-layout.md)).

## Common CLI commands

You drive Mnema from the terminal; agents drive the same model through
MCP tools. These are the ones you reach for daily — run
`mnema <command> --help` for flags, and see the
**[full command reference](https://felipesauer.github.io/mnema/cli)**
([docs/cli.md](docs/cli.md)) for every command grouped by task.

| Command | What it does |
|---|---|
| `mnema init` | Create the layout (`--minimal` to adopt, `--profile audit-only` for the core surface) |
| `mnema focus` | The one task to resume or start next — re-pullable any time in a session |
| `mnema task create / list / show / move` | Manage tasks (`create` takes `--estimate`, `--priority`, `--label`) |
| `mnema guard` | Exit 0 iff your assigned task is in progress — wire into a `PreToolUse` hook |
| `mnema drift` | Commits on this branch tied to no task — the "is this work tracked?" signal |
| `mnema graph [--epic\|--sprint]` | Dependency graph: cycles, ready/blocked frontier, critical path |
| `mnema search <query>` | Full-text across tasks, decisions, notes, skills, memories, observations |
| `mnema doctor` | Read-only diagnostic — re-verifies the chain + attestation offline |
| `mnema audit verify [--verify-anchors]` | Verify the chain + attestation (and layer-3 anchors) |
| `mnema inbox` | Tasks awaiting your review or blocked, plus review-SLA breaches |
| `mnema serve` | Live local dashboard on `localhost`, read-only, loopback-only (below) |
| `mnema stats [--since]` | Flow metrics from the log (throughput, lead/cycle time, reopen, velocity) |
| `mnema commit -m "…"` | Commit the `.mnema/` trail and your code as two separate commits (trail first) |
| `mnema sync` | Rebuild the SQLite cache from the markdowns |
| `mnema upgrade` | Detect everything out of date, show the plan, apply after confirmation |

### Live dashboard

`mnema serve` opens a dark single-page dashboard on `localhost` and
updates live as each audit event lands — so you watch the project move
as agents (or you) work, without refreshing:

```bash
mnema serve            # → http://127.0.0.1:4700, opens your browser
```

The rail groups the views into modules, with the chain-integrity verdict
always in view:

- **Overview** — the chain verdict, the human-attention queues, throughput
  and reopen rate, and a live activity timeline.
- **Work** — Needs-you (review/blocked/decisions), a Board by state, epics &
  sprints with coverage, and the dependency graph (pan/zoom, connected
  subgraph + critical path).
- **Flow** — throughput, lead/cycle time, reopen, velocity, events by kind.
- **Integrity** — the navigable audit trail (hash-linked events) + chain
  verification, and drift (commits with no task).
- **Knowledge / Agents** — decisions, skills & memory (with the rework
  quality flag), and orphaned agent runs.

Plus global search (`⌘K`), click-through drill-down, and interactive
filters. It is strictly read-only and derives everything from what's
already recorded — no new collection. The server binds the loopback
interface only and the bundle is self-contained (no external request, no
CDN), so **nothing leaves your machine**. It receives events from *any*
process (an agent over MCP, a CLI mutation) by watching the trail.

## How the MCP loop works

```mermaid
graph TD
    H["Human<br/>drives via terminal"] -->|"approves via terminal"| G
    A["AI agent<br/>typed tool calls"] --> G["Workflow gate<br/>rejects invalid moves"]
    G -->|"stamps who + which agent + run"| E["Audit event<br/>dual-identity"]
    E -->|"prev_hash + keyed HMAC"| C["Signed chain<br/>keyed + attested"]
    C --> M["Markdown mirror<br/>source of truth"]
    M -->|"mnema sync rebuilds"| S[("SQLite cache")]
    M --> R["Git<br/>trail travels with repo"]
    C -.->|"mnema doctor"| V(["Verify chain + attestation"])
    classDef climax fill:#1f2937,stroke:#f59e0b,stroke-width:2px,color:#fff;
    class E,C climax;
```

*The diagram is the accountability spine — where every action ends up.*
The agent's lifecycle that feeds it, in short: your client spawns `mnema
mcp serve` (configure once with `mnema mcp install-instructions
claude-code`); the agent calls **`context_bootstrap`** first to open
oriented, with a `next_action` telling it what to do now; **`agent_run_start`**
opens a run before any mutation (they're rejected with `NO_ACTIVE_RUN`
otherwise, and `agent_run_resume` reconstructs focus after a dropped
session); it then drives the workflow through gated, idempotent
transitions (`task_submit`, `task_block`, …), optionally reserving a task
with a self-expiring `task_claim` when sessions share a backlog; and
**`agent_run_end`** closes the run and offers a skill draft from what it
did. The full contract — the three moments, the exit-code/JSON convention,
and the advises-not-enforces boundary — is in
[docs/client-integration.md](docs/client-integration.md).

### A concrete pass

An agent asked to "add a rate limiter" might: start a run, create
`MYAPP-12`, submit it through the gate (which forces acceptance
criteria and an estimate), move it to `IN_PROGRESS`, do the work,
then submit it for review. It cannot mark its own task `DONE` — the
`default` workflow routes that through your approval. Meanwhile you
watch and inspect from the terminal:

```bash
mnema watch                        # live tail of every mutation (--git also links the task)
mnema focus                        # one-line "what's active" — resume this, or start that
mnema drift                        # commits on this branch not tied to any task
mnema inbox                        # what's waiting on your review
mnema history --since=today        # formatted activity log
mnema agent inspect <run_id>       # one run, with its plans + mutations
mnema agent resume <run_id>        # reattach to an interrupted run
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
  "mnema_version": ">=0.1.0-beta.0 <1.0.0",
  "project": { "key": "MYAPP", "name": "My Application" },
  "workflow": "default"
}
```

Optional fields cover custom paths, audit retention, sync flush
thresholds, feature flags, an `aging` block — `stale_after_days`,
per-state review SLAs (`sla_days`, e.g. `{ "IN_REVIEW": 2 }`), and
`orphan_run_after_hours` — that drives what `mnema inbox` and
`mnema doctor` flag, and a `claims` block (`lease_minutes`, default 30)
that sets how long a `task_claim` reservation lasts before it
self-expires. Run `mnema doctor` after editing — it re-validates
the file against the schema and reports anything that drifted.

Every key — type, default, and why it exists — is documented in
[docs/configuration.md](docs/configuration.md).

One field worth calling out here is `enforcement_mode`, which decides
what a failed workflow gate means:

| Mode | A failed gate… |
|---|---|
| `strict` *(default)* | blocks an agent; a human may override, and the override is audited |
| `blocking` | blocks everyone, no override |
| `advisory` | only warns — anyone may proceed, and the skipped gate is audited |

`mnema doctor` prints the active mode so its effect is never a surprise.

Everything else — checkpoint & anchoring, the user/local behaviour
overrides, `--profile audit-only` and the MCP tool-group layers,
approval-gated domain-event hooks, and the `sync` / `features` / `aging`
/ `archive` / `claims` / `github` / `git` blocks — is documented key by
key in the
**[Configuration reference](https://felipesauer.github.io/mnema/configuration)**
([docs/configuration.md](docs/configuration.md)).

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

Mnema is **alpha** and published on npm. The accountability core — the
hash chain, its keyed-HMAC and per-machine-signature layers, `doctor`
tamper-detection, dual-identity capture, workflow gates, and
optimistic-concurrency lost-write protection — is in place and hardened;
the work-tracking and traceability surface around it is built out. The
remaining road to a stable `1.0` is hardening and ergonomics, not
missing pillars. On top sits an active-copilot layer (`next_action`,
`focus`, resume, `drift`, `guard`, evidence lint, an opt-in git observer,
in-the-flow knowledge capture) that makes the ledger guide the agent, not
just record it.

Confidence comes from how hard it's shaken out: a **comprehensive test
suite (1600+ tests, lint + build clean)**, repeated adversarial review
sweeps (audit immutability, multi-actor concurrency, custom-workflow
validation, ReDoS, command/path-injection) plus two refute-first audits
of the cryptographic layers — canonicalisation proven byte-stable by
fuzzing and an attack matrix run through the built binary — and a
multi-check publish gate
([scripts/publish-check.sh](scripts/publish-check.sh)) with an
end-to-end smoke run before every tag. See
[CHANGELOG.md](CHANGELOG.md) for the per-version history.

## Getting help

- **Bug or unexpected behaviour?** Open an issue — the bug-report
  template asks for `mnema --version`, repro steps, and (if relevant)
  a snippet of `.mnema/audit/current.jsonl`.
- **Question or idea?** Use [GitHub Discussions](https://github.com/felipesauer/mnema/discussions).
- **Security issue?** Report it privately — see [SECURITY.md](SECURITY.md).
- **Want to contribute?** Start with [CONTRIBUTING.md](CONTRIBUTING.md).

## Further reading

The full docs live at
**[felipesauer.github.io/mnema](https://felipesauer.github.io/mnema/)**
(mirrored in-repo under [docs/](docs/)):

- **[Integrity model](https://felipesauer.github.io/mnema/integrity)** —
  the three layers, the threat model, and the honest edges.
- **[Client integration](https://felipesauer.github.io/mnema/client-integration)**
  — wiring an agent: bootstrap → focus → guard, and the
  advises-not-enforces boundary. **[Guard](https://felipesauer.github.io/mnema/guard)**
  covers the `PreToolUse` recipe.
- **[CLI](https://felipesauer.github.io/mnema/cli)** &
  **[Configuration](https://felipesauer.github.io/mnema/configuration)**
  — every command and config key.
- **[MCP tools](https://felipesauer.github.io/mnema/mcp-tools)** — the
  tool risk vocabulary.
- **[CHANGELOG.md](CHANGELOG.md)** — per-version history.
  **[CONTRIBUTING.md](CONTRIBUTING.md)** — dev setup and what to watch
  when touching the schema, audit log, or workflow.

`mnema init` also writes an `AGENTS.md` into your project — the
operating manual a fresh AI agent reads on session start so it knows
how to drive Mnema responsibly. It lives in your repo, not this one.

## License

[MIT](LICENSE) © Felipe Sauer
