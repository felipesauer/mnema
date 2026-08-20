# P1, round 2 — 208 cells, five arms, ten tasks

**The product's first promise did not survive as written, and this round says so on a row its own
pre-registration fixed before the first cell ran: `mnema+` ≈ `host`.** The surface the product built
in answer to round 1 works — it beats our own uncharged arm by 73.6 points — and it does **not** beat
the memory the coding agent already ships. What is left of the product on this promise is the proof,
which is a different promise and a true answer.

**And round 1's finding replicated exactly.** The `mnema` arm — record present, MCP on, nothing
pushed — scored **18.1%** against `base`'s **16.7%**: `≈`, a difference of 1.4 points. `mcp_asked`
was **false in 40 of 40** of its cells. A record the agent does not reach is worth what no record is
worth, measured twice now.

## What was run

| | |
|---|---|
| pre-registration | [`../../round-2/`](../../round-2/) — `reading.md`, `arms.md`, `split.json`, `fixtures.sha256`, frozen 18 Aug 2026, **before** the surface this round measures existed |
| cells | **208** = 200 planned (10 tasks × 5 arms × 4 runs) + **8 re-runs** of the 8 `harness_error` cells, which the frozen reading rule requires and which are kept beside their first attempt |
| model | `claude-haiku-4-5-20251001`, fixed |
| CLI | `2.1.228 (Claude Code)` |
| product | `mnema_version 0.0.0`, built from `d9d2abb4` |
| schema | `mnema-bench/cell/6` |
| permission mode | `bypassPermissions`, one mode for every arm |
| appended system prompt | `sha256:6a75d0a8fbfcc6e0`, identical in all five arms |
| wall clock | 90 min for the 200-cell pass, 09:45–11:15 UTC−4 |
| **vendor cost** | **$10.0432**, from the CLI's own result message, never estimated |

**Isolation note, and it is a difference from round 1 worth stating in the line rather than beside
it:** this round ran in a **dedicated git worktree** at `d9d2abb4`, with its own `node_modules` and
its own build, because another process was writing the ordinary working tree and had rebuilt
`packages/code/dist` — the artefact every cell executes — during this round's preflight. A round
whose product changes halfway measures two products and could not say which. The worktree's harness
was verified byte-identical to the one on the bench, and the pre-flight was re-run and green inside
it.

## The rate, per task per arm

`CONFORMS` over **scorable** cells — `status: ok` and a verdict of `CONFORMS` or `VIOLATES`. A pair
with no scorable cell has **no rate**, printed `–`, and contributes nothing. `B` is `BROKEN`; `HE` is
`harness_error`.

| task | in headline | `base` | `prosa` | `host` | `mnema` | `mnema+` |
|---|---|---|---|---|---|---|
| `a8-installments` | yes | 1.00 | 1.00 | 1.00 | 0.75 | 1.00 |
| `a9-phone-format` | yes | 0.00 | 1.00 (B1) | 1.00 (B2) | 0.33 (B1) | 1.00 (B2) |
| `a11-tax-id` | yes | 0.00 | 0.25 | 1.00 | 0.00 | 1.00 |
| `a12-payment-allocation` | yes | 0.00 | 0.25 | 1.00 | 0.00 | 1.00 |
| `a13-holiday-shift` | yes | 0.00 | 0.25 | 1.00 | 0.00 | 1.00 |
| `a14-tie-break` | yes | 0.00 | 0.50 | 1.00 | 0.00 | 0.50 |
| `a7-partial-refund` | no — development, and the pilot | 1.00 | 1.00 | 1.00 | 1.00 | 0.75 (B1) |
| `a10-stock-cost` | no — development | 0.00 | 0.25 | 1.00 | 0.00 | 1.00 |
| `b3-duration-format` | no — negative control | 1.00 | 1.00 | 1.00 | 1.00 | **– (HE4+4)** |
| `b4-run-length` | no — negative control | 1.00 | 1.00 | 1.00 | 1.00 | **– (HE4+4)** |

**Mean of the six headline rates:** `base` **16.7%** · `prosa` **54.2%** · `host` **100.0%** ·
`mnema` **18.1%** · `mnema+` **91.7%**.

The dispersion travels with the aggregate, as the rule requires: `mnema+` is 1.00 on five of the six
headline tasks and 0.50 on `a14-tie-break`; `host` is 1.00 on all six.

## What the frozen rule reads

Every comparison is pairwise, over the tasks that can separate the two arms. `X > Y` needs all four
conditions at once: ≥4 of 6 headline tasks eligible; neither arm `BROKEN` in a quarter or more of its
cells on those tasks; aggregates over the **same** tasks differing by **more than** 25 points; and ≥3
eligible tasks discriminating with X higher in more than half. All 6 headline tasks were eligible for
every pair, and no arm reached the `BROKEN` ceiling on them.

| comparison | read as | aggregates | discriminating / degenerate |
|---|---|---|---|
| `mnema+` vs `mnema` | **`>`** | 91.7% vs 18.1% (**+73.6**pt) | 6 / 0 |
| `mnema+` vs `host` | **`≈`** | 91.7% vs 100.0% (−8.3pt) | 1 / 5 |
| `mnema+` vs `prosa` | **`>`** | 91.7% vs 54.2% (**+37.5**pt) | 3 / 3 |
| `mnema+` vs `base` | **`>`** | 91.7% vs 16.7% (**+75.0**pt) | 5 / 1 |
| `mnema` vs `base` | **`≈`** | 18.1% vs 16.7% (+1.4pt) | 2 / 4 |
| `host` vs `prosa` | **`>`** | 100.0% vs 54.2% (**+45.8**pt) | 4 / 2 |

Of the twenty ordered pairs, **8 read `>` and 12 read `≈`**. No pair was refused for eligibility or
for the `BROKEN` ceiling.

### The rows of the outcome table this lands on

The round lands on **two** rows at once, and both are in the table:

- **`mnema+` > `mnema` — "the charging is what worked."** *"The record was reachable in both arms and
  only one of them reached the agent."* That is exactly what happened: `mcp_asked` false in 40 of 40
  `mnema` cells, and the surface pushed in 40 of 40 `mnema+` cells. The number is the conformance
  rate: **91.7% against 18.1%**.
- **`mnema+` ≈ `host` — "the host's own mechanism covers the case, and ours matches it without adding
  to it. What is left of the product is the proof — a different promise, and a true answer."**

The second is one of the three rows in which the first promise does not survive, which is why it is
the first line of this report. The two readings are not in conflict and neither is softened: the
charging is what made our own record worth anything, and it did not beat what is already installed.

**The rows this round did NOT land on**, stated so the reading cannot be mistaken for a weaker one:
not `mnema+` ≈ `mnema` (the surface changed a great deal, +73.6pt); not `mnema+` ≈ `prosa` (the
charging beats the same knowledge sitting in a committed file by 37.5pt, so the value is **not** only
the knowledge); not `mnema` > `base` (round 1's finding replicated instead of lifting); not every arm
tying.

## The contamination detector, and the gap in it

**No contamination was detected, and the detector could not check the arm this round exists to
measure.**

On both negative controls, all four arms that have a rate tie at **1.00** — no two arms differ, so the
axis-B rule that would void the round did not fire.

**`mnema+` has no rate on either control.** All eight of its axis-B cells, and all eight re-runs of
them, came back `harness_error`. So the one arm the round was built to measure is the one arm the
contamination detector says nothing about. That is a real limit on this headline and it is not
recoverable from this capture: it would take a fixed bench and fresh negative controls, and these two
are now spent.

## The 16 invalid cells, and why each class

**16 `harness_error` attempts — 8 cells, each re-run once — and every one of them is `mnema+` on an
axis-B task.** Zero on axis A, which is why the six headline tasks all have a full `mnema+` rate.

They are all one class, and the sentence is the bench's own:

> the per-edit channel was called 1 time(s) and the cell's record holds no `channel.served` for
> `edit-rules-push`: the record read and holds no `channel.served`: **no channel of this product spoke
> in this cell. That is an ANSWER and not a gap — the push says nothing for a file no rule addresses,
> and it appends nothing when it says nothing**

**The product is right and the bench's rule is wrong.** The quoted sentence is the product's, and it
is correct: axis B carries no decision, no rule addresses the file, so the channel says nothing and
records nothing. The pre-flight asserts precisely this — *"on axis B it said nothing and recorded
nothing"*. But `surfaceProblem` in the bench's `lib/channel.mjs` treats *"pushed > 0 and no
`channel.served`"* as an undelivered arm **without asking which axis it is on**, so the correct
axis-B outcome is classified as a broken cell.

The eight re-runs failed **identically**, which is the evidence that this is structural rather than
flaky: the frozen rule's one re-run did its job by proving the cause is not chance. Per that rule
these pairs publish the `n` they actually have — **zero** — excluded and named.

This is a **bench defect, not a product defect**, and it was not repaired: repairing the harness
mid-round is what the protocol forbids, and no number here was moved by leaving it.

## What the mechanism columns say

### `mcp_asked` against `mcp_pushed`, separated — which is what the split was for

| arm | `mcp_asked` | `mcp_pushed` | tools named |
|---|---|---|---|
| `base`, `prosa`, `host` | `null` (no server declared) | `null` | — |
| `mnema` | **false in 40 of 40** | 0 | none |
| `mnema+` | **true in 2 of 40** | **41 pushes, ≥1 in every one of 40 cells** | `rules_before_an_edit` ×40, `read_record` ×2 |

**The split earned itself in this round.** Counted together, `mnema+` would have reported *asked* in
40 of 40 and read as *"the agent finally reached for the record"* — the finding round 1 lacked — when
nothing the agent did produced it. Kept apart, the true statement is available: **the agent asked in 2
cells of 40; the surface pushed in all 40.** The agent still does not reach for the record. It is
being handed it.

### The fifth arm's two declared differences, measured

Both are affordances `mnema+` has and the other four do not. They travel in the line so a reader can
separate *"the charging worked"* from *"this arm had an extra way in"*.

**1 · The CLI on `PATH`.** `hook_invocations` shows the agent used the CLI beyond the `SessionStart`
hook's own `brief` in **4 of 40** cells:

| cell | verbs | verdict |
|---|---|---|
| `a7-partial-refund` r2 | `read-record` | CONFORMS |
| `a7-partial-refund` r4 | `--help`, `read-record`, `show` | CONFORMS |
| `a12-payment-allocation` r3 | `--help`, `read_record`, `show` | CONFORMS |
| `a9-phone-format` r4 | `--help`, `read-record`, `show` | BROKEN |

**Only one of the four is a scorable headline cell.** On the headline, `mnema+` used the CLI in **1 of
22** scorable cells (that one conformed) and never touched it in the other **21**, which conformed at
**0.90**. The 73.6-point result therefore does not rest on this affordance: strike every cell that
used the CLI and the arm still stands where it stands. `hook_ran` was **true in 40 of 40**, so the
document channel ran in every cell.

**2 · The record it writes while serving.** `channel_served` holds `edit-rules-push:1` in **32 of 32**
axis-A cells and `[]` in all 8 axis-B cells. `channels_on` reports all three channels **on** in 40 of
40 — no cell switched anything off, so the invalid-cell class that exists for a self-silencing agent
never fired. The diff each discriminant reads excludes `.mnema` by pathspec, exactly as in round 1, so
this writing changed no score.

## Cost, against what was predicted

**$10.0432 for 208 cells, against a pre-run estimate of $10.41–11.67 for 200.** Under the low end,
and the eight re-runs are inside the figure.

| arm | $/cell | turns | cache-read |
|---|---|---|---|
| `base` | 0.0449 | 5.4 | 132 k |
| `prosa` | 0.0511 | 7.0 | 176 k |
| `host` | 0.0485 | 6.7 | 162 k |
| `mnema` | 0.0483 | 6.5 | 162 k |
| **`mnema+`** | **0.0486** | **6.5** | **166 k** |

**And this falsifies the cost prediction the fifth arm's own delivery published.** That measurement —
8 cells, the document channel alone, 18 Aug — put the arm at **$0.0727 and 11.1 turns**, +43% over
`mnema`, and derived a $0.073–0.104 band for `mnema+` from it. Measured over 48 cells, `mnema+` cost
**$0.0486 and 6.5 turns**: **+0.6% over `mnema`, not +43%**, and the turn count did not move at all.
The predicted band is wrong at its own floor. The 8-cell figure did not survive the larger `n`; what
carried the prediction was turns, and turns did not rise.

## Qualifications, which ride in every line and not only here

- `model_note` — `claude-haiku-4-5-20251001` is fixed by design; a weaker model tends to benefit more
  from external knowledge, so a positive result here is a **ceiling**, not the value in real use.
- `scoring_note` — deterministic: each fixture's own `verify.<ext>`, calibrated against a conforming
  and a violating reference before any model was called. **No LLM judge.**
- `cost_source` — the vendor result message of the CLI; never estimated.
- **Asking is not using, and neither is being pushed at.** No column here says the model read what
  arrived, believed it, or obeyed it. `channel_served` says the channel was **live**; `hook_ran` says
  the document was **produced and handed over**. The conformance rate is the only thing that speaks to
  effect, and it speaks about six tasks and one model.
- **`n = 4`.** No significance test, no p-value, no confidence interval — with `n` in single digits the
  arithmetic would be ceremony over a sample that does not carry it. One cell is 25 points of a task.

## What broke for its own reasons

**`a9-phone-format` broke in 6 of its 20 cells**, and `broken_detail` carries the discriminant's own
sentence for each — the instrument gap round 1 had, closed:

```
"(11) 98765-4321" came back as "+551987654321", not "+5511987654321"      (2 cells)
"(11) 98765-4321" came back as "+55119987654321", not "+5511987654321"
"(11) 98765-4321" came back as "+5511998765432", not "+5511987654321"
"(11) 98765-4321" came back as "+5519987654321", not "+5511987654321"
threw on an eleven-digit number: undefined method `last' for "11987654321":String
```

Per arm: `base` 0/4, `prosa` 1/4, `host` 2/4, `mnema` 1/4, `mnema+` 2/4. **It is not a defective task
by the frozen rule**, which requires a quarter or more *in every arm* — `base` broke none. It is worth
naming anyway: the four arms that carried the decision broke more often than the arm that did not,
because `base` wrote code that ran and simply violated (rate 0.00) while the others attempted the rule
and mishandled digit counts.

`a7-partial-refund` broke in 1 of 20 (`mnema+`: `Call to undefined function bcround()`).

## What is committed here, and what is held back

Committed: `cells.jsonl` (all 208 lines, both attempts of every re-run), this report, and the raw
output and diffs of **`a7-partial-refund` and `a10-stock-cost` only** — the two development tasks,
open by design.

**Held back:** the raw output and diffs of the eight held-out tasks (`a8`, `a9`, `a11`, `a12`, `a13`,
`a14`, `b3`, `b4`), which stay back until the tasks are published. Their **rates and verdicts are all
above**; what is withheld is the task text and the code each cell produced.

## What this round does not license

It does not say the surface beats the host's memory — it says the two are `≈` on these six tasks with
this model. It does not say the product's retrieval works: the arm that carries retrieval without
charging (`mnema`) is `≈` with carrying nothing, for the second round running. It does not close
whether the agent would ever reach for the record on its own; two cells of forty is the only evidence
here and it points the other way. And it does not measure `mnema+` against contamination at all,
because that detector had no rate for it.
