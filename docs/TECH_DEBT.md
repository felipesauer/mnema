# Tech debt

> **Status:** v0.1.0 — backfilled from Phases 0-8 commits and code.
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

The Phase 5 plan (EXECUTION_GUIDE.md §5.3) lists 19 universal tools.
Phase 5 shipped 11; the rest depend on Services that did not exist
when Phase 5 closed. They are listed by required service.

- 🟡 **`tasks_search` (FTS5 over the workflow project)** — `SearchService`
  exists since Phase 7, but the MCP surface still does not expose it.
  Add an `SearchTool` next to the other `universal/` tools.
- 🟡 **`decision_record`, `decision_show`, `decisions_list`** — wait on
  `DecisionService`. The DB schema and the FTS5 index already exist
  (migration 001).
- 🟡 **`note_add`** — wait on `NoteService`. Schema in migration 001.
- 🟡 **`sprint_show`, `sprints_list`, `sprint_add_task`** — `SprintService`
  exists (Phase 7). Wrap it with MCP tools — light work, the only
  reason it didn't ship in Phase 7 was MCP focus. See
  [src/cli/commands/sprint-command.ts](../src/cli/commands/sprint-command.ts)
  for the operations to surface.
- 🟡 **`epic_show`, `epics_list`** — wait on `EpicService`. Schema in
  migration 001.
- 🟡 **`history_get`** — read-only convenience over the audit log,
  alternative framing of `audit_query`. Decide whether it adds value
  or whether `audit_query` already covers the use case.

## 2. Services not yet implemented

These are referenced from comments and templates already shipped, so
their absence is observable.

- 🟡 **`DecisionService`** — referenced from
  [src/services/inbox-service.ts:9](../src/services/inbox-service.ts),
  [src/services/attachment-service.ts:53](../src/services/attachment-service.ts),
  [src/services/adoption-service.ts:176](../src/services/adoption-service.ts).
  Inbox should list `DecisionStatus.Proposed` once available; attachment
  should accept `kind: 'decision'`.
- 🟡 **`NoteService`** — `note` is already a polymorphic parent in
  `attachments` and a `NoteKind` enum exists, but no service writes
  to the table. Block for `note_add` MCP tool and inbox extensions.
- 🟡 **`EpicService`** — schema and entity exist; the `epic` workflow
  feature flag is honoured at the workflow level but no service
  manipulates `epics`.
- 🟡 **Skill / memory services** — `skills/SKILL.md` and `memory/INDEX.md`
  templates ship in Phase 8 adoption, but no service reads or writes
  them. Phase 9 (Skills, memory consolidate, polish) is the home.

## 3. UX gaps

- 🟡 **Interactive `init` wizard** — Phase 8 explicitly kept `init`
  silent/flag-driven. DESIGN.md §6.1 prescribes a wizard with
  `@inquirer/prompts`. The dependency is already installed.
- 🟡 **`mnema destroy`** — documented in DESIGN.md §7.4 ("uninstall
  with two confirmations"); not implemented.
- 🟡 **`mnema decision record/show/list` CLI** — counterpart of the MCP
  tools above. ADRs as a feature is in the kit but absent from the CLI.
- 🟡 **`mnema note add` CLI** — same pattern.
- 🟢 **`mnema task delete` / soft-delete CLI** — soft-delete column
  exists since Phase 2 but no command toggles it.

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

- 🟢 **Reporter handle in CLI output** — `formatTaskBlock` shows the
  internal UUID for `reporter` instead of the actor handle. Visible in
  every `mnema task show`. Cheap fix: resolve via `ActorRepository`.
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
  into the lint/test cycle. Phase 9 hygiene candidate.

## 7. Documentation and polish

- 🟡 **User-facing README.md** — root `README.md` is one-line stub since
  Phase 0. EXECUTION_GUIDE Phase 9 calls for a real README before
  v1.0.0.
- 🟡 **CHANGELOG.md** — never created. Each phase commit message has
  the change history; collapsing into a CHANGELOG is in the v1.0.0
  release checklist.
- 🟡 **`docs/` is a snapshot of `.plan/`** — Phase 0 copied the design
  kit. They have drifted (the implementation took several decisions
  the kit does not). Decide whether `docs/` is a frozen reference or
  the canonical doc set; if the latter, reconcile it.
- 🟢 **`@types/uuid` was uninstalled because uuid 14 ships its own
  types**, but the global `.npmrc` warning about pnpm-only keys is
  still emitted by `npm view`. Cosmetic.
- 🟢 **`.npmrc` has `auto-install-peers=true`** — pnpm ignores the
  `npm`-style key. Either drop it or migrate to the pnpm config file.

## 8. Schema and migrations

- 🟢 **No `004_*.sql` slot reserved** — when the schema needs a change,
  we'll add migration 004. The naming is locked (`NNN_description.sql`)
  but no helper command (`mnema migration generate`) exists.
- 🟢 **Schema version drift detection** — `mnema doctor` checks the DB
  opens but does not compare the latest applied migration with the
  number of files in `migrations/`. Worth a check once the count grows.

---

## Roadmap mapping

For convenience, here is the rough phase home of the items above:

| Section / item | Original phase | Suggested home |
|---|---|---|
| MCP tools 9-19 | 5 | Phase 7+ as services land |
| `DecisionService`, `NoteService`, `EpicService` | — | New services phase between 7 and 9 |
| Interactive `init` wizard | 8 | Phase 9 polish or post-MVP |
| `mnema destroy`, `mnema decision`, `mnema note` CLI | 7-8 | Same |
| Cooperative buffer lock, kill-mid-flush test | 5 | Phase 9 hardening |
| README.md, CHANGELOG.md | 9 | Phase 9 |
| Coverage report, schema drift check | 9 | Phase 9 |
