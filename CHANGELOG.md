# Changelog

All notable changes are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
version scheme follows [Semantic Versioning](https://semver.org/).

This project is in alpha — releases are tagged `vX.Y.Z-alpha.N` until
the surface stabilises. The `-alpha.N` suffix is dropped on the first
stable release.

## [Unreleased]

### Added (medium-severity sweep)

- **`mnema attach add | list` now accepts decision keys.** Keys matching
  `<PROJECT>-ADR-<N>` route to `AttachmentService.attachToDecision` /
  `listForDecision`; everything else stays on the task path. Closes
  F-F7 — the service layer already supported decisions; only the CLI
  was constrained to tasks.
- **`mnema import markdown --skip-existing`.** Re-running the importer
  is now idempotent on demand: parsed headings whose exact title is
  already an active task in the project are counted in
  `skipped_existing` instead of created. Default behaviour is
  unchanged (re-running still duplicates) — the flag is opt-in so
  long-running adoption flows can re-run safely. Closes F-F6.
- **`mnema audit query --task-key <key>`.** Exposes the existing
  `AuditQueryFilter.taskKey` filter at the CLI surface. Matches
  against `data.key` (task / decision events) and `data.task_key`
  (note / attachment events) — covers tasks and decisions without
  a second flag. Closes F-E8.

### Changed (medium-severity sweep)

- **`mnema import markdown --help` documents the state-blind contract.**
  Headings like `## DRAFT Fix login` are taken at face value (title:
  `DRAFT Fix login`). Honouring the prefix would require running the
  workflow gate against payload the markdown does not carry, so
  imported tasks always land in the workflow's initial state. The
  trade-off is now stated up front so agents don't expect the prefix
  to be stripped. Closes F-F5.

### Fixed (workflow-as-data sweep)

- **`mnema task list --state X` now validates `X` against the active
  workflow.** Previously the CLI accepted any string and silently
  returned zero hits when the value did not match a workflow state
  (`mnema task list --state DRAFT` on a `lean` project — which uses
  `TODO | DOING | DONE` — returned `(no tasks)` instead of an error).
  The command now exits with the new `INVALID_WORKFLOW_STATE` error
  listing the workflow name and the allowed states. MCP `tasks_list`
  was already deriving its zod enum from `stateMachine.getWorkflow()`;
  this closes the same gap on the CLI surface.

### Fixed (Phase F)

- **Declared transitions out of terminal states are now honoured.**
  `TaskService.transition` previously short-circuited any task in a
  state listed under `workflow.terminal[]` with `TERMINAL_STATE`,
  even when the workflow JSON declared an exit transition (e.g.
  `default.json` and `jira-classic.json` both declare
  `DONE.reopen → IN_PROGRESS` / `CLOSED.reopen → REOPENED`). The
  guard now only fires when there is truly no outbound transition
  from the state.
- **`reopen_count` is incremented on every `reopen` action.**
  The column existed but was never updated. The CLI `task show` now
  renders `reopened: Nx` in the meta line when the counter is > 0.
- **Attachment dedup is now full.** `AttachmentService.attachToTask`
  and `attachToDecision` collapse the metadata row when the same
  content hash is already attached to the same parent. The audit
  event still fires (so intent is logged) with `deduplicated: true`.
  Previously only the binary on disk was deduped; the row duplicated.
- **`attachments.path` stores just the filename**, not the
  hardcoded `.app/attachments/<filename>` prefix. Lets a project move
  its `.mnema/` directory without breaking attachment lookups; the
  consumer joins the bare filename with the configured state dir.

### Added (Phase E follow-ups)

- **`features.sprints` and `features.epics` are now enforced.**
  `SprintService.plan` refuses with the new `FEATURE_NOT_AVAILABLE`
  error when the active workflow declares `features.sprints: false`
  (e.g. `kanban`, `lean`); `EpicService.create` does the same for
  `features.epics`. Previously the flags were declarative metadata
  that the services ignored.
- **CLI `--expected-updated-at` flag on `decision accept | reject |
  supersede` and `sprint start | close`.** Brings the CLI surface up
  to parity with the service / MCP path delivered in Camada-3:
  passing the token rejects the transition with `CONFLICT` when the
  stored `updatedAt` differs. Useful for scripts that race or for
  read-decide-write flows that need to detect concurrent edits.

### Changed (Phase E follow-ups)

- **Mutation services wrap `SqliteError` into structured errors.**
  New `src/storage/sqlite/sqlite-error-map.ts` exposes a `tryMutation`
  helper that maps `SQLITE_BUSY` / `database is locked` to
  `ErrorCode.StorageBusy`. Applied to `TaskService.create` /
  `transition`, `SprintService.plan`, `NoteService.add`. Wider
  coverage to follow as the surface grows. Completes the F-E4
  partial fix from 2026-05-12.

### Fixed (Phase E)

- **F-E1: FTS query errors no longer leak SQLite stack-traces.**
  `SearchService.search` now returns `Result<SearchHit[], MnemaError>`
  with two new error variants: `SEARCH_INVALID_QUERY` (FTS5 syntax
  errors — unbalanced quotes, reserved characters used outside MATCH
  syntax) and `STORAGE_BUSY` (concurrent mutation conflict). The CLI
  renders both with a one-line hint instead of crashing. The MCP
  `tasks_search` tool returns the structured error.
- **F-E2: `mnema doctor` now detects orphan mirror files** (`.md`
  files in `paths.skills` / `paths.memory` whose slug has no matching
  SQLite row). New flag `--prune-orphans` (combined with
  `--rebuild-mirrors`) deletes them. Without `--prune-orphans` the
  orphans are reported but preserved (safe default — humans may be
  editing files locally). Filters `INDEX.md` and dotfiles.
- **F-E7: `mnema decision show --json`** parity with `task show` /
  `sprint show`.
- **Error printer fills in `SkillNotFound` / `MemoryNotFound`** which
  were tracked as errors since 0.3.0-alpha.0 but had no rendering.

### Added

- **Optimistic concurrency for decisions and sprints.** Migration 010
  adds `updated_at` to both tables (back-filled from `at` /
  `created_at` for existing rows). `DecisionService.transition` and
  `SprintService.start` / `close` now accept an optional
  `expectedUpdatedAt` token and return a `Conflict` error
  (`ErrorCode.Conflict`) with the latest server-side timestamp when
  stale. Brings the two paths up to parity with `task transition`,
  which already had the guard. Agent runs intentionally left alone —
  single owner per run, no race in practice. Tracked from
  `docs/TECH_DEBT.md` §3.

### Added

- **FTS5 search across skills, memories and observations.** Migration
  009 adds `skills_fts`, `memories_fts` and `observations_fts` virtual
  tables with insert/update/delete triggers. `tasks_search` (MCP tool)
  and `SearchService` (CLI) now accept `skill | memory | observation`
  as `entities` filter values; skill hits surface the latest version
  per slug. Diacritic-insensitive `unicode61` tokenizer, same as the
  pre-existing FTS tables.
- **`mnema doctor --rebuild-mirrors`.** Recreates missing `.md`
  files under `paths.skills` and `paths.memory` from the corresponding
  SQLite rows. Existing mirror files are left alone — no reformat, no
  overwrite. Reports the slugs it rebuilt. Pairs with the `no_op`
  self-heal added in 0.3.0-alpha.1 (F-8): the inline path recovers a
  missing mirror when the agent re-runs `*_record`; this flag covers
  the case where no one ever re-records that slug.
- **MCP server warns loudly on boot when migrations are pending.** A
  pino `warn` line listing the pending files lands on stderr right
  before "MCP server connected". Tool calls that touch the affected
  shape will still fail with `SCHEMA_OUT_OF_DATE` (F-1 guard from
  0.3.0-alpha.1), but the boot warning surfaces the cause before the
  first client request.

### Fixed

- **`tasks_list({ state })` derives its enum from the active workflow.**
  Previously the MCP tool advertised `DRAFT | READY | IN_PROGRESS |
  BLOCKED | IN_REVIEW | DONE | CANCELED` regardless of the workflow in
  use, so projects on `lean` (`TODO | DOING | DONE`) could not filter
  by state at all. The schema is now built from
  `stateMachine.getWorkflow().states` at boot, with the valid values
  listed in the description. Discovered during the Phase C inspection.
- **`context_bootstrap` statistics respect workflow features.**
  `blocked` is `0` when the workflow does not declare `blockedState`
  (e.g. `lean`); `in_progress` resolves to whichever of `IN_PROGRESS` /
  `DOING` the workflow actually uses. `by_state` already covered every
  state, but the convenience counters had hardcoded literals.
- **`InboxService` queues respect workflow features.** `awaitingReview`
  is empty on workflows without `reviewWorkflow`; `blocked` is empty
  on workflows without `blockedState`. Previously both queues silently
  used the default-workflow state names regardless.

### Changed

- `TaskRepository.findByState` / `updateState` / `TaskInsertInput.state`
  and `ListTasksFilter.state` accept any string (was the narrow
  `TaskState` enum). Aligns the types with the "workflow as data"
  premise — the SQLite column already stored arbitrary state names.

## [0.3.0-alpha.1] — 2026-05-11

Friction sweep after Phase C real-world test (`evaluations/2026-05-11-phase-c.md`).
A sub-agent (dev5) plus the PO exercised every new tool from
0.3.0-alpha.0 against the Mnema repo itself and surfaced 8 friction
points. This release fixes the 6 actionable ones (F-1, F-2, F-4, F-5,
F-7, F-8); F-3 and F-6 are tracked as documentation follow-ups.

### Fixed

- **F-1 — Drift guard on new tools.** All 9 skill/memory/observation
  MCP tools now check `pendingMigrations` first and respond with a
  structured `SCHEMA_OUT_OF_DATE` error instead of leaking raw
  `no such table` SQLite messages when the DB is behind disk.
  Implemented via `requireFreshSchema(pending)` in `mcp-tool-result.ts`
  and a new `pendingMigrations` constructor arg on the three
  registrars. Discovered when upgrading the global binary from 0.1.0
  to 0.3.0 without running `mnema migrate` first.
- **F-2 — `no_op` no longer advances `updated_at`.** `MemoryService.record`
  and `SkillService.record` now skip the SQL UPDATE entirely when the
  service detects byte-equal content. The DB row, the mirror file and
  the audit event all stay consistent: timestamps reflect actual
  content changes, no_op is observable in audit but invisible to
  consumers that filter on `updated_at`.
- **F-4 — `skill_use` payload omits content.** The MCP handler now
  projects the response to `{ slug, version, usage_count, last_used_at }`
  matching the docstring promise. Saves tokens, fixes the inconsistency
  with the description.
- **F-5 — Bootstrap observations include `id` and `related_task_key`.**
  `context_bootstrap.recent_observations` now exposes the canonical id
  plus the human-readable task key (when linked), so agents can act on
  the listed observations without a follow-up `observations_list` call.
- **F-7 — Doctor severity.** `DoctorCheck` gains an optional
  `severity: 'error' | 'warning'` field. The renderer shows `⚠` for
  warnings (yellow) versus `✗` for errors (red), and the exit code
  only fails on errors. Mirror-drift checks (`skills mirrored`,
  `memories mirrored`) now flag missing files as `warning` so they
  stand out without failing the diagnostic.
- **F-8 — Mirror self-heals on no_op.** When `record` returns `no_op`
  but the mirror file is missing on disk, the service rewrites the
  file. This makes SQLite the source of truth: deleting a `.md` mirror
  by hand is recoverable by re-asserting the same content. Pairs with
  F-2 — the DB row stays untouched, only the mirror is restored.

### Internal

- 372 tests across 54 suites (was 357). Coverage added: `no_op` does
  not advance `updated_at` (memory + skill), `no_op` self-heals
  mirror, doctor mirror-drift warning shape, bootstrap observations
  shape with task linkage, `requireFreshSchema` unit tests.

## [0.3.0-alpha.0] — 2026-05-11

Third public alpha. Agents now record their own **skills**, **memories**
and **observations** through dedicated MCP tools, so the `.mnema/skills/`
and `.mnema/memory/` directories — previously human-only — become a
two-way channel. Skills are versioned, memories upsert by slug, and
observations are append-only. `context_bootstrap` surfaces enxuto
inventories of each so agents discover them at session start without
loading the bodies.

### Added

- **`skills` table** (migration 008): one row per `(slug, version)`,
  versioned history, with `usage_count` and `last_used_at` so frequently
  applied skills float to the top of `skills_list`.
- **`memories` table** (migration 008): upsert by `slug`, no version
  history (memory is the current truth).
- **`observations` table** (migration 008): append-only, optional
  `related_task_id`, optional `topics`.
- **9 new MCP tools**:
  - `skill_record` (with `mode: 'update' | 'new_version'`), `skill_show`,
    `skill_use`, `skills_list`.
  - `memory_record`, `memory_show`, `memories_list`.
  - `observation_record`, `observations_list`.
  All mutating tools require an active agent run; reads do not.
- **`context_bootstrap` inventories**: `skills_inventory` (top 20 by
  usage), `memories_inventory` (top 30 by recency), `recent_observations`
  (last 5). Bodies omitted — agents pull via `*_show`.
- **`.md` mirror writes**: `skill_record` and `memory_record` write
  `.mnema/skills/<slug>.md` / `.mnema/memory/<slug>.md` atomically
  (temp file + rename). Frontmatter is generated by the service.
- **`mnema {skill,memory,observation} list/show`** CLI commands —
  human-readable views of the new tables. `mnema observation` is a new
  top-level command.
- **`mnema doctor` mirror-drift warnings**: reports skills/memories
  rows whose `.md` file is missing. Warnings, not errors.

### Changed

- **`SkillService` constructor** is dual-mode: lint-only when only
  `(skillsDir, knownTools)` are supplied (backward-compatible), full
  record mode when the SQLite + identity + audit triplet is also
  passed. CLI `mnema skill lint` keeps the old signature.
- **`task_actions`** (introduced in 0.2.0) is now listed in
  `UNIVERSAL_TOOL_NAMES`, so `mnema skill lint` recognises it.

### Migrations

- `008_skills_and_memories.sql` — adds the three tables.

### Internal

- 357 tests across 53 suites (was 331). New unit tests for each of the
  three services plus an MCP integration suite covering registration,
  versioning, upsert, append, bootstrap surfacing, and the
  `NO_ACTIVE_RUN` guard.

## [0.2.0-alpha.0] — 2026-05-10

Second public alpha. Driven by two end-to-end real-world tests with
two simulated team members each (Maria via CLI, dev3 via MCP, dev4 via
MCP + kanban workflow) plus the PO (felipesauer) running planning,
review and audit. All findings recorded in `evaluations/` and resolved
before the bump. The result: every transition flow has been exercised
against a real codebase (a Todo CLI and a CV→PDF formatter), and every
friction point those tests surfaced has either been fixed or
documented as a deliberate trade-off.

### Added

- **`mnema identity`** — `set` / `whoami` / `unset` / `add` / `list`
  for persistent default actor configuration and a known-actors map
  used for display-name resolution in audit views.
- **Multi-actor display**: `history`, `audit query`, `watch`, `task
  history`, `agent inspect` substitute known actor handles with their
  display name (e.g. `Felipe Sauer via Claude Code`).
- **Migration guard**: mutations refuse to run when `schema_migrations`
  on disk is behind the migration files. `mnema migrate` (alias of
  `mnema migration apply`) brings the database forward.
- **`task history <key>`**: per-task chronological view rolling up
  transitions, notes and attachments.
- **`task_actions(task_key)`** MCP tool: lists the workflow actions
  available on a task right now, with required fields per action.
- **`tasks_list` MCP filters**: `assignee_id` (handle or UUID), `sort`
  (`key` / `updated_at` / `created_at` / `priority`), `limit`. The
  default `key` sort is natural-numeric (`MNEMA-2` before `MNEMA-10`).
- **`agent_plan_create` `task_key` field**: links a plan to the task
  it implements. The link surfaces in `agent inspect` and is queryable.
- **`agent_plan_update_state` by position**: agents that declare a
  linear plan upfront can address steps by `(run_id, position)`
  instead of tracking UUIDs in parallel.
- **`note_kind`s `scope_change` and `acceptance_addendum`**: stronger
  intent than `agent_observation` for mid-flight scope deviations.
- **Workflow `field_kind`**: `requires` fields can declare `mutating`
  (default — value persists onto the task row) or `validating` (value
  is captured in `transitions.payload` for audit but never overwrites
  the task). All annotation fields in the four shipping workflows
  (`reason`, `pr_url`, `note`, `approval_note`, `feedback`,
  `resolution`, and kanban's `promote.title`) are marked `validating`.
- **`context_bootstrap.statistics.by_state`**: per-state count map so
  agents can plan from a single bootstrap call.
- **`context_bootstrap.agents_md_path`**: relative path companion to
  the inline `agents_md` content, for clients with file access.
- **Gate failure hints**: when `GATE_FAILED` mentions `assignee_id`,
  `pr_url`, `estimate` or `acceptance_criteria`, the error response
  appends a one-line field-format hint after the generic guidance.

### Changed

- **Transition payload now persists onto the task** (commit `168b47b`).
  Validated payload fields that map to task columns (`title`,
  `description`, `acceptance_criteria`, `estimate`, `priority`,
  `assignee_id`) are written through `TaskRepository.updateFields`
  after the state transition. The full original payload still goes
  verbatim into `transitions.payload` for audit. The `field_kind`
  flag (above) is how a workflow opts a field out of this behaviour.
- **`task show` displays full task contents**: description,
  acceptance criteria, estimate, assignee, sprint/epic refs and
  `created`/`updated` timestamps appear by default.
- **`mnema --help` lists every subcommand**: the lazy stub registry
  now exposes 24 commands at the root help instead of `help` only.
- **`CommandSpec.description`** is mandatory: top-level commands carry
  a one-line description that the root help renders.
- **CLI error exits**: structured errors return non-zero exit codes
  via the call sites of `printError(...)`. (The 0.1.0 `exit=0`
  perception in the Phase A evaluation was a tail-pipe artefact.)
- **Tarball cleanup**: `scripts/copy-migrations.mjs` clears stale
  `.sql` files from `dist/storage/sqlite/migrations/` before copying
  so deleted-from-source migrations don't ride into `pnpm pack`.
- **Transition tool descriptions**: actions with no `requires` fields
  carry a `This action has no required fields beyond task_key` line.

### Migrations

- `006_extend_note_kinds.sql` — adds `scope_change` and
  `acceptance_addendum` to the `notes.kind` CHECK.
- `007_agent_plan_task_link.sql` — adds optional `task_id` FK on
  `agent_plans`.

### Documentation

- `evaluations/2026-05-10-real-world-test.md` — Phase A + B
  (Todo App, CLI vs MCP).
- `evaluations/2026-05-10-phase-b-prime.md` — Phase B'
  (cv-fmt, kanban workflow, MCP-only).

### Known limitations

- Tasks created before commit `168b47b` may have `description: null`
  and `acceptance_criteria: []` even after submit. A backfill is
  possible but forward-only is acceptable at alpha — re-submit the
  task or treat those fields as legacy when consuming the row.
- Field-level hints on `GATE_FAILED` cover the four most common
  semantic fields (`assignee_id`, `pr_url`, `estimate`,
  `acceptance_criteria`). Other gate fields show the generic message.
- The CLI `parseFieldArgs` splits comma-bearing strings into arrays
  to keep `acceptance_criteria=A,B` working as an array. Free-form
  strings with commas (e.g. `description=foo, bar`) get split too.
  Workaround: avoid commas in single-field CLI values; the MCP path
  doesn't have this issue.

## [0.1.0-alpha.1] — 2026-05-07

First public alpha. The core surface is complete: tasks, sprints,
decisions, notes, epics, attachments, full-text search, audit log,
human and agent CLIs, an MCP server with all 19 universal tools,
end-to-end smoke coverage for the failure modes that matter, and
migration drift detection plus a stub generator for future schema
changes.

### Added

- **Workflow as data**: declarative state machines (`default`, `lean`,
  `kanban`, `jira-classic`) with per-transition gate validation
  expressed in a small JSON DSL and translated to Zod at boot.
- **Tasks**: create / list / show / move / delete (soft) / restore,
  with markdown mirror under `backlog/<STATE>/<KEY>.md` and FTS5 index.
- **Sprints**: plan / start / close / show / list / add / remove,
  with ISO 8601 validation on `--starts-at` / `--ends-at` and a 1–1000
  bound on `capacity`.
- **Decisions (ADRs)**: record / show / list / accept / reject /
  supersede, surfaced in the inbox while in `proposed` status.
- **Notes**: typed annotations on tasks (`comment`, `agent_observation`,
  workflow-coupled kinds) via `mnema note add` and the `note_add` MCP
  tool.
- **Epics**: create / show / list / close / add / remove, with the
  `epic` workflow feature flag honoured at the workflow level.
- **Attachments**: SHA-256-deduplicated content store under
  `.app/attachments/`, attachable to tasks and decisions.
- **Search**: unified FTS5 across tasks, decisions and notes; the
  `tasks_search` MCP tool exposes the same index to agents.
- **Audit log**: append-only JSONL under `.audit/`, monthly rotation,
  queryable via `mnema audit query` and the `audit_query` /
  `history_get` MCP tools.
- **Dual identity** on every mutation (actor + via + run id).
- **MCP server** (`mnema mcp serve`) on stdio with 19 universal tools
  + one per workflow transition; in-memory transport harness for
  tests; install snippets for Claude Code, Cursor, Aider and generic
  clients.
- **Memory tooling**: `mnema memory consolidate` regenerates `INDEX.md`
  files preserving human-authored content; `mnema memory lint`
  validates ADR shape.
- **Skill tooling**: `mnema skill lint` validates frontmatter, MCP
  tool references and worked examples.
- **Adoption**: `mnema init` (silent or interactive wizard via
  `@inquirer/prompts`) and `mnema adopt all` to ease into existing
  projects; importers for Markdown (`## STATE Title`) and GitHub
  Issues.
- **`mnema destroy`** with two confirmations (yes/no + key match) and
  per-tree opt-in preservation.
- **`mnema doctor`** read-only diagnostics, including migration drift
  (pending file or orphan version flagged separately); `mnema watch`
  live tail; `mnema inbox` review queue including pending decisions.
- **`mnema migration generate <slug>`** writes the next `NNN_<slug>.sql`
  stub under the bundled migrations directory.
- **`pnpm test:coverage`** runs the suite under `@vitest/coverage-v8`
  with text/html/lcov reporters (baseline 60 % statements,
  54 % branches over `src/`).
- **Importer metadata**: `TaskService.create` accepts a `metadata`
  bag; the GitHub Issues importer fills it with
  `{ source, issue_number, author, labels }` so the trail back to
  the original record is preserved.

### Changed

- `formatTaskBlock` resolves actor handles via `IdentityService`
  instead of printing raw UUIDs.
- `mnema init` accepts `--name` / `--key` as optional and falls back
  to a wizard when either is missing; `--yes` preserves the silent
  flow.
- `SyncBuffer.truncate` and the new `drain()` helper now take a
  cooperative file lock (`proper-lockfile`) so two MCP servers
  flushing in parallel cannot lose entries.
- The Markdown importer is now explicitly state-blind: a heading like
  `## DRAFT Implement OAuth` becomes the literal title `DRAFT
  Implement OAuth`. The previous "STATE Title" parser silently dropped
  the prefix without running any transition; the new behaviour keeps
  the title intact, leaving the workflow move as an explicit step.

### Removed

- `.npmrc` (the `auto-install-peers` and `only-built-dependencies`
  keys were redundant: pnpm installs peers by default and the build
  allow-list lives in `package.json#pnpm.onlyBuiltDependencies`).

### Performance

- `mnema --version` ~33 ms (target 50 ms).
- `mnema task list` ~144 ms (target 200 ms).
- `task_create` MCP cold ~4.5 ms, warm ~1 ms (targets 200 / 20 ms).
- `mnema task move` is the only budget still over (~167 ms vs target
  100 ms); the SQLite open + workflow gate parsing on the hot path
  dominate the remaining cost.

### Internal

- 279 tests across 48 suites: unit, integration, in-memory MCP and
  end-to-end (kill mid-flush via spawned process, SIGTERM on
  `mnema mcp serve`).
- Lazy command registration in `cli/index.ts` plus dynamic imports of
  the MCP SDK and `@inquirer/prompts` reduced cold-CLI startup by
  ~80 %.
- `prebench: pnpm build` ensures `pnpm bench` always exercises a
  fresh dist; `bench:mcp` covers in-process `task_create` cold/warm.
- `npm pack` smoke verified: tarball installs into a clean tmpdir,
  `mnema init --yes` provisions the layout, and `mnema doctor`
  reports clean (config, version, workflow, paths, db, migrations
  3/3) — `scripts/copy-migrations.mjs` is the build step that ships
  the SQL files alongside the compiled JavaScript.

[Unreleased]: https://github.com/saurim/mnema/compare/v0.3.0-alpha.1...HEAD
[0.3.0-alpha.1]: https://github.com/saurim/mnema/releases/tag/v0.3.0-alpha.1
[0.3.0-alpha.0]: https://github.com/saurim/mnema/releases/tag/v0.3.0-alpha.0
[0.2.0-alpha.0]: https://github.com/saurim/mnema/releases/tag/v0.2.0-alpha.0
[0.1.0-alpha.1]: https://github.com/saurim/mnema/releases/tag/v0.1.0-alpha.1
