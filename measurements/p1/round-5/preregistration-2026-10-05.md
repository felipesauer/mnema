# Round 5 — pre-registration

**Frozen on 5 Oct 2026, before the round's first cell.** The commit that adds this file is the
date: everything it names — the tasks by [digest](fixtures.sha256), the [split](split.json), the
reading below and the analysis code — is fixed from that commit on, and any of them edited after
the first cell of this round exists invalidates the round (§8). No cell of this round has been run
when this is written; nothing below is a result.

This round keeps the promise of [`../protocol.md`](../protocol.md) and asks a narrower question
than rounds 1 to 4 could: what happens when the record and an instructions file hold **the same
history**, and part of that history was **replaced**.

## 1 · The question

> When the same decisions are written both in an instructions file the host loads by itself and in
> the record — and one of them was superseded by a later one — does the agent that is handed the
> record follow the decision in force more often than the agent that is handed the file?

## 2 · The arms

Six arms. The four that hold decisions hold **the same history** — every decision, the replaced one
included, and the fact that it was replaced. What differs is what each one HANDS OVER, and that
difference is the mechanism under test, not an accident of the seed.

| code | arm | holds | how it reaches the session |
|---|---|---|---|
| E1 | `base` | nothing | — |
| E2 | `claude-md` | every decision verbatim, in order, in a committed `CLAUDE.md`; a replacement carries one line under its title, `**Supersedes:** <title of the replaced decision>` | the host loads the file by itself |
| E3 | `host` | the host's own auto-memory: one file per decision and a `MEMORY.md` index line for each; the replacement's file opens with the same `**Supersedes:**` line | the host loads the index by itself |
| E4 | `mnema-doc` | a mnema record: every decision accepted, the replaced one then superseded by the product's own verb, each addressed (`--rel governs`) at the path the task says it governs; the per-edit push switched off (`edit-rules-push`, private) | the opening document, at `SessionStart` |
| E5 | `mnema+` | the same record, the push on | the opening document, and the rules addressed at a file beside the result of each write to it |
| E6 | `mnema-gate` | the same record as E5, with the hold on the first write switched on (`edit-first-write-gate`, private) | as E5, and the first write of the session to a governed file does not happen: the rules come back as its reason, and the same write repeated goes through |

**E6 is exploratory.** It runs on two families only (§4), and no hypothesis below reads it: its
cells are published with the others and read as description. It is the hold on the FIRST write and
not a `refuses-a-write` address, which was measured as the other way the product stops a write and
not taken — with the stand-in, a rule linked `refuses-a-write` at the file refuses the second write
exactly as the first, so the file the ticket asks for could not be written with the tools the hook
covers, and the arm would measure how agents work around a refusal.

**What reaches the model is declared and checked, not assumed.** The preflight runs the real host
against a stand-in API for every (task, arm) pair and reads its first request — and, for the arms
that carry the surface, the request after a scripted first write to the file the ticket names. The
declaration it is checked against, in both directions:

| arm | at the opening, a decision **in force** | at the opening, a **replaced** decision | at the first write to the governed file |
|---|---|---|---|
| E1 `base` | nothing | nothing | nothing |
| E2 `claude-md` | title, statement, reasoning, alternative — all of it | all of it | — |
| E3 `host` | the title and the first words of the statement | the same | — |
| E4 `mnema-doc` | the title | nothing | nothing |
| E5 `mnema+` | the title | nothing | the title of each decision in force addressed there, beside the result |
| E6 `mnema-gate` | the title | nothing | the same title, as the reason the write was refused; the repeat goes through |

A decision addressed somewhere else arrives at no write. The mnema arms hand over **titles**: the
statement of a decision is one `read_record` away, and whether the agent asks is part of what the
round measures. The preflight proves what the host PUTS in a request, never that a model read it.

## 3 · The tasks

Forty-seven new tasks, written for this round, frozen by digest and held out until used. Each holds
its history in `decisions/` — the decisions in order, which one replaces which, and the path each
governs — and is scored by its own discriminant with **four** words, by running the code the agent
left:

| verdict | exit | meaning |
|---|---|---|
| `CONFORMS_CURRENT` | 0 | the decision in force was followed |
| `FOLLOWS_OBSOLETE` | 3 | the decision it replaced was followed |
| `VIOLATES` | 1 | neither |
| `BROKEN` | 2 | the code does not run, or is wrong where every decision agrees |

Beside the verdict, a script of hidden behaviour tests (`quality`) reports `passed/total` on the same
code. Before freezing, every task's references landed where they claim — the current one
`CONFORMS_CURRENT`, the replaced one `FOLLOWS_OBSOLETE`, a plausible naive one `VIOLATES`, the
starting repository `BROKEN` — and the hidden tests passed in full on the current one. No ticket
holds a decision's title, its first words, or a number of the decision it is about. A title names a
domain and never states the rule, so a channel that hands over titles hands over where to look, not
what to do.

## 4 · The families and the plan

| family | what it is | tasks | E1–E5 runs | E6 runs | role |
|---|---|---|---|---|---|
| **S1** | the ticket's file is governed by no decision; the record holds three about other files, and the naive reference applies one of them where it does not belong | 4 | 4 | — | negative control: every arm has to tie |
| **S2** | one decision in force that the code does not reveal | 6 | 4 | — | positive control: every arm that holds it has to reach the ceiling |
| **S3b** | two decisions with opposite answers, the later replacing the earlier, both in every arm that holds decisions; the ticket touches the point | 20 held out + 1 development | 8 | 4 | **the headline**: H1 and H2 |
| **S4** | thirty decisions in force, each addressed at its module; one is about the file the ticket writes | 8 | 4 | — | H4: the same result for fewer tokens |
| **S5** | one decision addressed at a directory, and a ticket that writes two files in it | 8 | 4 | 4 | H3: the per-edit channel with a write still to come after it speaks |

Cells, all on `claude-haiku-4-5-20251001`:

| block | cells |
|---|---|
| pilot: `a41-lease-arrears` (the development task) × 6 arms × 1 | 6 |
| S3b: 20 × 5 arms (E1–E5) × 8 | 800 |
| S1, S2, S4, S5: 26 × 5 arms × 4 | 520 |
| E6: S3b and S5, 28 × 4 | 112 |
| **planned** | **1,438** |

**The replica**, on `claude-sonnet-5-5`, S3b only: 20 × 5 arms (E1–E5) × 4 = **400 cells**. It runs
after the Haiku block, from the same split (`replica` in [`split.json`](split.json),
`node harness/run.mjs --replica --round 5 --yes`).

Both plans are read from the split by the runner (`plan` and `replica`), never typed: `--runs` is
refused for this round. A cell the vendor refused or the harness could not complete is run once more
and both lines are kept (`--resume`).

**Not in this round, by decision:** the family where only the record was kept up to date (it is
determined by construction and is a demonstration, not a measurement), and the `prosa` arm. No sieve:
the twenty S3b tasks are the headline as frozen.

## 5 · Hypotheses, and the criterion of each

Every comparison is read by [`../analysis.mjs`](../analysis.mjs) as frozen in this commit, over the
task as the unit: per task, the rate of `CONFORMS_CURRENT` over the cells that scored
(`CONFORMS_CURRENT`, `FOLLOWS_OBSOLETE`, `VIOLATES`); then a sign-flip permutation test of the
per-task differences, two-sided, **α = 0.05**; and an equivalence test (TOST) with a margin of
**±10 points**, whose interval is the wider of the task-level one and the cell-level Newcombe one.
The reading is one of `higher`, `lower`, `equivalent`, `unresolved`.

| | hypothesis | family | comparison | supported when | refuted when |
|---|---|---|---|---|---|
| **H1** (primary) | the whole record beats the file | S3b | E5 vs E2 | `higher` **and** the mean per-task difference is ≥ +20 points | `equivalent` or `lower` |
| **H2** (primary) | the opening alone beats the file — the filter of replaced decisions | S3b | E4 vs E2 | `higher` **and** the mean difference is ≥ +20 points | `equivalent` or `lower` |
| **H3** (secondary) | the per-edit channel adds to the opening when it has a write to come | S5 | E5 vs E4, over the cells with `mcp_pushed ≥ 2` | `higher` | `equivalent` or `lower` |
| **H4** (secondary) | at scale, the record does as well as the file for less | S4 | E5 vs E2 | `higher` or `equivalent`, **and** E5's median input tokens per cell are below E2's | `lower`, or E5's median is not below |

- `higher` with a mean below +20 points is reported as **"direction, not size"** for H1 and H2: not
  supported as stated, and not refuted.
- `unresolved` is **no conclusion**, and is reported as that.
- H1 and H2 are each tested at α = 0.05 with no correction for the two; they share E2 and are not
  independent. Both are reported whatever each says.
- **H3 is testable only if** at least 80% of the `ok` cells of E4 and of E5 in S5 have
  `mcp_pushed ≥ 2`. Below that it is **"no opportunity"**, never "no effect".
- Input tokens are `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`, from the
  vendor's own result message.

**The replica** is read with the same rule for H1 and H2 and reported beside them. The conclusion of
this round is the Haiku one; the replica says whether it holds on the model the product is used with,
and a disagreement is reported, not reconciled.

**Described, not tested:** the rate of `FOLLOWS_OBSOLETE` per arm in S3b — the failure the
mechanism exists to prevent; `BROKEN`; the hidden-test pass rate; time, turns, tool calls,
`read_record` calls and writes after a push; and every comparison involving E6.

### The commands, exactly

```
# H1, H2 (Haiku; then the same over the replica's capture)
node analysis.mjs --cells <capture> --scenario S3b --a mnema+    --b claude-md
node analysis.mjs --cells <capture> --scenario S3b --a mnema-doc --b claude-md
# H3
node analysis.mjs --cells <capture> --scenario S5  --a mnema+    --b mnema-doc --min-pushed 2
# H4
node analysis.mjs --cells <capture> --scenario S4  --a mnema+    --b claude-md
# controls: S1, each arm against E1; S2, each arm's pooled rate
node analysis.mjs --cells <capture> --scenario S1  --a <arm>     --b base
```

## 6 · Size, and what it can see

S3b: 20 tasks × 8 runs = **160 cells per arm** in each primary comparison. On cells simulated with a
known truth and run through the same code (`node analysis.mjs --simulate`, 20 × 8, 1,000 rounds,
seed 20261001): a true difference of zero is separated in **3.4%** of rounds; a true difference
of 20 points in **93.3%** (the same lift on every task) and **86.8%** (a lift that varies by
task); 15 points in **71.5%** and **65.2%**. Effects below 15 points are not seen reliably.

S1 at 16 cells and S2 at 24 cells per arm describe; they do not estimate. S2 cannot call two arms
equivalent at ±10 points at that size and is not asked to.

## 7 · Fixed for every cell

As in [`../protocol.md`](../protocol.md) §"What a cell holds fixed", and:

- the model, `claude-haiku-4-5-20251001` (the replica: `claude-sonnet-5-5`), written into every line;
- the CLI, **`2.1.281 (Claude Code)`**: the round does not start on another, and stops at the first
  cell whose CLI differs from the first cell's (`cli_version` in the split). The machine's automatic
  update of the CLI is to be off for the length of the round;
- `--output-format stream-json`, so every line carries the tools called, the writes and the pushes;
- one fresh record and identity per cell; the opening document, the per-edit push and the hold read
  from that record and nothing else;
- the arms' command line identical; what differs is the cell's MCP file, the surface arms' hook
  declaration, and the seeded content.

## 8 · What invalidates the round

The round is **not read** if:

1. any check of `--selftest` fails before the first cell — the text-delivered check included, so a
   `CLAUDE.md` absent from E2's first request stops it there;
2. the CLI changes between cells (the runner stops), or the build digest of the product differs
   between cells of one capture;
3. any arm is separated from E1 in **S1** (`higher` or `lower`): the control that must tie did not;
4. any arm that holds decisions (E2–E5) scores below **0.90** pooled in **S2**: the delivery broke;
5. more than **5%** of the planned cells end as `harness_error`, `ruler_broken` or a vendor refusal
   after the single re-run;
6. `BROKEN` reaches **25%** of an arm's cells in the S3b headline;
7. any task, this file, the split, `analysis.mjs` or `harness/lib/cells.mjs` changes after the first
   cell of the round exists.

**A cell** is invalid, not zero, when its arm's mechanism did not run (the opening hook did not run
in a surface arm, or the per-edit tool was called where a rule governs and nothing served). In S5 a
cell with `mcp_pushed < 2` is "no opportunity" for H3.

## 9 · Limits, declared before

- **One host** (Claude Code) and **one primary model** (Haiku, the most sensitive to context put in
  front of it); the replica covers S3b only.
- **The tasks are synthetic and small**, and were written by the same bench that builds the product,
  knowing the arms. The calibration, the digests and the ticket check reduce that; they do not remove
  it.
- **S3b measures presentation, not upkeep**: it assumes both the file and the record were updated.
  Which one people keep up to date is a question for the field.
- **`-p` sessions have no person**: E6's hold is a refusal the agent answers alone.
- **Conformance is not quality**: the hidden tests cover behaviour beside the decision, not design.
- **It measures what follows a recorded decision, not whether the decision was right.**

## 10 · Frozen with this file

| what | where |
|---|---|
| the forty-seven tasks | by digest, [`fixtures.sha256`](fixtures.sha256) — the tasks are held out |
| the split, the families, the plan, the replica, the model and the CLI | [`split.json`](split.json) |
| the analysis | [`../analysis.mjs`](../analysis.mjs) and [`../harness/lib/cells.mjs`](../harness/lib/cells.mjs) at this commit: sha256 `ANALYSIS_SHA` and `CELLS_SHA` |
| the runner | [`../harness/`](../harness/) at this commit |

The report of this round will live beside this file.
