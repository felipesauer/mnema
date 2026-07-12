# Configuration reference

Every key in `.mnema/mnema.config.json`, with its type, default, and why it
exists. The file is created by `mnema init`; only `version`, `mnema_version`
and `project` are required — every other block has a sensible default, so a
minimal config is enough to bootstrap. Run `mnema doctor` after editing: it
re-validates the file against the schema and reports anything that drifted.

Two other files can override behaviour (never project identity): a user-level
`~/.config/mnema/config.json` and a per-repo `.mnema/config.local.json`. Both
carry only the behaviour blocks (`audit_strategy`, `enforcement_mode`, `sync`,
`features`, `aging`, `claims`, `github`) and are deep-merged on top of the
project config, key by key.

> **Zero telemetry.** Nothing here phones home. The only outbound request
> Mnema ever makes is the opt-in `features.update_check` (default off). An
> unhandled crash is recorded to a **local** `.mnema/state/errors.jsonl`
> (gitignored, never transmitted) so a bug report can be assembled from it —
> it stays on your machine until you choose to share a sanitised copy.

---

## Top level

| Key | Type | Default | Why |
|---|---|---|---|
| `version` | `"1.0"` | required | Config schema version. Only `1.0` is accepted. |
| `mnema_version` | semver range | required | The Mnema version range this project expects; `mnema doctor` warns on a mismatch. |
| `workflow` | string | `"default"` | Which workflow preset drives task states/gates (`default`, `jira-classic`, `kanban`, `lean`, or a custom file under `paths.workflows`). |
| `mode` | `"single"` | `"single"` | Reserved for a future multi-project layout. Only `single` is accepted, so you can't quietly set a value that does nothing. |
| `audit_strategy` | `"full" \| "recent" \| "local"` | `"recent"` | How much audit history is kept hot vs. archived. |
| `audit_retention_months` | positive int | `12` | How many months of audit history to retain — one year balances a useful trail against unbounded growth. |

## `project`

| Key | Type | Default | Why |
|---|---|---|---|
| `project.key` | `/^[A-Z][A-Z0-9]{1,9}$/` | required | Short uppercase prefix for task keys (e.g. `WEBAPP` gives `WEBAPP-42`). |
| `project.name` | non-empty string | required | Human-readable project name. |
| `project.description` | string | optional | Optional one-line description. |

## `paths`

Every Mnema-managed directory, resolved relative to the project root. The
defaults put everything under `.mnema/` so `mnema init` doesn't pollute the
project root with eight top-level entries. Override individual entries if you
want a different layout (e.g. a visible `backlog/` for GitHub). Absolute paths
and `..` segments are rejected — a cloned repo's config shouldn't be able to
steer writes outside the project.

| Key | Type | Default | Why |
|---|---|---|---|
| `paths.state` | rel. path | `.mnema/state` | SQLite cache + local state (gitignored; rebuilt from markdown). |
| `paths.audit` | rel. path | `.mnema/audit` | Hash-chained audit log (JSONL) — the canonical trail. |
| `paths.backlog` | rel. path | `.mnema/backlog` | Task markdown, by state. |
| `paths.sprints` | rel. path | `.mnema/sprints` | Sprint markdown. |
| `paths.roadmap` | rel. path | `.mnema/roadmap` | Epics and decisions (ADRs) markdown. |
| `paths.memory` | rel. path | `.mnema/memory` | Memories markdown. |
| `paths.skills` | rel. path | `.mnema/skills` | Skills markdown. |
| `paths.commands` | rel. path | `.mnema/commands` | Custom command definitions. |
| `paths.workflows` | rel. path | `.mnema/workflows` | Workflow preset JSON files. |

## `audit.checkpoint`

Machine attestation (integrity layer 2): the chain head is signed with the
per-machine Ed25519 key at a checkpoint interval — **not** every event, to
spare the write hot path and cold-start. A checkpoint fires when *either*
bound is reached, whichever comes first.

| Key | Type | Default | Why |
|---|---|---|---|
| `audit.checkpoint.events` | positive int | `100` | Sign the head after this many new events accrue. |
| `audit.checkpoint.seconds` | positive int | `3600` | …or after this many seconds elapse — an hour caps how long an unsigned tail can sit. |

## `audit.anchor`

Temporal anchoring (integrity layer 3): pluggable, **opt-in**, default `none`.
A real provider stamps the signed head into an external, independently
verifiable timestamp — off the write path, fail-open (a slow or failed anchor
never blocks or fails an audit write).

| Key | Type | Default | Why |
|---|---|---|---|
| `audit.anchor.provider` | `"none" \| "git-signed" \| "opentimestamps" \| "rfc3161"` | `"none"` | Which anchor backend to use; `none` disables anchoring. |
| `audit.anchor.interval.events` | positive int | optional | Anchor after this many events; falls back to the checkpoint interval when unset. |
| `audit.anchor.interval.seconds` | positive int | optional | …or after this many seconds. |
| `audit.anchor.tsa` | `https://` URL | optional | Time-Stamp Authority endpoint. **Required** when `provider` is `rfc3161`. Locked to `https://` to avoid an SSRF/local-file vector, since the repo config is agent-writable. |
| `audit.anchor.remote` | non-empty string | optional | `git-signed`: remote to push the anchor commit to (local-only when omitted). |
| `audit.anchor.ref` | non-empty string | optional | `git-signed`: ref to push the anchor commit to. |

## `enforcement_mode`

| Key | Type | Default | Why |
|---|---|---|---|
| `enforcement_mode` | `"advisory" \| "strict" \| "blocking"` | `"strict"` | How a failed workflow gate is enforced. `strict` (default) holds **agents** to the gate while letting a **human** override — it preserves the protection that matters without locking humans out. `blocking` blocks everyone; `advisory` only warns. |

## `sync`

How mutations are flushed from the in-session buffer to the markdown mirror.

| Key | Type | Default | Why |
|---|---|---|---|
| `sync.mode` | `"hybrid" \| "push" \| "buffer"` | `"hybrid"` | Flush strategy; `hybrid` balances immediacy against write batching. |
| `sync.agent_buffer_flush_seconds` | positive int | `30` | Flush the agent buffer after this many seconds — short enough that a dropped session loses little, long enough to batch a burst of mutations. |
| `sync.agent_buffer_flush_count` | positive int | `50` | …or after this many buffered mutations, whichever comes first. |
| `sync.agent_buffer_flush_on_plan_complete` | boolean | `true` | Also flush when an agent plan completes, so a finished step lands on disk promptly. |

## `features`

| Key | Type | Default | Why |
|---|---|---|---|
| `features.fts_search` | boolean | `true` | Full-text search across tasks/decisions/skills/memories/observations. |
| `features.attachments` | boolean | `true` | Evidence attachments on tasks. |
| `features.knowledge` | boolean | `true` | Gates the knowledge surface (decisions/skills/memories/observations + provenance) as MCP tools. Off in the audit-only profile; the stores still work if re-enabled — this only controls what the agent sees. |
| `features.update_check` | boolean | `false` | Opt-in npm update check. **Off by default**: Mnema is offline / zero-telemetry, and a registry check is an outbound request. No usage data is ever transmitted. |

## `aging`

Surfaces tasks that have sat in a non-terminal state too long — the IN_REVIEW
limbo where a transition waits on a human that never comes. `mnema inbox` and
`context_bootstrap` report these on session start.

| Key | Type | Default | Why |
|---|---|---|---|
| `aging.stale_after_days` | positive int | `3` | Global fallback: a non-terminal task older than this is stale. |
| `aging.orphan_run_after_hours` | positive int | `24` | A run that started and never ended past this is treated as orphaned; `mnema doctor` surfaces it and `mnema agent close-orphans` can abort it. |
| `aging.sla_days` | record<state, positive int> | `{}` | Per-state review SLA in days (e.g. `{ "IN_REVIEW": 2 }`); a state without an entry falls back to `stale_after_days`. |
| `aging.wip_limits` | record<state, positive int> | `{}` | Per-state work-in-progress limit; a state over its limit is a WIP breach. A state without an entry is uncapped. |

## `claims`

| Key | Type | Default | Why |
|---|---|---|---|
| `claims.lease_minutes` | positive int | `30` | How long a `task_claim` reservation lasts before it self-expires. A claim reserves a task before work starts (closing the race two sessions hit reading the same READY task); the lease expires on its own so a session that dies without releasing never holds a task forever — the same self-healing `aging.orphan_run_after_hours` gives runs. |

## `github`

| Key | Type | Default | Why |
|---|---|---|---|
| `github.done_pr_policy` | `"off" \| "warn" \| "block"` | `"off"` | On a terminal transition carrying a `pr_url`, decides what to do if that PR isn't merged or CI is red. `off`: never check (zero network). `warn`: check and attach a warning but allow the move. `block`: refuse with `PR_NOT_READY`. Unreachable GitHub never blocks — a status that can't be resolved is treated as "can't prove a problem". |

## `hooks`

> These are Mnema's **internal domain-event hooks** — they fire *after* an
> audit event commits. They are **not** the client-side `PreToolUse` hook
> that gates an edit; for that, and for the full client contract, see
> [client-integration.md](client-integration.md).

Run a command when a curated domain event fires. Each key is a domain-event
name; the value is the ordered list of hooks to run. A hook is an argv pair —
`{ command, args }` — spawned **without a shell**, so shell metacharacters
(`$(…)`, `|`, `;`, `&&`) are inert data, never interpreted. The audit event is
delivered as JSON on the command's stdin, and each firing writes its own
`hook_ran` audit event — a hook is part of the trail, never a phantom side
effect. Defaults to no hooks.

Because this file lives in the repo and is writable by the very agents Mnema
keeps accountable, a configured hook block is **inert until a human approves it**
with `mnema hooks approve`; editing the block afterwards revokes the approval.
This closes the agent-writable-config command-execution vector.

| Key | Type | Default | Why |
|---|---|---|---|
| `hooks.on_task_done` | array of `{command, args}` | `[]` | Fires when a task reaches a terminal (done) state. |
| `hooks.on_task_transitioned` | array of `{command, args}` | `[]` | Fires on any task state change. |
| `hooks.on_decision_accepted` | array of `{command, args}` | `[]` | Fires when a decision moves to `accepted`. |
| `hooks.on_sprint_closed` | array of `{command, args}` | `[]` | Fires when a sprint is closed. |
| `hooks.on_epic_closed` | array of `{command, args}` | `[]` | Fires when an epic is closed. |

Each hook entry: `command` (non-empty string, the executable) and `args`
(array of strings, passed verbatim as separate argv entries — a value like
`$(id -un)` is a literal string, never expanded).
