# Phase B' — Evaluation (kanban workflow + cv-fmt CLI + dev4 via MCP)

**Date**: 2026-05-10
**Project**: cv-fmt — markdown→HTML→PDF CV formatter
**Workflow**: **kanban** (5 states: BACKLOG → READY → IN_PROGRESS → BLOCKED → DONE)
**Actors**: felipesauer (PO, planning) + dev4 (MCP, implementation)
**Stack**: Bun + marked + puppeteer-core + @sparticuz/chromium + zod
**Run id**: `019e12ae-fa1e-759e-b5a3-671a1933d603`
**Time**: ~45min implementation + ~10min planning + ~5min review

---

## TL;DR

Phase B' validated the **MNEMA-14 polish (commit `4508940`)** in a fresh project with a workflow that had **never been exercised** (kanban). All 8 tasks shipped; 13/13 tests pass; PDF generates correctly.

The fixes from MNEMA-14 (statistics.by_state, agents_md_path, gate hints, assignee schema) **all delivered measurable value** — dev4 specifically credited `statistics.by_state` for "immediate confidence that the backlog matched the briefing". `assignee_id` resolution still works transparently after the schema description tweak.

But the run also surfaced **6 new friction points specific to the MCP path** (none blocking), and **1 unintended side-effect** of the Bug 26 fix. Plus **gate hints (Friction 5 from MNEMA-14) couldn't be validated organically** because kanban's gates are minimal — I forced gate failures manually after dev4 finished and confirmed the hints fire, but agents won't trip them naturally on this workflow.

---

## What worked (validating MNEMA-14)

✅ **`statistics.by_state` (Friction 3 fix)** — dev4 said: "extremely useful. Seeing READY:8 at the start gave immediate confidence the backlog was as described, without listing and counting by hand. More useful than the bare total/in_progress/blocked summary."

✅ **`agents_md_path` (Friction 4 fix)** — "good pointer — I didn't need to open the file (it came embedded in agents_md), but the explicit path is important when the content is large."

✅ **`assignee_id` accepting handle (Friction 2 fix)** — "I passed `dev4` directly and it worked. The server resolved to UUID `019e12b0-...`. The schema description could spell it out further, but it wasn't a blocker."

✅ **Gate hints (Friction 5 fix)** — verified manually post-run: forcing `mnema task move CVF-9 start` (no `assignee_id`) produces:
```
error: Cannot start CVF-9: gate validation failed
  - assignee_id: Invalid input: expected string, received undefined
hint: Add the missing fields and try again
  · assignee_id accepts an actor handle (e.g. `maria`) or a UUID
```
The bullet hint after the generic line is the new piece. Works. Other fields (`title`, `reason`) don't have hints yet — proposital scope: only the 4 most semantic-loaded fields were annotated. Easy to expand later.

---

## What worked across the board (existing fixes)

✅ **Bug 21 fix** confirmed: `pnpm pack` ships 5 migrations clean, no leftover stale files.
✅ **Bug 23 fix** confirmed: `mnema --help` lists all 24 subcommands in this fresh install.
✅ **Bug 24 fix** confirmed: `mnema task show CVF-1` shows description, acceptance criteria, estimate, and timestamps from the moment of creation.
✅ **Bug 26 fix forward-applied**: dev4's `task_start` calls correctly resolve handles; `task_complete` (no payload) correctly does no-op on persistence.

---

## New friction points (Phase B' findings)

### B'-1 (medium) — `task_move` with persisted gate fields can mutate task attributes inadvertently

**Discovered during planning, not by dev4.** Kanban's `promote` action requires `title` in the payload. After the Bug 26 fix, that `title` is *also* persisted onto the task — so promoting with a different (or shorter) title silently overwrites the original.

**Repro**:
```bash
mnema task create --title "Schema Zod do CV (nome, email, sections)"
# CVF-1 created with full title
mnema task move CVF-1 promote "title=Schema Zod do CV"
# CVF-1 now has truncated title — silently
```

**Why it happened**: `parseFieldArgs` (Bug 22) split the comma-bearing title into an array, gate rejected, I retried without commas. The retry shortened it. Auto-persist doesn't distinguish "user wants to update title" from "gate happens to require title field".

**Severity**: medium. The audit log still has the old title in `task_created.data.title`, so reconstruction works. But the task row itself silently loses information.

**Fix candidates**:
- Workflow JSON declares which gate fields are *mutating* vs *validating*.
- Auto-persist skips fields whose payload value matches the existing column value (no-op detection — but text comparison is fragile for arrays).
- Or: only auto-persist when the column is currently `null` / empty (already does for tasks created without those fields, but mutates pre-filled ones).

**Recommendation**: tier-3 backlog. Workaround: don't pass fields you don't want to change.

---

### B'-2 (medium) — `agent_plan_create` lacks task_key linkage

dev4 reported: *"the plans are loose in the run. I ended up putting `CVF-N: ...` in the content for manual mapping. In retrospect, when the run has 8 plans each corresponding to a task, being able to declare `{ task_key: "CVF-1", content: "..." }` and have the link appear in the audit would be valuable."*

**Fix proposal**: optional `task_key` field on `agent_plan_create`. When present, store as a soft FK and surface in `agent_inspect` mutations table as cross-reference. Backwards-compatible — old plans without the field render exactly like today.

**Severity**: medium. Affects scaling (10+ plan runs) more than 4-plan runs. Worth doing before public release.

---

### B'-3 (medium) — `agent_plan_update_state` only accepts `plan_id` UUID

dev4: *"create returns a giant UUID. I had to track 8 UUIDs in parallel and reference them manually. Accepting `position` or `task_key` as alternative identification would reduce overhead."*

**Fix proposal**: union type for the identifier — `{ plan_id }` OR `{ run_id, position }` OR `{ run_id, task_key }` (paired with B'-2 fix). Server picks the unique one; errors if ambiguous.

**Severity**: medium. Same boat as B'-2 — annoying at scale, manageable at small N.

---

### B'-4 (low) — Lack of "preview transition" / `task_show_available_actions`

dev4: *"task_start/task_complete mutate directly. In kanban without review, that's OK, but if I called task_start by mistake on the wrong task, there's no undo — only reopen+reblock. Consider task_show_available_actions(task_key) to confirm before mutating."*

**Counter-argument**: `context_bootstrap` already returns `available_actions_summary` (workflow-wide). For per-task: the available actions only depend on `task.state`, which `task_show` already returns. Agents could compute it locally if they have the workflow info. So this is more "convenience helper" than "missing capability".

**Severity**: low. Punt to backlog.

---

### B'-5 (low) — `tasks_list` lacks ordering and filter-by-assignee

dev4: *"For a project at scale, listing returns everything and the agent has to sort by key client-side. Will hurt at 100+ tasks."*

**Fix proposal**: add optional `assignee_id`, `state`, `sort` fields to the tool input schema. Underlying SQL already supports it (`tasks.findByAssignee` exists), just not exposed via MCP.

**Severity**: low for now (Mnema is alpha; nobody has 100+ tasks yet). But it's a 30-min fix and improves the public API.

---

### B'-6 (low) — No `task_update` or scope-change note kind

dev4 used `note_add({ kind: "agent_observation", content: "..." })` to log scope deviations. He suggested `kind: "scope_change"` or `kind: "acceptance_addendum"` for stronger semantics.

**Counter-argument**: `note_kind` enum is workflow-orthogonal (notes apply to all workflows); adding more kinds dilutes the existing taxonomy. Convention via `agent_observation` content prefix ("[scope-change] ...") is cheaper.

**Severity**: low. Punt indefinitely unless multiple users ask.

---

### B'-7 (trivial) — `task_complete` description doesn't say "no extra fields"

dev4 had to discover empirically that `task_complete` accepts `{}` (no payload beyond `task_key`). The tool description doesn't mention it.

**Fix**: add to the auto-generated tool description a hint when `requires` is empty: *"This action has no required fields beyond `task_key`."*

**Severity**: trivial. ~5 lines in `transition-tools.ts`.

---

## Comparison: Maria (CLI default) vs dev3 (MCP default) vs dev4 (MCP kanban)

| Metric | Maria (Phase A) | dev3 (Phase B) | dev4 (Phase B') |
|---|---|---|---|
| Workflow | default | default | **kanban (new)** |
| Path | CLI shell | MCP | MCP |
| Tasks | 4 | 4 | **8** |
| Time | ~30 min | 2m 49s | ~45 min |
| Plans declared | 0 | 4 | 8 |
| Notes added | 4 | 0 | varies |
| Gate failures hit | several | 0 | 0 |
| ADRs registered | 0 | 0 | 0 (pre-existing 3) |
| Tests written | 0 | 20 | **13** |
| Fields persisted post-submit | ❌ Bug 26 active | ✅ post-fix | ✅ post-fix |
| --help works | ❌ Bug 23 active | ✅ post-fix | ✅ post-fix |
| Stack chosen | bun:sqlite | bun:sqlite | marked + puppeteer + zod |
| End-to-end runs | yes | yes | yes (PDF generated) |

**Observation**: dev4's 45min vs dev3's 2m49s is largely **task complexity** (PDF generation involves Chromium download, real Puppeteer integration, Zod schema design). The Mnema overhead per task is likely similar (<10s per state transition). Path-relative cost is small in both.

**Workflow comparison**: kanban felt **lighter than default** for this kind of project. No review state means dev4 self-completed without `submit_review/approve` ceremony; for solo or trust-first contexts, this is preferable. Default's review path remains valuable for team scenarios.

---

## Recommendations

### Bumping for 0.2.0-alpha public release?

**Yes.** Phase B' confirmed the polish from MNEMA-14 lands well. The 6 new frictions are all **non-blocking**. Mnema is shippable.

### What to do *before* the bump

| Friction | Cost | Value | Recommendation |
|---|---|---|---|
| B'-7 (`complete` description) | ~5 lines | small but visible | **Do it now** |
| B'-2 (plan↔task link) | 30-60min + tests | high for multi-task runs | **Do it now** if budget allows |
| B'-3 (plan_update_state by position) | 1-2h | medium-high | Wait for B'-2 first; couples with it |
| B'-1 (mutation distinct from validation) | 2-3h, design-heavy | medium | Tier-3 backlog |
| B'-4 (preview transition) | 30min | low | Tier-3 |
| B'-5 (tasks_list filters) | 30min | low for alpha | Tier-3 |
| B'-6 (note kinds for scope) | by convention | trivial | Won't fix |

### After the bump

- Watch how real users find more bugs (this is what alpha is for).
- Consider adding kanban to default doc paths so users know it's a viable preset.

---

## Code shipped

```
cv-fmt-test/
├── src/
│   ├── schema.ts       (Zod schema for CV)
│   ├── parser.ts       (marked.lexer → CV object)
│   ├── template.ts     (HTML + CSS embedded)
│   ├── renderer.ts     (HTML serialization)
│   ├── pdf.ts          (puppeteer-core PDF gen)
│   └── cli.ts          (argv parsing, validate/build)
├── tests/cv-fmt.test.ts (13 tests, all pass)
├── examples/sample.md
└── README.md (quickstart)

Smoke:
  bun run src/cli.ts validate examples/sample.md → exit 0
  bun run src/cli.ts build examples/sample.md --out cv.pdf → PDF 1.4 valid
  bun test → 13 pass / 0 fail / 50ms
```

Functionally shippable. Audit trail (`mnema agent inspect 019e12ae-...`) reconstructs the full work for review.

---

## Phase B' verdict

**Mnema's MCP path is production-ready for alpha consumption.** The 6 frictions identified are real but minor; B'-2 and B'-7 are worth fixing before the public bump (1-2h total). The remaining 4 are tier-3 polish.

**The validation experiment confirms the thesis**: an agent with no prior context (dev4) ships 8 tasks in 45 minutes through MCP, with a complete audit trail that an auditor (felipesauer) can reconstruct entirely from `mnema agent inspect` + `mnema task history`. Two contributors on two paths (CLI/MCP) on three projects (Mnema/Todo/cv-fmt) on three workflows (lean/default/kanban) all produce coherent, queryable history.
