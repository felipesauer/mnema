# Mnema Real-World Test — Final Evaluation (Phase A + Phase B)

**Date**: 2026-05-08 (Phase A) + 2026-05-10 (Phase B)
**Project**: Todo App (Bun + bun:sqlite + TypeScript)
**Sprint**: TODO-SPRINT-1 — **CLOSED**, 8/8 tasks DONE
**Three actors**: felipesauer (PO), Maria Santos (dev2, CLI), Dev Three (dev3, MCP)
**Two run paths exercised**: CLI shell-based (Maria) and MCP in-process (dev3)
**Total time invested**: ~3.5h

---

## TL;DR

Phase A discovered 5 critical/grave bugs blocking 0.2.0-alpha. Phase B (run after fixes shipped in commit `168b47b`) confirmed:

- ✅ **All 4 real bugs fixed end-to-end** (Bug 26 auto-persist, Bug 24 task show, Bug 23 --help, Bug 21 dist clean). Bug 30 was a false positive in the original test method.
- ✅ **MCP path is materially faster** than CLI for agents already aligned with the project — dev3 finished 4 tasks in **3 minutes** vs Maria's ~30 minutes for the same shape of work.
- ✅ **Audit trail captures dual identity correctly** through both paths. Reconstruction works.
- ⚠️ **5 new MCP-specific UX gaps surfaced** (none critical, but worth fixing before public release):
  - `task_show` MCP doesn't include description/acceptance — same shape as Bug 24 was for CLI
  - `assignee_id` schema doesn't document handle-or-UUID acceptance
  - `context_bootstrap.statistics` lacks per-state breakdown
  - `agents_md` payload duplicates the file (~1.4k bytes of waste per call)
  - Errors from gates are structured but the briefing step isn't, leaving agents to discover field semantics by trial

**Recommendation**: ship 0.2.0-alpha now with the 4 critical fixes. The 5 MCP UX gaps map to a tier-2 backlog before any publish-to-public rollout.

---

## Phase B — How dev3 (MCP) compares to Maria (CLI)

### Time and shape

| Metric | Maria (CLI, Phase A) | Dev3 (MCP, Phase B) |
|---|---|---|
| Tasks shipped | 4 (TODO-1..4) | 4 (TODO-5..8) |
| Total time | ~30 min | **2m 49s** |
| Plans declared upfront | 0 (CLI has no equivalent) | 4 |
| Notes added | 4 (one per task) | 0 |
| ADRs registered | 0 | 0 |
| Tests written | 0 | **20** (TODO-7) |
| Tasks ending in IN_REVIEW | 4 | 4 |

**dev3 was ~10x faster.** Some of that is task simplicity (TODO-7 is "write tests" once parsers exist), but the tooling delta is real:

- Maria spent significant time discovering CLI commands via `--help` (Bug 23 affected her).
- dev3 had every tool available with structured input/output — no shell parsing needed.

### What MCP did better

1. **Plans declared up front, automatic state tracking**. dev3's plans show concrete intent ("Reaproveitar TodoRepository.markDone()..."), and `plan_update_state` gave a free progress log without him remembering to add notes.
2. **Atomic JSON I/O** — no scraping `mnema task show` text output.
3. **`task_start` accepting handle (not UUID)** worked transparently after the Bug 26 fix; no collision with the FK constraint.
4. **Audit captured everything**: 8 mutations across the run, all with `actor=dev3`, `via=agent:claude-code`, `run=019e1294...`. `mnema agent inspect <run_id>` reconstructs the work cleanly.

### What MCP did worse / where the friction lives

#### Friction 1 (medium) — `task_show` returns description/acceptance empty for tasks created before fix 168b47b

dev3 saw `description: null` and `acceptance_criteria: []` on TODO-5..8 even though TODO-1..4 visibly had them in his briefing. Cause: those tasks were created and submitted in Phase A *before* the Bug 26 fix shipped. Their `submit` payload validated and went to `transitions.payload`, but never folded onto the row.

**This is not a Mnema bug per se** — it's a one-time data carryover. Tasks created after `168b47b` are fine (verified with TODO-9 smoke). But it does highlight that the fix is forward-only; **a backfill migration could be considered** to walk through `transitions` in chronological order and replay the latest `submit` payload onto each task. Low priority.

#### Friction 2 (medium) — `assignee_id` schema doesn't tell agents handle is OK

The MCP tool schema for `task_start` declares:

```json
"assignee_id": { "type": "string", "minLength": 1 }
```

After fix 168b47b, the server resolves a handle (e.g., `"dev3"`) to the actor UUID transparently. But an agent reading the schema might assume UUID is required and pass something like `"019e1294-..."`, which would also work but is more fragile.

**Fix**: extend the workflow JSON to declare a semantic type (e.g. `"format": "actor-handle"`) and have the MCP schema generator emit `"description": "Actor handle (e.g. 'maria') or UUID"` so agents know.

#### Friction 3 (medium) — `context_bootstrap.statistics` lacks per-state breakdown

```json
"statistics": { "total": 13, "in_progress": 0, "blocked": 0 }
```

dev3 needed to know "what's READY, what's DONE" to plan his work. He resorted to reading the briefing — without that, he would need a separate `tasks_list` call.

**Fix**: extend `statistics` to include `by_state` map. Trivial query, big win for agents. Saves one round-trip on bootstrap.

#### Friction 4 (small) — `agents_md` is duplicated payload

`context_bootstrap` returns the full AGENTS.md inline (~1.4k bytes). The agent has Read tool — it can fetch the file directly when needed.

**Fix**: replace `agents_md` content with `agents_md_path` (relative path) so agents pull it on demand. Or keep both for dumb clients but flag size in docs.

#### Friction 5 (lowest) — happy path validates well, error paths underexercised

dev3 hit zero gate failures because the briefing told him exactly what to pass (`pr_url`, `assignee_id`, etc.). In a real session without briefing, agents would have to discover these by trial — and the MCP error responses, while structured, don't yet point at the workflow JSON or hint format constraints.

**Fix**: when a gate fails, include `available_actions_summary`-like helper text in the error: "submit_review requires `pr_url` (URL format). See `mnema task --help submit_review`."

### What Maria saw that dev3 didn't, and vice-versa

| Issue | Maria (Phase A, CLI) | Dev3 (Phase B, MCP) |
|---|---|---|
| Bug 23 (`--help` empty) | hit hard | irrelevant (uses tool list) |
| Bug 24 (`task show` empty) | hit hard | hit (data carryover, post-fix) |
| Bug 26 (gates not persisting) | hit hard | mitigated (mostly post-fix tasks) |
| Discovery of API | painful (tried `mnema task --help` repeatedly) | smooth (tool catalog visible) |
| `assignee_id` resolution | error if handle | transparent (post-fix) |
| Speed of execution | slow (process spawn × N) | fast (in-process) |
| Code quality | similar (~50 lines/task) | similar |
| Tests written | 0 | 20 |

---

## Updated bug status

### Phase A bugs (verified Phase B)

| # | Severity | Status post-`168b47b` | Phase B verification |
|---|---|---|---|
| 21 | grave | ✅ FIXED | `pnpm pack` ships only 5 migrations now |
| 22 | medium | ⏸ open (parser splits commas) | Maria worked around in A; dev3 didn't trip it because MCP types are explicit |
| 23 | critical | ✅ FIXED | dev3's environment had `--help` showing 24 subcommands. Maria's didn't. |
| 24 | grave | ✅ FIXED | TODO-9 smoke shows description + acceptance + estimate + timestamps |
| 26 | critical | ✅ FIXED forward | TODO-9 persists. TODO-5..8 still empty (data carryover, see Friction 1) |
| 29 | medium | ⏸ open (sprint_* still raw JSON in history) | not touched |
| 30 | n/a | ❌ FALSE POSITIVE | tail-pipe artefact, not a real bug |

### New issues from Phase B (MCP path)

| # | Severity | Where | Description |
|---|---|---|---|
| 31 | medium | `task_show` MCP tool | Same shape as Bug 24 — agent gets null/empty fields for pre-fix tasks; missing `acceptanceCriteria` field type clarity |
| 32 | medium | workflow JSON `requires` schema | `assignee_id` doesn't declare it accepts handle-or-UUID. Agents must read code to know. |
| 33 | medium | `context_bootstrap.statistics` | No per-state breakdown — agents need extra `tasks_list` to plan |
| 34 | low | `context_bootstrap.agents_md` | Inline duplicate of file content. Wastes ~1.4k per call. |
| 35 | low | gate failure errors | Don't carry hint about field types or where to read more |

---

## Phase B-specific wins

✅ **MCP path is the sharper end of the tool**. For agents who already understand the project, MCP is an order of magnitude faster than CLI and gives free progress tracking through plans.

✅ **Plans are useful in practice, not just theory**. dev3's 4 plans have surface-level concrete language ("Reaproveitar TodoRepository.markDone()...") that already auto-documents intent. Reading `agent inspect 019e1294-...` after the fact, anyone can reconstruct what dev3 did and why.

✅ **`task_start` resolution of handle to UUID** (Bug 26 ripple) works seamlessly. dev3's audit shows `assignee_id` resolved to a real UUID without him knowing or caring.

✅ **20 tests written, 0 fail**. dev3 produced real working code — `bun test` runs `.66s`, exits 0, asserts every parser and the repository CRUD.

✅ **`agent inspect` view post Bug-20 fix** shows `task.key` on every mutation line. Run inspector is now genuinely useful for cross-task debugging.

✅ **Audit trail captures dual identity correctly through both paths**:
- Maria's mutations: `actor: felipesauer, via: null` (no agent — direct CLI; CLI doesn't open `agent_run`)

  Wait — actually Maria ran with `MNEMA_ACTOR=dev2`, so her audit lines show `actor: dev2`. Re-checked: `actor` in the audit = the env actor regardless of CLI vs MCP path. The `via` field is what marks "an agent did this", and since the CLI doesn't open MCP run, `via=null` for Maria — which is **wrong** narratively (she was acting as dev2, the human, not as agent — so `actor=dev2, via=null` is correct).

  dev3 went via MCP, so his audit shows `actor: dev3, via: agent:claude-code, run: 019e1294...`. Perfect.

---

## What changed between Phase A and Phase B

Three commits shipped between the phases:

| Commit | What |
|---|---|
| `168b47b` | The 4 fixes (Bug 21, 23, 24, 26) |

(Yes, just one commit. The 4 fixes were bundled.)

After `168b47b`:
- `pnpm pack` cleans `dist/storage/sqlite/migrations/` — verified, 5 stale cleared on rebuild
- `mnema --help` shows 24 subcommands — verified by humans and dev3 had it from the start
- `task show` shows description, acceptance, estimate, assignee, sprint, epic, timestamps — verified on TODO-9
- Gates persist validated payload onto the task row — verified on TODO-9; resolves `assignee_id` handle-to-UUID transparently

---

## Recommendation matrix

### 🔴 Block 0.2.0-alpha public release? — No

The 4 critical/grave bugs are gone. Mnema is now functional end-to-end via both CLI and MCP for the happy path. The 5 new MCP UX gaps are real but none breaks workflow.

### 🟡 Recommended before any public-facing rollout (e.g., README "try it" link)

- **Friction 3** (statistics by state) — trivial query, big agent UX win
- **Friction 4** (agents_md path-not-content) — saves bandwidth, simpler API
- **Friction 5** (gate errors carry hints) — broad polish

### 🟢 Backlog (when uses pile up)

- **Friction 1** (Phase A data carryover): a backfill migration replaying transitions.payload onto tasks
- **Friction 2** (assignee_id schema docs): cosmetic
- **Bug 22** (parseFieldArgs comma split): only matters for CLI users, MCP doesn't hit it
- **Bug 29** (sprint_* JSON in history): cosmetic

### Open question — should `agent_run_*` exist on CLI path too?

Today, only MCP opens `agent_run` and tracks `via`/`run`. CLI mutations have `via=null, run=null`. This is consistent (CLI = human direct), but it means the audit trail looks different depending on path. Question for design: should `mnema task move` accept `--run-id` and `--via` flags so CLI scripts can act on behalf of an agent? Probably yes for tooling integration. **Punt to backlog.**

---

## Final state of todo-app-test

```
Sprint TODO-SPRINT-1 (CLOSED, 8/8 done):
  TODO-1  DONE  Schema (Maria/CLI)
  TODO-2  DONE  Repository (Maria/CLI)
  TODO-3  DONE  add cmd (Maria/CLI)
  TODO-4  DONE  list cmd (Maria/CLI)
  TODO-5  DONE  done cmd (dev3/MCP)
  TODO-6  DONE  rm cmd (dev3/MCP)
  TODO-7  DONE  bun:test (dev3/MCP) — 20 tests passing
  TODO-8  DONE  README (dev3/MCP)

Code shipped:
  src/db.ts                 (Maria)
  src/repository.ts         (Maria)
  src/cli.ts                (Maria + dev3)
  src/commands/add.ts       (Maria)
  src/commands/list.ts      (Maria)
  src/commands/done.ts      (dev3)
  src/commands/rm.ts        (dev3)
  tests/commands.test.ts    (dev3, 20 cases)
  README.md                 (dev3, full quickstart)
  bun test                  → 20 pass / 0 fail in 66ms
  bun run src/cli.ts add "comprar leite" → ✓
  bun run src/cli.ts list                → ✓
  bun run src/cli.ts done 1              → ✓
  bun run src/cli.ts rm 1                → ✓
```

**Functionally**, the Todo App is shippable. **Mnema** survived a full sprint with two contributors via two different paths and a closing review. The audit log is rich enough that someone arriving cold can reconstruct **who** did **what** and **when** without reading code.

The product validates its own thesis.
