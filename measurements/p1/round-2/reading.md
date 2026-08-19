# How each outcome of P1's second round is to be read

**Committed before the first cell of this round runs, and before the surface it
measures exists.** The promise in [`protocol.md`](../protocol.md) does not change;
the tasks, the arms and this reading do. Round 1's own files — its
[`reading.md`](../reading.md), [`split.json`](../split.json) and
[`fixtures.sha256`](../fixtures.sha256) — are **not edited**: they are the
pre-registration of a round that already happened, and a pre-registration is worth
exactly what the order is worth.

Round 1's result is in [`results/2026-08-18-full/report.md`](../results/2026-08-18-full/report.md):
by the rule fixed before its first cell, **no arm was `>` any other**, and the
product's first promise did not survive as written. Its cause was measured rather
than inferred — `mcp_asked` false in twenty of twenty instrumented cells; the agent
never called the record. Round 2 exists to measure the answer to that, and the
answer is the fifth arm in [`arms.md`](arms.md).

**Three of the rows below are outcomes in which the first promise still does not
survive, and one is an outcome in which the product's own surface is worth nothing
measurable.** That is the point. A protocol whose every branch flatters the thing it
measures is not a measurement.

## What round 1 taught this file, and what it changed

Applying round 1's rule to round 1's numbers found **three defects in the rule
itself**. They were published as gaps rather than patched, because a rule rewritten
after the number is not a rule. This file closes them, before a number exists.

| # | the defect | what this file does |
|---|---|---|
| 1 | *"the direction repeats in at least 3 of 4"* presupposed four tasks that DISCRIMINATE. Two did not: one put every arm at the same rate, and one broke most of its cells. A condition meant to stop one task carrying the headline also stops two from carrying it when the other two are degenerate | more tasks in the headline — **six** — and the direction is counted over the tasks that produced **spread**, with the number of degenerate tasks **published beside every comparison** |
| 2 | an arm can finish a task with **zero scorable cells** (one arm was 0 of 0), and the mean of six rates is undefined when one does not exist. Round 1 took the mean over the tasks that did exist, compared it with means over a different set, and disclosed the choice | a (task, arm) pair with no scorable cell has **no rate**, and contributes **nothing**: the task is not eligible for any comparison involving that arm, and every aggregate in a comparison is taken over the **same** set of tasks for both arms |
| 3 | the `BROKEN` ceiling was **reached exactly**, not exceeded — one arm at precisely a quarter — and a knife edge decided whether the comparison was read at all | the boundary belongs to the **refusal**, stated: at **one quarter or more**, the comparison is not read |

**And one defect in the instrument, not the rule.** Round 1 could not say, from its
data, whether an arm's four `BROKEN` cells were agents writing unworkable code or a
task whose happy path could not be reached. The answer turned out to be the task —
its collaborator had no stated return type — and finding it meant reading a diff by
hand. The discriminant had printed the reason all along and the line threw it away.
Every line of this round carries `broken_detail`: the discriminant's own sentence,
verbatim, whenever it refused the code. It scores nothing; it is what makes the
sentence above ("reported as such") true rather than promised.

## The ten tasks, and which six the headline is about

[`split.json`](split.json) is where a program reads this from, so one file decides
it and not two.

| task | axis | in the headline |
|---|---|---|
| `a7-partial-refund` | A | no — **development**: the harness is free to be iterated against it, and it is the pilot |
| `a8-installments` | A | **yes** |
| `a9-phone-format` | A | **yes** |
| `a10-stock-cost` | A | no — **development** |
| `a11-tax-id` | A | **yes** |
| `a12-payment-allocation` | A | **yes** |
| `a13-holiday-shift` | A | **yes** |
| `a14-tie-break` | A | **yes** |
| `b3-duration-format` | B | no — negative control: read for the tie, never for the headline |
| `b4-run-length` | B | no — negative control |

The two development tasks are run, scored and published like every other cell. They
are never folded into the headline, because the harness may be fixed against them
until it works, and a task the harness was fixed against measures the harness as
much as it measures the arm.

**Both negative controls are held out by rule.** They are the contamination
detector, and iterating on them after seeing a result is the power to soften the one
signal that says the run does not count.

## The rate, and what has no rate at all

**A (task, arm) pair's rate is `CONFORMS` over SCORABLE cells** — cells whose
`status` is `ok` and whose verdict is `CONFORMS` or `VIOLATES`.

**A pair with no scorable cell has NO RATE.** Not zero, not one, not the mean of the
others: none. It is published as `–` beside the count of its `BROKEN` cells, and it
contributes **nothing** to any number. Scoring it as a violation would merge two
different things — an agent that could not write the code, and an agent that wrote
it against the decision — and filling it in with anything at all would be an
estimate wearing the clothes of a measurement.

**Two levels, and both are published.** A rate per task over its `n`, and the mean
of those rates. The dispersion travels with the aggregate, always: the per-task rates
are printed beside it, agreeing or not. An arm that takes one task perfectly and
loses the rest is not an arm that works, and one pooled number over all the cells
hides exactly that.

## `>` and `≈`, and the comparison is PAIRWISE

Every comparison is between **two named arms**, and it is read over the tasks that
can separate those two. Three definitions, all of them properties of the round and
none of them of any particular arm:

- **eligible(X, Y)** — the headline tasks on which **both** X and Y have a rate.
- **discriminating(X, Y)** — the eligible tasks on which their two rates **differ**.
- **degenerate** — the rest: eligible tasks where the two rates are equal (no
  spread), and tasks that are not eligible (one side has no rate). **Both counts are
  published with every comparison.**

**X is read as `>` Y only when all four of these hold at once:**

1. **at least 4 of the 6 headline tasks are eligible.** Under four common tasks the
   pair is not compared at all, and the round says so in those words;
2. neither X nor Y is `BROKEN` in **a quarter or more** of its cells on the eligible
   tasks — the boundary is inside the refusal;
3. the aggregates, each taken over the **same** eligible tasks, differ by **more than
   25 percentage points**;
4. **at least 3 eligible tasks discriminate**, and X is the higher one in **more than
   half** of them.

**Anything else is `≈`.** Not "inconclusive", not "a trend", not "suggestive": `≈`,
and the row of the outcome table that carries it.

**Where each number comes from.** The 25 points is round 1's, and its derivation is
what condition 1 protects: with four eligible tasks one whole task is worth 25
points, so a difference of 25 or less can be produced by a single task while the
others tie — and a headline built on that is a headline about one task. Condition 4
is round 1's *"3 of 4"* generalised so a degenerate task subtracts from the
denominator instead of blocking the count: with four discriminating tasks *more than
half* is three, which is the old condition exactly; with six it is four. The floor of
three is there because a majority of two is not a repetition.

**The rule does not know which arm is the product.** Rename the five arms to
`A`…`E` and every clause above says the same thing. This was checked against round
1's committed cells before this file was written. Round 1's rule read all twelve of
its ordered pairs as `≈`. Under this one, **no pair becomes `>`** — six are still `≈`
and the other **six are not comparable at all**: every pair involving the arm that
had no rate on one task, which round 1 compared anyway by taking means over
different sets of tasks. A rule whose first act is to withdraw six comparisons the
old one made is not a rule written to flatter anybody.

## The outcome table

| outcome | reading |
|---|---|
| `mnema+` > `mnema` | **the charging is what worked.** The record was reachable in both arms and only one of them reached the agent. This is the result the surface was built for, and the number is the conformance rate |
| `mnema+` ≈ `mnema` | **the surface changed nothing measurable.** The answer to round 1 did not answer it, and the next question is whether the record arrives at all — which `hook_ran` and its equivalents in the line, not the rate, are what answer |
| `mnema+` ≈ `host` | **the host's own mechanism covers the case**, and ours matches it without adding to it. What is left of the product is the proof — a different promise, and a true answer |
| `mnema+` > `host` | the product's surface beats the one already installed, and the number is the conformance rate |
| `mnema+` ≈ `prosa` | **the value is the knowledge, not the retrieval and not the charging.** The cheapest thing that carries the same decision does as well, and the first promise is misplaced |
| `mnema` > `base` | round 1's finding does not replicate: the record was reached this time, without being pushed. The cause of the difference has to be named before the number is used |
| every arm ties on the headline | either the tasks are not unrecoverable enough — a design defect the preflight should have caught — or the agent re-derives everything, which is an earlier round's finding generalised |
| **any two arms differ on an axis-B task** | **contamination. No number from the run counts** |

**The axis-B rule is strict on purpose, and the cost is declared.** A single cell of
difference on a negative control voids the whole round. That is fragile, and the
alternative is worse: deciding *after* the number how much difference is little
enough would be the rule-after-the-result this file exists to prevent. The detector
has to be more sensitive than the headline, never less.

**No significance test, no p-value, no confidence interval.** With `n` in single
digits the arithmetic would be ceremony over a sample that does not carry it, and the
four conditions above are the whole rule.

**And the asymmetry is deliberate.** Calling `≈` where an effect exists understates
this product; calling `>` where none exists publishes a false claim about it in a
public repository. The table above already treats `≈` as a good and true result, so
the conservative rule loses nothing it needs.

## Cells that produce no verdict

**A `BROKEN` cell leaves the numerator and the denominator, and the count is
published per arm, per task, with `broken_detail` beside it.** `BROKEN` is the
correctness gate refusing: the produced code does not run, or gets the ordinary case
wrong. Conformance measured over code that does not run would be a number about
nothing.

**A task that breaks for its own reasons is named, not absorbed.** If a task is
`BROKEN` in a quarter or more of its cells **in every arm**, it is a defect of the
task and the round says so, with the discriminant's own sentences as the evidence.
The eligibility rule already keeps such a task out of the comparisons it would
distort; this is the part that makes the round admit why.

**An instrument failure is re-run exactly once, and both attempts are kept.**
`harness_error` and `ruler_broken` are not an agent choosing anything — a missing
CLI, a half-applied seed, a discriminant that cannot load. The cell runs again,
once; the failed attempt stays in `cells.jsonl` with its status, and the reading
takes the `ok` line. A cell still without a result after its one re-run is excluded
and named, and its (task, arm) publishes the `n` it actually has rather than the `n`
it wanted.

**This does not break "touched once", and it does not break it only because it is
written here.** That rule forbids iterating after seeing a result; an instrument that
broke produced no result to iterate against. A re-run decided *after* seeing which
cells failed would be a choice made about the outcome, which is exactly why the rule
is committed before the first cell runs.

## The size, and the decision that is not this file's

**`n` is carried over from round 1 unchanged: `n = 4` per (task, arm)**, written in
[`split.json`](split.json). Whether round 2 runs at that size is **an open decision
of whoever holds the budget**, and this file does not close it. What it does is put
the arithmetic beside the question, so the decision is made against a number rather
than an impression.

The conversion is measured, not estimated: round 1's own spend against the account's
weekly meter, with the run isolated from other work, was **80 cells for 3 points** —
about **0.037 points a cell**. Round 1 was designed for 3 authorised points and
consumed **5**.

| `n` | cells (10 tasks × 5 arms × `n`) | weekly-meter points, at 0.037 a cell | headline cells per arm |
|---|---|---|---|
| 4 | 200 | ≈ 7.4 | 24 |
| 3 | 150 | ≈ 5.6 | 18 |
| 2 | 100 | ≈ 3.7 | 12 |

**What the choice costs in reading, so it is not only a money question.** The rule
above never divides by `n`: the conditions are about tasks that discriminate, not
about cells. What `n` buys is how much a single flake can move one task's rate — at
`n = 2` one cell is 50 points of a task, at `n = 4` it is 25 — and how often a task
lands with no scorable cell at all. A smaller `n` makes both defects that round 1
tripped on more likely, not less.

**Vendor cost, for the record:** round 1's 112 cells reported $5.25, and the pilot's
four $0.18. At the same per-cell cost, 200 cells is about **$9.40**. The binding
constraint is the weekly meter, not the dollars.

## What the run is allowed to change afterwards, and what it is not

**Allowed:** the harness, over a development task; the wording of a report; a second
capture with the cause of the difference named.

**Not allowed:** the tasks (they are fixed by [`fixtures.sha256`](fixtures.sha256));
the split between development and held out, and the headline set derived from it
([`split.json`](split.json)); this file; the arms in [`arms.md`](arms.md); the
promise in [`protocol.md`](../protocol.md). A change to any of those after a result
exists makes that result a pilot, not a measurement, and it has to be said in that
word.
