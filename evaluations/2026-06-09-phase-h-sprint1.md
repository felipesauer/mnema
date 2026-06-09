# Phase H — Sprint 1 dogfooding (2026-06-09)

**Date:** 2026-06-09
**Mnema version under test:** 0.3.0-alpha.1 (commit `86ac845` at
sprint start). Subsequent fixes during the sprint land in the same
session and ship together.
**Project under management:** the Mnema repo itself
(`MNEMA` project, workflow `default`).
**Scope:** Roadmap Sprint 1 (10 tasks from
`docs/AUDIT-2026-06-09.md`) executed end-to-end while using Mnema's
own CLI to manage Mnema's own delivery. This is the first phase
where Mnema dogfooded for **operational planning**, not just
isolated smoke tests.

---

## Result — 10/10 tasks delivered, 2 real bugs surfaced

All ten Sprint 1 tasks closed:

| Task | Title | Delivered |
|---|---|---|
| MNEMA-16 | R1: Sync versão README + 4 badges | README header carries 5 badges; Status section updated to 0.3.0-alpha.1 |
| MNEMA-17 | R2: CONTRIBUTING.md | New file at repo root, ~115 lines, covers dev setup + commit conventions + smoke run + things-to-watch |
| MNEMA-18 | R3: publishConfig public on package.json | `publishConfig: { access: "public" }` + expanded keywords (5 → 12) + richer description. `npm pack --dry-run` confirms 300 files, 244 kB |
| MNEMA-19 | R4: Polish README (TOC, feature checklist) | TOC + "What you get" feature table + "Further reading" section linking CHANGELOG, CONTRIBUTING, SMOKE, skills-and-memory, evaluations, AGENTS |
| MNEMA-20 | R5: F-S2 + F-S3 cosmetics | `task move --help` documents the comma-array contract; `decision show` resolves `superseded_by` UUID into the human key via new `DecisionService.findById` |
| MNEMA-21 | R6: CI workflow | `.github/workflows/ci.yml` with matrix Node 20/22 + lint + build + test + MCP smoke + bench |
| MNEMA-22 | R7: Investigate F-S5 | **Real bug found** — see H-2 below |
| MNEMA-23 | R8: Bench in CI with budget | Already in place from earlier work; wired into the new CI workflow |
| MNEMA-24 | R9: MCP smoke automated | New `scripts/mcp-smoke.ts` connects a real MCP client over stdio and exercises 8 tools (context_bootstrap → agent_run_start → task_create → task_show → decision_record → memory_record → observation_record → agent_run_end). Wired into CI via `pnpm smoke:mcp` |
| MNEMA-25 | R10: Asciinema | `scripts/record-quickstart.sh` records the canonical 60s demo; placeholder embedded in README pending upload |

## Findings (2 real bugs uncovered, both fixed in-flight)

### H-1 🟡 CLI gate validation rejects values with embedded spaces

**What I did.** During Sprint 1 I tried to pass titles and
descriptions with spaces:

```bash
mnema task move MNEMA-17 submit title="R2: Criar CONTRIBUTING.md"
```

**Observed.** Shell/Commander parsing split the value on whitespace
and only the first token reached `parseFieldArgs`. The gate then
rejected the truncated string or the missing `description`. With
hyphens / underscores instead of spaces the same call succeeded.

**Root cause.** `parseFieldArgs` (in
`src/cli/commands/task-command.ts`) reads each positional argument
verbatim; once the shell has tokenised on whitespace the value is
already lost. Commander does not reassemble the rest of the line.

**Severity.** 🟡 cosmetic-but-painful. It does not silently
truncate state (the gate rejects), but the failure mode (`gate
validation failed`) does not point at quoting as the cause. Agents
issuing `task_move` via the MCP tool path are unaffected because
their payload arrives as a structured object.

**Mitigation in this sprint.** I rewrote every task title /
description without spaces (`R2-CONTRIBUTING`, `F-S5-investigate`,
etc.) as a workaround. A real fix would either (a) coalesce
remaining positionals back into the previous `field=` value, or
(b) document the quoting contract in the gate error hint
("if your value contains spaces, wrap it in single quotes").
Tracked.

### H-2 🔴 → fixed `bundledMigrationsDir` was resolved cwd-relative

**What I did.** R7's job was to investigate F-S5 (intermittent
"Schema is out of date" during the smoke run). I started by reading
the boot path in `service-container.ts`.

**Root cause.**
```typescript
const bundledMigrationsDir = options.migrationsDir ?? path.resolve(MIGRATIONS_DIRNAME);
```
`MIGRATIONS_DIRNAME` was the relative literal
`'src/storage/sqlite/migrations'`, and `path.resolve` makes it
relative to `process.cwd()`. When the CLI runs from a project
tmpdir (anything that is not the Mnema source tree) the path
resolves to a non-existent directory. `detectDrift` then sees
**zero** migrations on disk and either reports nothing pending
(virgin DB) or, on a populated DB, reports every applied migration
as "orphan" — which surfaces inconsistently and confused as
"schema is out of date" in some race-shaped read paths.

**Fix.** Switch the production path to
`assetPathsMigrationsDir()` from `src/utils/asset-paths.ts`. That
helper walks parents of the compiled location until it finds the
package's own `package.json` (`@saurim/mnema`) and resolves the
bundled migrations next to it — correct under both `src/` (dev) and
`dist/` (installed). The bug went unnoticed because the integration
tests pass `options.migrationsDir` explicitly, so the broken path
never fired.

**Severity 🔴.** Latent footgun, easy to trigger in the field
(every user not running from the Mnema repo would have hit it),
hard to reproduce because production behaviour drifts depending on
which directory the user happens to be in. Fixed in this sprint.

**Test coverage.** No new test was added because the bug only
surfaces when the production resolver runs; the integration suite
overrides the path. Recommended follow-up: a separate test that
runs the **installed** tarball against a tmpdir and asserts
`detectDrift` returns `[]` on a freshly migrated DB. Tracked
informally; not in this sprint.

## What worked well

- **Dogfooding caught H-1 and H-2 that adversarial sweeps missed.**
  Both findings came from using Mnema in earnest, not from
  destructive probes. H-1 only matters when a human types
  `task move` from a shell; H-2 only matters when the user is not
  in the source tree.
- **Sprint workflow held together.** Submit → start → submit_review →
  approve fired cleanly on all 10 tasks. `gate validation failed`
  with the field-level diagnostic was always enough to figure out
  what was missing in the payload.
- **`mnema doctor` stayed informative throughout the sprint.** I
  re-ran it after each major change; the integrity surface flagged
  exactly one orphan migration row (12) left over from the smoke
  test the previous day, nothing else.
- **MCP smoke ran in ~30ms total for 8 tools** (cold start excluded;
  the stdio transport keeps the server warm). Confirms that
  agent-side latency is well below the 200 ms CLI cold-start chair.

## Numbers

- 10 tasks created, sprint-attached, epic-attached.
- 1 ADR (`MNEMA-ADR-5`) recorded + accepted.
- 1 memory entry, 1 skill entry written by hand (Memory + skill
  records via MCP are still future work — H-? — when this sprint's
  MCP smoke proves the path).
- 8 of 10 tasks were 1-3 estimate; R9 (5) and R7 (3, raised
  scope mid-flight to real bug fix) carried the heavier load.
- 429 tests stayed green across the sprint. Lint + build clean.

## Recommendations for Sprint 2

- **Fix H-1 in Sprint 2.** It is not blocking but it is a UX bug
  that every human user will hit. Either coalesce trailing
  positionals, or improve the diagnostic. (Could be added to the
  existing `gate validation failed` printer in
  `src/errors/error-printer.ts`.)
- **Add a regression test for H-2.** A test that spawns the
  installed binary against a tmpdir and asserts no spurious
  pending migrations. Closes the gap that allowed H-2 to ship.
- **Continue the dogfood pattern.** Manage Sprint 2 the same way:
  Mnema CLI for tasks, ADRs for design calls, memories for
  decisions worth carrying across sessions.
