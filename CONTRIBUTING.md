# Contributing to Mnema

Thanks for the interest. Mnema is an alpha project in active
development; the codebase is small enough that one person can hold
the whole picture, but it has invariants you should know about
before touching the SQLite schema, the audit log, or the workflow
machine. This document covers what you need to be productive.

## Dev setup

Requirements: Node ≥ 20, pnpm ≥ 9, git.

```bash
git clone https://github.com/felipesauer/mnema.git
cd mnema
pnpm install
pnpm build       # tsc + tsc-alias + copy-migrations
pnpm lint        # biome check (zero warnings expected)
pnpm test        # vitest run, full suite (~30s)
```

Optional, but useful:

```bash
pnpm test:watch          # vitest UI
pnpm test:coverage       # v8 coverage report → coverage/
pnpm bench               # CLI cold-start budgets (CI gate; runs on every push)
pnpm bench:mcp           # in-process MCP latency (cold + warm tool calls)
```

`pnpm bench` is a CI gate — keep it green. `pnpm bench:mcp` is **not**
in CI; run it by hand before changes that touch the MCP server, the
service container, or the tool registry, to catch a latency regression
on the path agents actually use.

To exercise the binary you just built, point a global symlink at it:

```bash
pnpm pack                                       # → felipesauer-mnema-<version>.tgz
npm i -g ./felipesauer-mnema-*.tgz              # → installs as `mnema` on PATH
mnema --version                                 # confirm it matches package.json
```

Or skip the pack step and run the dev entry directly:

```bash
pnpm dev <args>                                 # tsx src/index.ts
```

## Project layout

```
src/
├── cli/                CLI commands (lazy-loaded), formatters, templates
├── config/             Zod config schema + loader
├── domain/             Entities, enums, state machine (workflow as data)
├── errors/             ErrorCode + MnemaError union + printer
├── mcp/                MCP server, session context, tool registry
├── services/           22 services (task, decision, sprint, epic, …)
├── storage/            SQLite repositories, migration runner, audit JSONL
└── utils/              Asset paths, logger, perf trace, atomic write

tests/
├── unit/               Pure logic
├── integration/        Service + repository tests with real SQLite tmpdirs
└── e2e/                Full CLI via spawnSync

workflows/              Bundled workflow JSON (default, lean, kanban, jira-classic)
```

## Commit and PR conventions

We follow a flavour of [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>: <short imperative summary, lowercase>

<body explaining WHY this change, not WHAT — the diff already shows
what. Reference the friction or invariant that motivated it. Wrap at
72 cols.>

<optional footers: Co-Authored-By, Refs MNEMA-NN, etc.>
```

Common types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`,
`perf`, `build`.

**Do not** reference internal phase identifiers (`Phase X`, `Camada N`,
`F-XN`, `Bug N`) in code comments, JSDoc, or SQL migration headers.
They belong in commit messages and CHANGELOG.md, where they age
gracefully alongside their context.

## Tests

Every code change should ship with tests:

- **Bug fix:** add a regression test that fails before your fix and
  passes after.
- **New feature:** unit test the core logic; integration test if it
  touches SQLite, the audit log, or the workflow.
- **Workflow / schema change:** also extend
  `tests/integration/storage/migration-runner.test.ts` if the
  migration count changes.

If you find a vector the suite doesn't cover (multi-actor race, tamper
attempt, custom-workflow edge case), the most useful contribution is a
**failing test** that reproduces it under `tests/`. Open an issue with
the repro too, so it's tracked even before a fix lands.

## Smoke run before tagging

Before any release tarball gets shipped, two gates run:

```bash
pnpm publish:check           # 13 automated checks (build, lint, tests,
                             # coverage, bench, MCP smoke, tarball shape)
pnpm smoke:bootstrap         # wipes /tmp/mnema-smoke/, sets up a clean workdir
```

After the bootstrap, the maintainer walks a 21-phase manual smoke
(init → tasks → sprints → decisions → MCP tools → doctor → destroy)
in the clean workdir, and files anything that breaks as an issue.

## Things to watch out for

- **Workflow as data.** Every behaviour driven by `workflows/*.json`.
  Hardcoding states in services breaks `lean`/`kanban`/`jira-classic`.
  Schema refines and `mnema doctor` checks defend this invariant —
  extend both when adding workflow features.
- **Audit log is tamper-evident.** Migration 011 added a SHA-256 hash
  chain. Don't write to `.mnema/audit/*.jsonl` directly; use
  `AuditWriter.write()` so the chain stays intact.
- **Mutations require an active agent run via MCP.** `task_create`,
  `decision_record`, `memory_record` etc. all gate on
  `agent_run_start` having been called. CLI is more permissive (the
  human is the actor) but the same audit identity tuple
  (`actor` / `via` / `run`) is captured.
- **No hot-patch on migrations.** New schema work means a new
  `NNN_<slug>.sql` file; never edit a previously-applied migration.
  Use `mnema migration generate <slug>` to scaffold one (writes to
  the project's `.mnema/migrations/`, not the global package).

## Reporting bugs

Open an issue at <https://github.com/felipesauer/mnema/issues>. Include:

1. `mnema --version` output.
2. Steps to reproduce (ideally a tmpdir from `pnpm smoke:bootstrap`).
3. What you expected vs what you got.
4. If relevant, attach a sanitized copy of
   `.mnema/audit/current.jsonl` so the audit trail is visible.

## License

By contributing you agree your changes will be released under the
MIT License (see [LICENSE](LICENSE)).
