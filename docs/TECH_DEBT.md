# Tech debt

> **Status:** v0.1.0 — phases 0-9 closed.
> **Audience:** anyone (human or agent) deciding what to build next.

This file is the canonical inventory of decisions deferred during
implementation: features in the design that we did not ship yet,
shortcuts that work today but will hurt later, and tests / verification
gaps. It exists because phase-by-phase implementation tends to leave
small "we'll handle that later" items scattered across commits and
comments — without a single index they become invisible.

## How to use this file

1. **Before starting a phase or a non-trivial feature**, scan the
   relevant section here to see if a debt overlaps. Pay it down if it
   blocks you, or document why you are layering more work on top of it.
2. **Whenever you commit work that knowingly skips part of the design
   or the workflow**, append an entry to the right section in the same
   commit. Keep entries terse: one line per decision, with the file or
   commit reference if useful.
3. **When you implement a deferred item**, delete the entry (do not
   leave "DONE" markers — `git log` is the audit trail).

Entry format:

```markdown
- **[Title]** — short description. Tied to `path/to/file.ts:LN` /
  commit `<sha>` / DESIGN.md §X.
```

Severity hints:
- 🔴 user-visible bug or violation of a design invariant — fix before v1.0.0
- 🟡 missing feature documented in the kit — schedule for the relevant phase
- 🟢 nice-to-have / engineering hygiene — pick up opportunistically

---

## 1. MCP tools not yet implemented

All 19 universal tools from EXECUTION_GUIDE.md §5.3 are now wired.
Add new entries here when the design grows (e.g. `attach_*`,
`decision_supersede` if it gets surfaced as MCP rather than CLI).

## 2. Services not yet implemented

These are referenced from comments and templates already shipped, so
their absence is observable.

## 3. UX gaps


## 4. Concurrency and resilience

- 🟡 **Cooperative file lock on the sync buffer** — ARCHITECTURE.md §11.3
  describes "lock cooperativo (file lock) durante append" between
  multiple `mnema mcp serve` instances writing the same
  `.app/buffer.jsonl`. We rely on POSIX `O_APPEND` atomicity for
  shorter-than-PIPE_BUF writes; that is correct for line-by-line
  appends but does not protect against the simultaneous truncate
  (`flushAll`) of two servers. Audit when adding multi-server tests.
- 🟡 **Buffer recovery under crash** — `SyncBuffer.recover()` is unit
  tested with `mkdtempSync` and idempotent flush. The "kill the
  process mid-flush" scenario in EXECUTION_GUIDE.md §5 criteria has
  not been exercised end-to-end.
- 🟡 **Graceful shutdown SIGTERM in production conditions** — handler
  is in place ([src/mcp/mcp-server.ts](../src/mcp/mcp-server.ts)),
  unit tested by triggering manually. Real signal delivery from a
  parent process (Claude Code spawn) was not exercised.
- 🟢 **Optimistic concurrency outside `task transition`** — only the
  Task path enforces `expected_updated_at`. Sprints, decisions,
  agent_runs etc. do not. Probably fine while there is a single MCP
  server, revisit when permissions / multi-actor land.

## 5. Identifier and metadata gaps

- 🟢 **GitHub Issues importer ignores labels and author metadata** —
  parsed but not persisted. Comment in
  [src/services/importers/github-issues-importer.ts](../src/services/importers/github-issues-importer.ts).
  Needs a way for `TaskService.create` to accept metadata.
- 🟢 **Markdown importer state hint** — parsed `## STATE Title` but
  does not transition the imported task into that state, because gates
  may need payload the markdown does not provide. Documented in the
  importer; either honour the hint via direct SQL update or drop the
  parser branch.

## 6. Testing and verification gaps

- 🟡 **No MCP smoke against a real client** — Phase 5 criteria mention
  "Cliente real (Claude Code) consegue conectar e operar". We test
  via `InMemoryTransport`. Manual verification has not happened.
- 🟡 **`mnema audit query --since=24h`** is unit tested in
  `audit-query.test.ts` but not E2E against rotated months.
- 🟡 **Sprint `--starts-at` / `--ends-at`** flags accept any string;
  nothing validates ISO8601. Same for `capacity` upper bound.
- 🟢 **No coverage report** — `vitest run --coverage` was never wired
  into the lint/test cycle.

## 7. Performance

- 🟡 **All three CLI budgets exceeded** — `pnpm bench` reports
  ~210ms / 230ms / 250ms for `--version`, `task list`, `task move`
  (budgets 50/200/100ms; ARCHITECTURE.md §15). Spawn cost dominates
  short commands. Mitigations to evaluate: lazy-load
  `@modelcontextprotocol/sdk` and `better-sqlite3` only when needed,
  ship a precompiled CJS bundle in `dist/` for shorter parse, drop
  `tsc-alias` at runtime by switching to relative imports.
- 🟢 **`pnpm bench` requires a manual `pnpm build` first** — the
  benchmark spawns the compiled CLI but doesn't depend on the build
  task. Either add `prebench: pnpm build` or compile via tsx in-process.
- 🟢 **No bench coverage for MCP cold/warm task_create** —
  ARCHITECTURE.md §15 lists 200ms cold / 20ms warm for the MCP path.
  Bench only exercises the CLI today.

## 8. Memory automation

- 🟡 **Note → ADR promotion is a manual step** — DESIGN.md §11.7 / §14.3
  describe a richer consolidation: notes that became relevant promote
  to ADRs, obsolete decisions are marked superseded, historical
  snapshots aggregate. The note-to-ADR step requires semantic judgment
  the project explicitly does not embed; treat this as "agent-assisted,
  human-confirmed" rather than fully automated. The supporting
  primitives are now in place (DecisionService.transition with
  Superseded, NoteService) — only the orchestration is missing.
- 🟡 **`memory/decisions/` is decoupled from the SQLite `decisions`
  table** — `decision_record` writes to SQLite; `mnema memory
  consolidate` only reads markdown files. Either pick one source of
  truth (and make the other a projection) or document that they answer
  different questions. Decision deferred until a human curation flow
  needs the bridge.

## 9. Documentation and polish

- 🟡 **CHANGELOG.md** — never created. Each phase commit message has
  the change history; collapsing into a CHANGELOG is in the v1.0.0
  release checklist.
- 🟡 **`docs/` is a snapshot of `.plan/`** — Phase 0 copied the design
  kit. They have drifted (the implementation took several decisions
  the kit does not). Decide whether `docs/` is a frozen reference or
  the canonical doc set; if the latter, reconcile it.
- 🟢 **`.npmrc` has `auto-install-peers=true`** — pnpm ignores the
  `npm`-style key. Either drop it or migrate to the pnpm config file.

## 10. Schema and migrations

- 🟢 **No `004_*.sql` slot reserved** — when the schema needs a change,
  we'll add migration 004. The naming is locked (`NNN_description.sql`)
  but no helper command (`mnema migration generate`) exists.
- 🟢 **Schema version drift detection** — `mnema doctor` checks the DB
  opens but does not compare the latest applied migration with the
  number of files in `migrations/`. Worth a check once the count grows.

---

## Roadmap mapping

For convenience, here is the rough phase home of the items above:

| Section / item | Suggested home |
|---|---|
| MCP tools 9-19 | New phase: Decision/Note/Epic services + their MCP tools |
| `DecisionService`, `NoteService`, `EpicService` | Same phase |
| Interactive `init` wizard | UX polish phase or post-MVP |
| `mnema destroy`, `mnema decision`, `mnema note` CLI | Same as the corresponding services |
| Cooperative buffer lock, kill-mid-flush test | Hardening phase before v1.0.0 |
| Performance budgets | Hardening phase — measure-first, optimise-second |
| CHANGELOG.md | v1.0.0 release checklist |
| Coverage report, schema drift check | v1.0.0 release checklist |
