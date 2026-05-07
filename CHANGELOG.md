# Changelog

All notable changes are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
version scheme follows [Semantic Versioning](https://semver.org/).

This project is in alpha — releases are tagged `vX.Y.Z-alpha.N` until
the surface stabilises. The `-alpha.N` suffix is dropped on the first
stable release.

## [Unreleased]

## [0.1.0-alpha.1] — 2026-05-07

First public alpha. The core surface is complete: tasks, sprints,
decisions, notes, epics, attachments, full-text search, audit log,
human and agent CLIs, an MCP server with all 19 universal tools, and
end-to-end smoke coverage for the failure modes that matter.

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
- **`mnema doctor`** read-only diagnostics; `mnema watch` live tail;
  `mnema inbox` review queue including pending decisions.

### Changed

- `formatTaskBlock` resolves actor handles via `IdentityService`
  instead of printing raw UUIDs.
- `mnema init` accepts `--name` / `--key` as optional and falls back
  to a wizard when either is missing; `--yes` preserves the silent
  flow.
- `SyncBuffer.truncate` and the new `drain()` helper now take a
  cooperative file lock (`proper-lockfile`) so two MCP servers
  flushing in parallel cannot lose entries.

### Performance

- `mnema --version` ~33 ms (target 50 ms).
- `mnema task list` ~144 ms (target 200 ms).
- `task_create` MCP cold ~4.5 ms, warm ~1 ms (targets 200 / 20 ms).
- `mnema task move` is the only budget still over (~167 ms vs target
  100 ms); the SQLite open + workflow gate parsing on the hot path
  dominate the remaining cost.

### Internal

- 272 tests across 47 suites: unit, integration, in-memory MCP and
  end-to-end (kill mid-flush via spawned process, SIGTERM on
  `mnema mcp serve`).
- Lazy command registration in `cli/index.ts` plus dynamic imports of
  the MCP SDK and `@inquirer/prompts` reduced cold-CLI startup by
  ~80 %.
- `prebench: pnpm build` ensures `pnpm bench` always exercises a
  fresh dist.

[Unreleased]: https://github.com/saurim/mnema/compare/v0.1.0-alpha.1...HEAD
[0.1.0-alpha.1]: https://github.com/saurim/mnema/releases/tag/v0.1.0-alpha.1
