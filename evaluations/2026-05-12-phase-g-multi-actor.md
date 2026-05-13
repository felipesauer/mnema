# Multi-actor concurrency — adversarial sweep + remediation

**Date:** 2026-05-12
**Mnema version under test:** 0.3.0-alpha.1 (after the audit-integrity
work landed in commit `c2820b2`).
**Tester:** felipesauer (PO) + sub-agent `dev10` (CLI-only, no MCP).
**Project under attack:** `/tmp/mnema-phase-g2/` — synthetic project,
workflow `default`, ~80 concurrent process spawns (2-way, 4-way,
and 8/16 fan-outs) using bash `&` and Node `child_process.spawn`.
**Scope:** what happens when two or more CLI processes mutate the
same Mnema project simultaneously. The first sweep covered single-
process file tampering against the JSONL audit log; this one
exercises the actual race surface a multi-agent or multi-shell
workflow would hit.

---

## Result — 4 high-severity, 1 medium

dev10 tried seven attack patterns. Five findings:

| ID | Severity | Symptom | Defense before | Defense after |
|---|---|---|---|---|
| F-GC1 | 🔴 | Two concurrent `task move … submit` both exit 0; one mutation silently lost | UPDATE without optimistic-concurrency check | service defaults `expectedUpdatedAt` to the row it just read; second writer's UPDATE matches zero rows → `CONFLICT` (or `INVALID_TRANSITION` if state already moved) |
| F-GC2 | 🔴 | `decision accept` vs `decision reject` race; both exit 0; audit log narrative contradicts final row | UPDATE without token | same default-token treatment in `DecisionService.transition` |
| F-GC3 | 🔴 | Concurrent `sprint start` on two PLANNED sprints leaks `SqliteError: UNIQUE constraint failed: sprints.project_id` stack trace, exit 1 | unwrapped throw | `tryMutation` around `updateState` + new mapping `SQLITE_CONSTRAINT_UNIQUE` (idx_sprints_active) → `ACTIVE_SPRINT_EXISTS` |
| F-GC4 | 🔴 | 16 concurrent `task create` fan-outs leave `audit current.jsonl` with `prev_hash` breaks; `mnema doctor` permanently reports broken chain, no recovery | read-head + appendFileSync + recordEvent were three non-atomic steps | `AuditStateRepository.withChainAdvance(advance)` wraps the trio in `BEGIN IMMEDIATE`; concurrent writers serialise on the SQLite write lock |
| F-GC5 | 🟡 | `Conflict` error hardcoded `Task ${key} changed since…` even for decisions/sprints | message tied to a single shape | added `entity?: 'task' \| 'decision' \| 'sprint'` on the Conflict variant; printer renders `Decision X changed…` / `Sprint X changed…` |

## What we shipped

### Lost-write protection on every mutating transition

`TaskService.transition`, `DecisionService.transition`, `SprintService.start` /
`SprintService.close` now default `expectedUpdatedAt` to the
`updatedAt` of the row they just read when the caller passes no
token. The same `UPDATE tasks SET … WHERE updated_at = ?` shape that
previously fired only when the caller opted in now fires by default —
two concurrent transitions can no longer both report success against
a stale view.

A caller that genuinely wants to write blind can opt in by passing an
explicit empty string. There is no CLI surface for that today; the
default is fail-closed.

### `withChainAdvance` serialises the audit-write trio

The first sweep (commit `c2820b2`) added a hash chain via the
`audit_state` mirror, but the writer did `read head → appendFileSync
→ recordEvent` in three non-atomic steps. Under 16-way concurrency
two processes could both read the same head and append siblings —
the chain forked, `doctor` flagged it correctly but the file was
already corrupt with no in-band recovery.

New `AuditStateRepository.withChainAdvance(callback)` wraps the trio
in `BEGIN IMMEDIATE`. Only one writer holds the SQLite write lock at
a time, so concurrent CLI invocations queue cleanly. The
`appendFileSync` happens inside the transaction so the hash that ends
up on disk matches the hash that ends up in `chain_head_hash`.

### `SQLITE_CONSTRAINT_UNIQUE` → structured error

`sqlite-error-map.ts` now recognises the partial unique index on
`sprints(project_id) WHERE state = 'ACTIVE'` and maps the throw into
`ActiveSprintExists`. The sprint service wraps `updateState` in
`tryMutation`, catches the variant, and re-fetches the active sprint
key so the error carries usable context (the SqliteError message
itself doesn't carry the winning sprint's key).

### Per-entity conflict messages

`MnemaError.Conflict` gained an optional `entity` field; the printer
renders `Decision X changed…` / `Sprint X changed…` / `Task X changed…`.
Agents pattern-matching the wording will no longer trip on the
hardcoded `Task` prefix.

## What we deliberately did not change

- **`INVALID_TRANSITION` still fires before `CONFLICT` when the row
  has moved past a valid state.** dev10 flagged this as masking the
  token-stale diagnostic, but the order matches what callers usually
  want to see: "submit isn't available from READY" is more actionable
  than "your token is stale" when the row has already moved. The
  underlying protection (no lost-write) is preserved either way.

- **Audit log already-broken state has no in-band repair.** Once
  `current.jsonl` has a chain break (from any past concurrent write
  before this fix), `doctor` will keep reporting it. Recovery is
  manual: rotate the file, start fresh. Adding an auto-repair would
  require deciding whether the divergent siblings are real events or
  forgeries — that's a policy call we explicitly don't want to embed.

## Tests added

5 new integration tests in
`tests/integration/services/concurrent-mutations.test.ts`:

- task transition with stale token is refused (no lost-write)
- task transition without explicit token uses read row as default token
- decision transition with stale token is refused
- decision transition without explicit token also fails closed
- `Conflict` error carries `entity: 'task'` for the printer

The hash-chain serialisation under real concurrency is exercised by
the existing 8 audit-integrity tests (the `BEGIN IMMEDIATE` path is
the default path now). A multi-process race test would need
subprocess spawning and is tracked as a follow-up smoke test.

## Numbers

- **410 tests pass** (was 405 before this work; +5 from the new
  concurrent-mutations suite).
- **Lint clean. Build clean.**
- **No new migration** — the fix lives entirely in service-layer
  default values plus the new chain-advance helper.
- **Two refactored modules**: `AuditWriter` (chain advance), `task-service` /
  `decision-service` / `sprint-service` (default token).
- **One mapper extension**: `sqlite-error-map.ts` recognises the
  sprint unique-index violation.

## What this does NOT prove

- The integration tests simulate concurrency in-process. Real
  multi-process behaviour (SQLite WAL + `busy_timeout`) is exercised
  every time a user runs `mnema` from two shells, but is not in CI.
  A scripted smoke test that spawns N `mnema` subprocesses and
  inspects exit codes + audit chain would close the gap.

- Two MCP servers binding the same project are still not on the
  table; concurrency is bounded to CLI today.

## Tracked for later

- 🟢 **Multi-process smoke test in CI**: spawn N subprocesses,
  inspect outcomes. Useful as a regression guard for both lost-write
  and chain race.
- 🟡 **`INVALID_TRANSITION` vs `CONFLICT` ordering**: the current
  order is fine for the default workflow but may confuse callers
  on custom workflows where the same action is valid from multiple
  states. Revisit when a real workflow hits the ambiguity.
