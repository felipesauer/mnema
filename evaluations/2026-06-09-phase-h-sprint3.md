# Phase H — Sprint 3 design pass (2026-06-09)

**Date:** 2026-06-09 (continuation of the high-throughput session
that closed Sprints 1 + 2 + smoke earlier in the day).
**Mnema version under test:** 0.3.0-alpha.1 (commit `b44e82e` at
sprint start).
**Project under management:** the Mnema repo itself.
**Scope:** Sprint 3 (R15-R20) — npm publish gate + design specs
for the five long-tail features. None of R16-R20 ships code in
this sprint; each produces an ADR + design doc that freezes the
architecture so the implementation has a target. R15 ships a real
gate script that the PO can run before authorising `npm publish`.

This eval doc compresses what the Phase H day-by-day plan
(`docs/PHASE-H-PLAN.md`) expected to take ~14 calendar days into
one session, because Sprint 3 was design-heavy and the design
work could be batched without losing signal. The 14-day window is
**not** used here; the calendar slot is freed for whichever R16-R20
the PO decides to actually implement next.

---

## Result — 6/6 tasks delivered, 5 ADRs accepted

| Task | Title | Output |
|---|---|---|
| MNEMA-30 | R15: npm publish gate | `scripts/publish-check.sh` runs 13 automated checks (build/lint/test/coverage/bench/mcp-smoke/tarball/files/migrations/workflows/publishConfig/resolver). `pnpm publish:check` script wired. `docs/RELEASE.md` expanded into a complete pre-publish checklist with rollback path. Status: all 13 checks green for v0.3.0-alpha.1. |
| MNEMA-31 | R16: VS Code extension | `docs/VSCODE-EXTENSION-DESIGN.md` + `MNEMA-ADR-7`: read-only, sql.js + chokidar direct, no bundled CLI, separate repo. Estimated 1.5-2 weeks impl. |
| MNEMA-32 | R17: Web dashboard | `docs/DASHBOARD-DESIGN.md` + `MNEMA-ADR-8`: localhost-only Fastify, reads SQLite directly, mutations route via spawned `mnema mcp serve` over stdio. React SPA bundled under `dist/dashboard/`. Estimated 2.5-3 weeks. |
| MNEMA-33 | R18: Multi-MCP server | `docs/MULTI-MCP-DESIGN.md` + `MNEMA-ADR-9`: hard-blocked on ADR-6 (paths-multiplex). Once that lands, add `mcp_servers` table, FS-suitability probe (refuses NFSv3 / sshfs / cloud-sync), crash-recovery JSONL replay. Estimated 2 weeks post-ADR-6. |
| MNEMA-34 | R19: GitHub two-way sync | `docs/GITHUB-SYNC-DESIGN.md` + `MNEMA-ADR-10`: poll-based (5 min interval), `since=` cursor, one-way state outbound only on terminal transitions. New `github_sync_state` table + `tasks.github_issue_id` column (migration 012). F-F12 (`--api-base`) prerequisite. Estimated 2 weeks. |
| MNEMA-35 | R20: Plugin system | `docs/PLUGIN-SYSTEM-DESIGN.md` + `MNEMA-ADR-11`: ABI-versioned (`minAbi`), observe-only (no gating), fires post-audit-commit non-blocking, `plugin_invoked` events join the chain. New `plugins` + `plugin_runs` tables (migration 013). Estimated 2 weeks. |

## Findings (no real bugs, but a few dependency chains surfaced)

### H-3 — ADR dependency chain mapped

The five long-tail features form a clear dependency graph:

```
ADR-6 (paths-multiplex, accepted Sprint 2)
   │
   ├──▶ ADR-9 (multi-MCP server) — hard blocker
   │
   └──▶ ADR-7 (VS Code extension) — soft dep (multi-project picker waits)
        ADR-8 (web dashboard) — soft dep (workspace switcher waits)

F-F12 (GitHub --api-base for testing, tracked in TECH_DEBT §8)
   │
   └──▶ ADR-10 (GitHub two-way sync) — hard blocker

(independent)
   ADR-11 (plugin system) — no deps; can ship anytime after the ABI stabilises
```

This explains why ADR-9 lists the longest "wait" estimate
(2 weeks **after** ADR-6 ships). If the PO picks one to implement
next, the recommendation order is:

1. **ADR-11 (plugin system)** — independent, smallest blast
   radius, opens an ecosystem story.
2. **ADR-7 (VS Code extension)** — soft-deps only; valuable on
   its own; gives the project a visible artifact.
3. **ADR-10 (GitHub sync)** — needs F-F12 first (small) then
   2 weeks.
4. **ADR-8 (web dashboard)** — biggest scope, soft-deps;
   probably after VS Code extension proves the read-only pattern.
5. **ADR-6 implementation** (multi-project mode) — opens ADR-9
   but requires its own 1.5 weeks first.
6. **ADR-9 (multi-MCP)** — last; depends on everything above
   except 10 + 11.

### H-4 — publish-check script bug caught in-flight

While building `scripts/publish-check.sh` I hit a `set -e + grep
-q` interaction: when `grep -q` returns 1 inside a `for/if-then`
under `set -euo pipefail`, the loop continues but the shell
treats the next `fail` as a "real" early exit and the message is
misleading (claimed README.md was missing when it was present —
the tar | grep pipeline was being eaten by the shell). Fixed by
capturing the tar output into a variable first, then grepping
the variable inside the loop. Trivial bug, instructive
reminder that bash `set -e` is sharper than it looks.

## What worked well

- **ADR-first design batching.** Producing all five specs in one
  session worked because they share architectural primitives
  (SQLite + audit chain + MCP server). Cross-cutting decisions
  (read-only vs read-write, post-commit vs in-transaction, polling
  vs webhooks) get the same answer applied consistently across
  ADR-7/8/9/10/11.
- **`publish:check` caught a real config thing immediately.** The
  initial run flagged that `publishConfig.access` had to be
  `'public'` (R3 from Sprint 1 already shipped that, but the
  script confirmed it; would have surfaced any drift instantly).
- **Mnema gerencia Mnema** continues to be honest. 6 tasks
  through submit → start → submit_review → approve in this
  sprint alone; combined with Sprint 1 and 2 the project's own
  audit log carries 96+ events; the kanban for Sprint 3 is the
  project itself.

## What hurt

- **No `--field name=value` on `decision record`.** The H-1 fix
  shipped on `task move` but `decision record` still uses
  positional `--option <value>` flags, which works (decisions go
  through Commander's `--flag <value>` form already). However,
  multi-line `--decision` / `--rationale` / `--consequences`
  text wrapped to fit shell quoting needs continued care. Not a
  bug; a UX note.
- **`mnema sprint show` doesn't show estimate totals or
  progress %.** Already noted in Sprint 2 eval; surfaces again
  here as a real friction when reviewing Sprint 3 status mid-way.
  Tracked informally.

## Numbers

- **6 tasks** delivered (R15-R20).
- **5 ADRs accepted** (MNEMA-ADR-7 through MNEMA-ADR-11).
- **5 design docs** written under `docs/` (gitignored).
- **1 new script** + 1 new package.json command (`publish:check`).
- **13/13** publish-readiness checks green on the v0.3.0-alpha.1
  tarball.
- **436 tests** still passing (no test changes in this sprint —
  it was design-only outside R15).
- Lint + build clean.
- **3 sprints closed** total (Sprint 1, 2, 3 all CLOSED).

## Recommendations for Sprint 4

- **Sprint 4 = one implementation pick.** The 5 long-tail
  features each carry 1.5-3 weeks of impl work; doing more than
  one per sprint dilutes signal and review attention.
- **Likely picks, in priority order:**
  1. ADR-11 plugin system (independent, smallest scope)
  2. ADR-7 VS Code extension (separate repo, visible artifact)
  3. ADR-6 implementation (unblocks ADR-9 + ADR-7 multi-project)
- **Defer `npm publish`** until at least one ADR ships as code.
  Publishing now would be honest (the alpha is feature-complete)
  but every alpha day adds defensive value before going public.

## Outstanding work

- **Phase H "execution"** as originally scoped (14 calendar days of
  R15-R20 design) is now collapsed into this single session. The
  daily-journal cadence does **not** need to run separately. If
  Sprint 4 implementation work surfaces new friction, fold it
  into a new evaluations/<DATE>-phase-h-sprint4.md.
- **`docs/PHASE-H-PLAN.md`** can be archived (rename to
  `docs/PHASE-H-PLAN-original.md`) once Sprint 4 kicks off.
