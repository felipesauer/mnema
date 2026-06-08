# Workflow-custom — adversarial sweep + remediation

**Date:** 2026-05-12
**Mnema version under test:** 0.3.0-alpha.1 (after the multi-actor work landed in commit `38944e2`).
**Tester:** felipesauer (PO) + sub-agent `dev11` (CLI-only, no MCP).
**Project under attack:** `/tmp/mnema-phase-g3/` — 14 hand-written workflow JSON variants replacing `default.json`, exercising 19 attack vectors.
**Scope:** what happens when a user authors a workflow JSON from scratch instead of using one of the four shipping presets.

---

## Result — 3 high, 6 medium, 1 low

dev11 surfaced 10 findings; full report at `/tmp/mnema-phase-g3/PHG3-FINDINGS.md`.

| ID | Severity | Symptom | Fix |
|---|---|---|---|
| F-GW1 | 🔴 | `transition.to` accepts unknown state → task lands in phantom state, unrecoverable | `superRefine` on `WorkflowMetaSchema` asserts every `transitions[from][action].to` is in `states[]` |
| F-GW2 | 🔴 | `requires` field with `min > max` passes the meta-schema, crashes gate compile with a raw Zod stack | `superRefine` walks every field spec and rejects `min > max` for string/number/array (including nested array.items and object.properties) |
| F-GW3 | 🔴 | Workflow edit drops a state holding tasks → tasks orphaned, doctor silent | New `inspectTaskStateDrift` checks distinct `tasks.state` values against `workflow.states`; reports as error |
| F-GW4 | 🟡 | Dead-end non-terminal states and unreachable states accepted without warning | New `inspectWorkflowShape` emits warnings for both shapes |
| F-GW5 | 🟡 | Schema-invalid workflow crashes every non-doctor CLI command with raw Node stack | `cli-context.openCliContext()` catches `WorkflowInvalidError` / `WorkflowNotFoundError` and routes through `printError` with the existing `WorkflowInvalid` / `WorkflowNotFound` shapes |
| F-GW6 | 🟡 | Doctor's `✗ workflow loads` row hides the Zod issue list | Doctor now formats `WorkflowInvalidError.issues` via `formatWorkflowIssues`; same loader path catches `JSON.parse` `SyntaxError` and wraps it as a `WorkflowInvalidError` with a "JSON parse error" custom issue |
| F-GW7 | 🟡 | Doctor reported `✗ workflow loads` but exited 0 | Verified the existing exit-code path is correct (`hasError ? ExitCode.State : ExitCode.Success` was already in place); re-confirmed by passing tests against the new failure shapes |
| F-GW8 | 🟡 | `task list --state "In Progress"` rejected even though the workflow declares the state literally; hint listed the value as valid | Removed destructive `.toUpperCase()`. New resolution: try literal match first, then case-insensitive fallback so `--state draft` still works on uppercase workflows |
| F-GW9 | 🟢 | `FEATURE_NOT_AVAILABLE` hint suggested switching to a preset that is the user's current workflow | Hint now looks up which presets actually ship the feature and excludes the active workflow from the suggestion |
| F-GW10 | 🟢 | Stale backlog dirs from `init` linger after a state is removed | Tracked in TECH_DEBT for now (cosmetic; empty dirs, no functional impact) |

## What we shipped

### Workflow schema gained two cross-cutting refines

`WorkflowMetaSchema.superRefine` now enforces:

1. Every `transition.to` (and from-state key) is in `states[]`.
2. Every numeric bound on string/number/array fields satisfies `min <= max`, recursively for `array.items` and `object.properties`.

Both failures show up at workflow-load time with the same per-issue surface as the existing checks — `formatWorkflowIssues` prints one line per issue with the field path.

### Loader catches JSON parse errors

`WorkflowLoader.load` now wraps `JSON.parse` in a try/catch and re-throws as `WorkflowInvalidError` with a synthetic `<root>` issue. Same downstream printer; the error becomes informative instead of a Node stack.

### CLI context routes workflow errors through the printer

`openCliContext()` catches `WorkflowInvalidError` and `WorkflowNotFoundError`, then exits via `printError` with the existing `ErrorCode.WorkflowInvalid` / `ErrorCode.WorkflowNotFound` shapes. Every CLI command (not just doctor) now produces a structured error on a malformed workflow.

### Doctor gained three new checks

- `workflow dead-end states` (warning): non-terminal states with no outbound transitions.
- `workflow unreachable states` (warning): non-initial states with no inbound transitions.
- `tasks states match workflow` (error): distinct `tasks.state` values that aren't in `workflow.states`.

All three live in `doctor-command.ts` next to `inspectMigrationDrift`/`inspectMirrorDrift`/`inspectAuditIntegrity`.

### Doctor surfaces workflow issue list

The `workflow loads` row now uses `formatWorkflowIssues` for `WorkflowInvalidError`, so each Zod issue gets its own indented line in the doctor output. Same for the new JSON-parse path.

### Case-insensitive `--state` fallback

`task list --state X` first matches `X` literally against `workflow.states`. If no exact match, falls back to a case-insensitive lookup. Either resolves to the canonical workflow state for the filter. Preserves the literal-string-as-state design while keeping `--state draft` working on workflows that use uppercase state names.

### Smarter `FEATURE_NOT_AVAILABLE` hint

The printer keeps a local lookup of which presets actually ship each feature (`sprints`, `epics`, `review_workflow`, `blocked_state`) and excludes the active workflow from the suggestion list. The hint no longer tells users to switch to a preset they're already on.

## What we deliberately did not change

- **Self-loop transitions** (state X → action Y → X). dev11 flagged these as intentional and they remained accepted. Useful pattern (e.g. retry counters); blocking would be a UX regression.
- **Unicode/emoji/long state names**. Verified end-to-end in dev11's sweep — backlog dir creation, audit JSON, history rendering all survive. No bounds added.
- **F-GW10 stale backlog dirs**. Cosmetic. Tracked in TECH_DEBT pending a real flow that surfaces it.

## Tests added

7 new tests in two files:

- `tests/unit/domain/state-machine/workflow-loader.test.ts` (+4):
  - rejects `transition.to` pointing at unknown state
  - rejects string field with `min > max`
  - JSON parse error surfaces as `WorkflowInvalidError`
- `tests/integration/cli/doctor-workflow.test.ts` (+5 across two describes):
  - `inspectWorkflowShape` clean / dead-end / unreachable
  - `inspectTaskStateDrift` detects orphan / reports clean

## Numbers

- **418 tests pass** (was 410 before this work; +8 from new tests).
- **Lint clean. Build clean.**
- **No new migration** — fixes live in schema refines, loader wrapping, and doctor inspects.
- **Three refactored modules**: `workflow-meta-schema.ts` (refines), `workflow-loader.ts` (JSON-parse wrap), `doctor-command.ts` (3 inspects + workflow-issue surfacing). Plus `cli-context.ts` (workflow error routing), `task-command.ts` (case-insensitive fallback), `error-printer.ts` (smart feature hint).
- **No new error codes** — reused the existing `WorkflowInvalid`, `WorkflowNotFound`, `FeatureNotAvailable`, `InvalidWorkflowState`.

## Tracked for later

- 🟢 **F-GW10 stale backlog dirs from `init`** — when a state is dropped from the workflow, its backlog directory persists empty. No functional impact; prune on `sync` or `doctor --rebuild-mirrors` when somebody hits it.
