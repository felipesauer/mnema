# Phase H — Sprint 2 dogfooding (2026-06-09)

**Date:** 2026-06-09 (same day as Sprint 1 + smoke + Sprint 2 — high-throughput session).
**Mnema version under test:** 0.3.0-alpha.1 (commit `9e0812f` at sprint start).
**Project under management:** the Mnema repo itself (`MNEMA` project).
**Scope:** Sprint 2 + the two Phase H findings (H-1 + H-2) surfaced
during Sprint 1 dogfooding. Six tasks closed: 2 from the deferred
Phase H list, 4 from the Sprint 2 roadmap.

---

## Result — 6/6 tasks delivered

| Task | Title | Delivered |
|---|---|---|
| MNEMA-36 | H-1: CLI gate quoting | New `-f/--field name=value` flag on `task move` + E2E test for embedded spaces. Positional form kept for backward compat. |
| MNEMA-37 | H-2: regression test installed-tarball | New `tests/integration/cli/production-resolver.test.ts` spawning `dist/index.js` from a tmpdir + `tests/unit/utils/asset-paths.test.ts` pinning the resolver contract. 6 new tests. |
| MNEMA-26 | R11: design call multi-project | Parallel-workflow research evaluating 1-DB / N-DBs / paths-multiplex; `docs/multi-project-design.md` + `MNEMA-ADR-6` (accepted) commit to paths-multiplex for v1. Estimated 1.5 weeks of impl work tracked for Sprint 4+. |
| MNEMA-27 | R12: performance pass | Investigated cold-start floor (~155ms range 153-165ms). WAL already on; sub-120ms not achievable without esbuild/tsdown bundling or container splitting — both outside alpha. Budget locked at 200ms with documented floor analysis in `bench/cli-bench.ts` and `docs/TECH_DEBT.md` §5. |
| MNEMA-28 | R13: coverage gate 70% | `vitest.config.ts` thresholds 75/65/85/78 enforced; baseline 78.22% statements after excluding CLI command modules (covered by E2E that v8 can't trace through subprocess). New `Coverage gate` CI job on Node 22. |
| MNEMA-29 | R14: Phase H 2-week plan | `docs/PHASE-H-PLAN.md` — day-by-day skeleton, daily journal template, exit criteria, standing instructions. Execution unfolds over the next 14 calendar days. |

## Findings (1 real H-finding investigated + 1 design decision)

### H-1 → fixed

Investigation via parallel workflow surfaced the exact root cause:
the shell tokenises `title="R2: foo"` into 3 args before Commander
sees them, and `parseFieldArgs` only matches the `field=...` ones,
silently dropping `Add` and `CONTRIBUTING.md`. Fix landed as Option
C-prime: keep the positional form (backward compat) and add
`-f/--field name=value` for the shell-quoting-friendly path.
Sub-agent originally recommended Option B (full `--flag <value>`
migration) but it was wrong for Mnema's case: fields are dynamic
per workflow, so they can't be enumerated as discrete Commander
options. The hybrid is the right shape.

### H-2 → fixed

Investigation pointed at `service-container.ts:135` — `bundledMigrationsDir`
was resolved via `path.resolve('src/storage/sqlite/migrations')`,
which is cwd-relative. Fix already landed during Sprint 1 (commit
`9e0812f`); this sprint adds the regression test that should have
caught it: spawn `dist/index.js` from a tmpdir and assert `doctor`
reports the full migration set. Two new tests, both passing.

### R11 design — paths-multiplex chosen

Three architectures evaluated in parallel by sub-agents:

| Strategy | Effort | Verdict |
|---|---|---|
| 1-DB-N-projects | ~12h | Smaller refactor but introduces audit-privacy bleed + service-layer filter retrofits + write contention. |
| Global N-DBs (`~/.config/mnema/workspaces.json`) | 3-4 weeks | Polyrepo-friendly but heavy config plumbing. |
| **Paths-multiplex (`mnema.workspace.json` at monorepo root)** | **1-1.5 weeks** | **Reuses existing per-project ServiceContainer; matches Nx/Yarn/Bazel mental model; defers federation honestly.** |

ADR-6 commits to paths-multiplex. Schema unchanged (workspace_config
table already accepts `mode='single'|'multi'`); CLI gains
`mnema workspace init|add|list` + `--all` flag on read commands.
Implementation deferred to Sprint 4+ pending other priorities.

## Numbers

- 436 tests pass (was 429; +7 from H-1 E2E + H-2 integration/unit).
- Coverage baseline measured + enforced: 78.22 / 67.34 / 87.79 / 80.47
  (statements / branches / functions / lines).
- Lint + build clean.
- 4 ADRs accepted today: MNEMA-ADR-5 (Sprint roadmap), MNEMA-ADR-6
  (multi-project paths-multiplex), plus the two from Sprint 1 phase.
- 1 new design doc, 1 new plan doc, 1 new eval doc.
- 2 parallel workflows kicked: one for H-1+H-2 investigation, one for
  multi-project architecture comparison. Both fed concrete recommendations
  the in-session work then implemented.

## What worked well

- **Parallel investigation workflows.** Spawning two workflows
  (H-1+H-2 and multi-project research) while I worked on tasks
  in-band gave me precise root-cause analyses before I touched
  the code. Saved guessing iterations; the multi-project synthesis
  alone would have taken a day if done sequentially.
- **`mnema task move --field` flag works first try.** Shell delivers
  `--field "title=foo bar"` intact; `parseFieldArgs` sees the whole
  `name=value` string. E2E test passes. No more underscore
  workarounds for upcoming tasks.
- **Coverage exclusion list matches reality.** Once CLI commands and
  instrumentation-only files came out, the in-process suite's 78%
  reflects what's actually tested. The previous 60% was misleading.

## What hurt

- **`mnema sprint show` doesn't show estimate totals.** Knowing
  "6 tasks × points total" would help capacity planning. (Minor
  feature gap; tracked informally.)
- **No way to see Sprint progress %.** I had to read each task to
  know what was done vs in-progress. (Same minor gap.)
- **Coverage report misleads on CLI files** until you exclude them.
  Future contributors will hit the same confusion. Worth a comment
  in the vitest config explaining (already added).

## Recommendations for Sprint 3 (or Phase H)

- **Use Phase H to drive the Sprint 3 ADRs** instead of executing
  Sprint 3 monolithically. The `docs/PHASE-H-PLAN.md` skeleton is
  built for that.
- **Defer R15 npm publish until Phase H wraps** — every day of
  dogfooding could surface a packaging blocker.
- **Sprint 4 candidate:** implement multi-project mode following
  the ADR-6 design. If Phase H produces multi-repo friction, this
  jumps in priority.
