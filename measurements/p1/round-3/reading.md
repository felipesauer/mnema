# How each outcome of P1's third round is to be read

**Committed before the first cell of this round runs, and before the mechanism it
measures exists.** The promise in [`protocol.md`](../protocol.md) does not change;
the tasks, the arms and this reading do. Round 1's files
([`reading.md`](../reading.md), [`split.json`](../split.json),
[`fixtures.sha256`](../fixtures.sha256)) and round 2's
([`round-2/`](../round-2/)) are **not edited**: they are the pre-registration of
rounds that already happened, and a pre-registration is worth exactly what the
order is worth. Where round 2's rule had a hole, this file writes the rule it
should have had — **in this file**, and it says where the hole was found.

**And this file was itself re-frozen once, which is stated here rather than left to
a diff.** Round 3 was frozen with five arms and re-frozen with four, in the same
pull request, **before a cell of it ran and before any mechanism of it was built**.
What the change is and what forced it is in [`arms.md`](arms.md); the withdrawn
arms are carried as data in [`split.json`](split.json). The tasks and their digests
are untouched — swapping an arm touches no task — and after this file there is no
further window: the next change to it makes a result a pilot, in the word this
file's last section fixes.

Round 2's result is in
[`results/2026-08-20-full/report.md`](../results/2026-08-20-full/report.md). By
the rule fixed before its first cell:

| | |
|---|---|
| `mnema+` > `mnema` | +73.6pt, 6 of 6 discriminating. **Serving the record unasked is what made our own record worth anything** — and round 2 could not say WHICH of the two channels that served it did the work |
| `mnema+` ≈ `host` | −8.3pt, 1 of 6 discriminating. **It does not beat the memory the coding agent already ships** |
| `mnema` ≈ `base` | +1.4pt, `mcp_asked` false in 40 of 40. Round 1's finding replicated |
| `prosa` | 54.2%. Half the result is a decision in one committed markdown file |

**Round 3 exists to attribute that first row.** The `mnema+` arm carried an opening
document **and** a per-edit push, and no arm of round 2 held one without the other.
Round 2's own line then measured that the push **could not have acted** in any
headline cell of it: `mcp_pushed` — the count of dispatches the host made to the
cell's own MCP server, one per matched `Write|Edit|NotebookEdit` — is **1 in 24 of
24**, and the capture of 19 Aug in
[`../mcp-tool-channel/`](../mcp-tool-channel/) measured that the pushed text lands
**after** the tool result of the edit that triggered it. One dispatch is at most one
matched edit, so the text arrived after the only write those cells had. This round
puts an arm on each side of that: `mnema-doc` and `mnema+`, differing in one switch
position.

**Three of the rows below are outcomes in which a channel this product ships and
charges for on every edit is worth nothing measurable or worse, and one of them is
the outcome round 2's own data predicts.** That is the point. A protocol whose
every branch flatters the thing it measures is not a measurement.

## What rounds 1 and 2 taught this file, and what it changed

Round 1's rule had three defects, found by applying it to round 1's own numbers;
round 2 closed them and this file inherits all three closures unchanged. Round 2's
own capture then exposed **two more** — one in the rule, one in the line — and this
file closes those.

| # | from | the defect | what this file does |
|---|---|---|---|
| 1 | round 1 | *"the direction repeats in at least 3 of 4"* presupposed four tasks that DISCRIMINATE, and two did not | six headline tasks, and the direction counted over the tasks that produced **spread**, with the degenerate count **published beside every comparison**. **Inherited unchanged** |
| 2 | round 1 | an arm can finish a task with **zero scorable cells**, and a mean over six rates is undefined when one does not exist | a (task, arm) pair with no scorable cell has **no rate** and contributes **nothing**; every aggregate in a comparison is taken over the **same** eligible tasks for both arms. **Inherited unchanged** |
| 3 | round 1 | the `BROKEN` ceiling was reached **exactly** and a knife edge decided whether a comparison was read | the boundary belongs to the **refusal**: at **one quarter or more**, the comparison is not read. **Inherited unchanged** |
| **4** | **round 2's capture** | **the contamination detector said nothing about the arm the round existed to measure.** All 8 axis-B cells of `mnema+`, and all 8 re-runs, came back `harness_error`, so that arm had **no rate on either negative control** — and the round published three `>` readings for it anyway. The cause was a bench defect (`surfaceProblem` classified the CORRECT axis-B outcome as an undelivered arm, because it never asked which axis it was on) | **two clauses, below: a pre-spend gate, and a cap.** An arm with no rate on either negative control **cannot be read as `>` anything** in this round |
| **5** | **round 2's capture** | **the round could not say whether the channel it measures had a second write to act on.** This is the same defect this entry named at the first freeze, and **the reason it gave for it was wrong** — see the paragraph below, which names what falsified it | the round is read over **`mcp_pushed`**, which does carry it: the column is a condition of reading [`prediction.md`](prediction.md), and a task whose `mnema+` or `mnema-doc` cells report it as `null` is **not read for the prediction at all** |

**Defect 4's cause is closed, and that is not the same as the rule being
unnecessary.** The bench now decides the axis in one place and refuses an axis it
does not know. The rule stays because the *class* of failure — an instrument that
cannot see the treatment arm on the control — is not specific to that bug, and
because a rule written after the next instance of it would be a rule written after
a number.

**The cost of clause 4 is declared, and it is large.** Applied to round 2, it
withdraws that round's three `>` readings for `mnema+` — against `mnema`, against
`prosa`, against `base` — because `mnema+` had no rate on either control. Round 2's
headline sentence, *"the charging is what worked"*, would have been held back. That
is what a rule looks like when it is not written to flatter: this one can veto the
result the product wins. It does **not** reach backwards — round 2 was read by the
rule frozen before round 2, and that reading stands as published.

**Defect 5's PREMISE was wrong, and what falsified it is one committed line.** At
this round's first freeze, entry 5 read *"nothing in the line says how many times
the agent wrote"*, and gave as its reason that `mcp_pushed` *"is 1 in 47 of the 48
cells that carry it, because the per-edit channel speaks once per cell, not once per
edit"*. **That is a description of a different column.** `channel_served` is the
once-per-run fact the product appends, and it is `edit-rules-push:1` in every cell
of the arm by construction. `mcp_pushed` counts the `tools/call` messages that
arrived at the cell's own server for the pushed tool — a dispatch per matched edit
— and the line that proves the two are different columns is
**`a7-partial-refund` · `mnema+` · run 4**, which carries `mcp_pushed` **2** beside
`channel_served` **`edit-rules-push:1`**. A column that reaches 2 cannot be one that
speaks once per cell. So the entry is rewritten rather than deleted: the round does
have a usable count of the host's dispatches, and what it does not have is a count
of writes made by any other means — a `Bash` heredoc is invisible to the matcher,
which the bench already reports as a named reason rather than as a zero. `mcp_pushed`
is therefore an **upper bound on the host's dispatches**, and on a valid cell of
either mnema arm — one where files changed and the push fired — `mcp_pushed = 1`
means **at most one matched edit**, which is the direction this round needs it in.

## The ten tasks, and which six the headline is about

[`split.json`](split.json) is where a program reads this from, so one file decides
it and not two.

| task | axis | in the headline |
|---|---|---|
| `a15-commission-base` | A | no — **development**: the harness is free to be iterated against it, and it is the pilot |
| `a16-event-order` | A | no — **development** |
| `a17-billed-seats` | A | **yes** |
| `a18-dunning-recipients` | A | **yes** |
| `a19-batch-pick` | A | **yes** |
| `a20-over-long-note` | A | **yes** |
| `a21-session-expiry` | A | **yes** |
| `a22-graduated-usage` | A | **yes** |
| `b5-column-name` | B | no — negative control: read for the tie, never for the headline |
| `b6-wrap-words` | B | no — negative control |

**None of these ten appeared in round 1 or round 2.** Those twenty tasks are spent
— the held-out ones were touched once by rule, the development ones were iterated
against — and reusing any of them would be re-running a task whose result is
already known. The digests are in [`fixtures.sha256`](fixtures.sha256), and that
file also states the one way in which this freeze is **weaker** than round 2's.

The two development tasks are run, scored and published like every other cell.
They are never folded into the headline, because the harness may be fixed against
them until it works, and a task the harness was fixed against measures the harness
as much as it measures the arm.

**Both negative controls are held out by rule.** They are the contamination
detector, and iterating on them after seeing a result is the power to soften the
one signal that says the run does not count.

## The rate, and what has no rate at all

**A (task, arm) pair's rate is `CONFORMS` over SCORABLE cells** — cells whose
`status` is `ok` and whose verdict is `CONFORMS` or `VIOLATES`.

**A pair with no scorable cell has NO RATE.** Not zero, not one, not the mean of
the others: none. It is published as `–` beside the count of its `BROKEN` cells,
and it contributes **nothing** to any number. Scoring it as a violation would
merge two different things — an agent that could not write the code, and an agent
that wrote it against the decision — and filling it in with anything at all would
be an estimate wearing the clothes of a measurement.

**Two levels, and both are published.** A rate per task over its `n`, and the mean
of those rates. The dispersion travels with the aggregate, always: the per-task
rates are printed beside it, agreeing or not. Round 2 is the argument — `mnema+`
was 1.00 on five headline tasks and 0.50 on one, and the mean alone would have
hidden the only task the round turned out to be about.

## `>` and `≈`, and the comparison is PAIRWISE

Every comparison is between **two named arms**, and it is read over the tasks that
can separate those two. Three definitions, all of them properties of the round and
none of them of any particular arm:

- **eligible(X, Y)** — the headline tasks on which **both** X and Y have a rate.
- **discriminating(X, Y)** — the eligible tasks on which their two rates **differ**.
- **degenerate** — the rest: eligible tasks where the two rates are equal (no
  spread), and tasks that are not eligible (one side has no rate). **Both counts
  are published with every comparison.**

**X is read as `>` Y only when all five of these hold at once:**

1. **at least 4 of the 6 headline tasks are eligible.** Under four common tasks the
   pair is not compared at all, and the round says so in those words;
2. neither X nor Y is `BROKEN` in **a quarter or more** of its cells on the
   eligible tasks — the boundary is inside the refusal;
3. the aggregates, each taken over the **same** eligible tasks, differ by **more
   than 25 percentage points**;
4. **at least 3 eligible tasks discriminate**, and X is the higher one in **more
   than half** of them;
5. **X has a rate on at least one negative control.** An arm the contamination
   detector cannot see is an arm whose result is unprotected against the one
   failure that voids a round, and this round will not publish `>` for it.

**Anything else is `≈`.** Not "inconclusive", not "a trend", not "suggestive":
`≈`, and the row of the outcome table that carries it. **`X < Y` is not a third
verdict** — it is `Y > X`, and every comparison is read in both directions.

**Where each number comes from.** The 25 points is round 1's, and its derivation
is what condition 1 protects: with four eligible tasks one whole task is worth 25
points, so a difference of 25 or less can be produced by a single task while the
others tie — and a headline built on that is a headline about one task. Round 2
demonstrated the case exactly: an 8.3-point gap over 1 discriminating task of 6,
read as `≈`. Condition 4 is round 1's *"3 of 4"* generalised so a degenerate task
subtracts from the denominator instead of blocking the count. Condition 5 is
defect 4 above.

**The rule does not know which arm is the product.** Rename the four arms to
`A`…`D` and every clause above says the same thing. Conditions 1–4 were checked
against round 1's committed cells before round 2 was written, and withdrew six of
the twelve comparisons round 1 had made. Condition 5, checked against round 2's
committed cells, withdraws three of that round's eight `>` readings — **all three
of them the product's own wins**.

## The gate that comes before any spending

**No cell of this round runs until every declared arm has produced one SCORABLE
axis-B cell in the preflight.** Round 2 seeded all five of its arms in its
preflight and still discovered, after 208 paid cells, that one arm could not produce
a valid axis-B cell at all. The preflight already refuses a round whose split does
not cover the tasks on disk and whose hashes have moved; this adds the check that
the contamination detector can actually see every arm before the detector is the
only thing standing between the round and a false headline.

This gate is a condition of the round, not a repair to be made during it: a
harness fixed mid-round is a harness fixed against a result.

## The outcome table

**The pair the round is about is `mnema+` against `mnema-doc`, and the subtraction
between them is the per-edit push and nothing else.** Every row below is read by
the five conditions above, in both directions.

| outcome | reading |
|---|---|
| `mnema+` ≈ `mnema-doc` | **the per-edit push adds nothing measurable.** It is the outcome round 2's own cells predict — the channel could not have acted in any of that round's headline cells — and it puts a decision on the table that is not this file's to take: a channel that pays its derivation on **every edit of every session**, that is **charged for**, and that does not move the number. The document is then what the +73.6 of round 2 was about, and this round says so with an arm on each side |
| `mnema+` > `mnema-doc` | **the push adds.** The surface's number is not the document alone, the charge earns its cost, and **only then does a question about WHEN the text arrives have a premise** — the arm that varies the arrival point becomes worth building, which today it is not |
| `mnema-doc` > `mnema+` — the same row as *`mnema+` < `mnema-doc`*, read in the direction this file's rule allows | **the push makes the product worse.** Text arriving in the middle of the work costs conformance, and the product ships a channel that charges on every edit for a negative effect. The front stops, the reason is measured rather than argued, and the switch that turns it off stops being a courtesy |
| `mnema-doc` ≈ `host` | **the document alone ties with the memory the coding agent already ships**, and every part of the surface beyond that document is weight. Round 2 read `mnema+` ≈ `host`; this row says the tie survives removing a channel, which makes the channel's cost the whole of what it bought |
| `mnema-doc` > `host` | **the document beats the installed alternative** — the strongest reading available to this round, and the one it may not publish without condition 5: an arm the negative controls cannot see is capped at `≈` whatever its aggregate |
| `mnema-doc` ≈ `base` | **nothing in the surface works, and the +73.6 of round 2 was something else.** The floor answers as well as the document does, `mnema+` is then the only arm with anything left to explain, and nothing about this round is read until that is named out of its own data |
| `mnema+` ≈ `host` | round 2's answer replicates: our surface, whole, does not beat what the host already ships. What is left of the product on this promise is the proof — a different promise, and a true answer |
| `mnema+` > `host` | round 2's `≈ host` does not replicate in the other direction, and the difference has to be named against round 2's own table before the number is used |
| `mnema+` ≈ `base` | **round 2's own result does not replicate.** Nothing else in this table is read until that is explained: the same arm, the same isolation and the same model produced +75.0 points over `base` days earlier, and a round in which it does not is a round measuring something that changed in between. This row is the round's own regression check, and it is the reason `mnema+` is here at all |
| every arm ties on the headline | either the tasks are not unrecoverable enough — a design defect the preflight should have caught — or the agent re-derives everything, which is an earlier round's finding generalised |
| **an arm has no rate on either negative control** | **that arm is capped at `≈`** by condition 5, whatever its aggregate. The round publishes the aggregate, names the detector as silent for that arm, and publishes the reason the cells were invalid |
| **any two arms differ on an axis-B task** | **contamination. No number from the run counts** |

**The axis-B rule is strict on purpose, and the cost is declared.** A single cell
of difference on a negative control voids the whole round. That is fragile, and
the alternative is worse: deciding *after* the number how much difference is
little enough would be the rule-after-the-result this file exists to prevent. The
detector has to be more sensitive than the headline, never less.

**No significance test, no p-value, no confidence interval.** With `n` in single
digits the arithmetic would be ceremony over a sample that does not carry it, and
the five conditions above are the whole rule.

**And the asymmetry is deliberate.** Calling `≈` where an effect exists
understates this product; calling `>` where none exists publishes a false claim
about it in a public repository. The table above already treats `≈` as a good and
true result — three of its rows are the product's honest limits — so the
conservative rule loses nothing it needs.

## How the prediction is read, and when it is not read at all

[`prediction.md`](prediction.md) declares, before the round, whether each task is
expected to be **decided on the first write**, and what that implies for the pair
this round is about: **a push that arrives after the first write cannot act on a
task the first write settled**, so `mnema+` ≈ `mnema-doc` is the expected outcome
on such a task. The prediction is therefore about **possibility**, and it is
checked **per cell** against a column that already exists.

| outcome | reading |
|---|---|
| the prediction holds | the tasks where the push had no later write to act on are the tasks where the two arms tie. The `≈`, if that is the row, has a mechanism and not just a number |
| the prediction fails | the two arms differ on a task where the push **could not have acted** — `mcp_pushed = 1` throughout — and then the difference is not the push, whatever else it is. **That is worth more than a confirmed number without an explanation**, and the round owes a name for it out of its own data |
| **`mcp_pushed` is `null` on either mnema arm for a task** | **the prediction is not read on that task at all.** Not "read loosely", not "read from `num_turns`": not read. The column is what makes the claim checkable, and a claim that cannot be checked is not a prediction |

**How a cell answers, and it is one column.** On a valid cell of either mnema arm:

- **`mcp_pushed = 1`** — one dispatch, so **at most one matched edit**. The pushed
  text arrived after it, and the push **could not have acted**. A tie between the
  two arms on such a cell is the expected result and says nothing about the value
  of the channel;
- **`mcp_pushed ≥ 2`** — a second dispatch happened, so there was a write the
  pushed text arrived **before**. **This is where a difference between the two arms
  has to appear if one exists.** It is a **necessary and not a sufficient**
  condition: the bench cannot tell a host dispatch from the agent calling the same
  tool itself, so a second count proves the channel spoke twice, never that a later
  write consumed what it said;
- **`mcp_pushed = 0` beside a changed file** — the push never fired although the
  agent wrote. That is an **invalid cell**, not a zero, and the bench names both
  causes it cannot separate: a handler that did not run, and a write made with a
  tool the matcher does not cover.

**And the prediction is uniform, which is a limit on it — unchanged from the first
freeze, and still true.** [`prediction.md`](prediction.md) classifies **all ten**
tasks the same way, for a reason it states: the protocol's task shape — one
function, one edit, a happy path the natural draft already passes — makes every task
of it first-write-decided. That makes it a statement about the **set** and not a
task-by-task contrast, and it is what makes `mnema+` ≈ `mnema-doc` the *expected*
row rather than a surprise. **The refutable half is the cells:** a headline task
whose `mnema+` cells come back with `mcp_pushed ≥ 2` is a task where the push had
its chance, and a round in which those tasks tie as flatly as the rest is a round
that has measured the channel and found nothing.

## Cells that produce no verdict

**A `BROKEN` cell leaves the numerator and the denominator, and the count is
published per arm, per task, with `broken_detail` beside it.** `BROKEN` is the
correctness gate refusing: the produced code does not run, or gets the ordinary
case wrong. Conformance measured over code that does not run would be a number
about nothing.

**A task that breaks for its own reasons is named, not absorbed.** If a task is
`BROKEN` in a quarter or more of its cells **in every arm**, it is a defect of the
task and the round says so, with the discriminant's own sentences as the evidence.
The eligibility rule already keeps such a task out of the comparisons it would
distort; this is the part that makes the round admit why. Round 2's
`a9-phone-format` is the near case: 6 of 20 cells broken, and **not** a defective
task by this rule, because `base` broke none of its four.

**An instrument failure is re-run exactly once, and both attempts are kept.**
`harness_error` and `ruler_broken` are not an agent choosing anything — a missing
CLI, a half-applied seed, a discriminant that cannot load. The cell runs again,
once; the failed attempt stays in `cells.jsonl` with its status, and the reading
takes the `ok` line. A cell still without a result after its one re-run is
excluded and named, and its (task, arm) publishes the `n` it actually has rather
than the `n` it wanted.

**Round 2 proved this clause earns itself and showed what it does not do.** Its
eight re-runs failed **identically**, which is what established that the cause was
structural rather than flaky — the re-run's real job. What it did not do was
rescue the cells: eight identical failures are still eight pairs with no rate,
which is why condition 5 and the pre-spend gate exist above.

**This does not break "touched once", and it does not break it only because it is
written here.** That rule forbids iterating after seeing a result; an instrument
that broke produced no result to iterate against. A re-run decided *after* seeing
which cells failed would be a choice made about the outcome, which is exactly why
the rule is committed before the first cell runs.

## The size, and the decision that is not this file's

**`n` is carried over from round 2 unchanged: `n = 4` per (task, arm)**, written in
[`split.json`](split.json). Whether round 3 runs at that size is **an open
decision of whoever holds the budget**, and this file does not close it. What it
does is put the arithmetic beside the question, so the decision is made against a
number rather than an impression.

**Four arms and not five, and the round got cheaper by dropping one.** Round 2
published `$/cell` for each of its five arms over 208 cells: `base` 0.0449, `prosa`
0.0511, `host` 0.0485, `mnema` 0.0483, `mnema+` 0.0486. Three of those arms are in
this round. **`mnema-doc` does not exist, has no measured figure, and is not derived
from one** — `mnema+`'s own 0.0486 stands in for it, and it is labelled a stand-in
wherever the total appears. The stand-in is an **upper bound** by construction:
`mnema-doc` is `mnema+` with a channel switched off, so it receives strictly less
text and cannot cost more per cell for that reason. One run of all four arms over
one task therefore costs
0.0449 + 0.0485 + **0.0486** + 0.0486 = **$0.1906**.

**Why a stand-in and not a prediction.** Round 2 falsified exactly such a
prediction. The delivery of `mnema+` measured that arm over 8 cells at **$0.0727
and 11.1 turns**, +43% over `mnema`, and derived a $0.073–0.104 band for the full
arm from it. Measured over 48 cells the arm cost **$0.0486 and 6.5 turns**: +0.6%,
and the turn count did not move. **The band was wrong at its own floor.** A number
derived from a small capture of a new arm has been wrong here once already, so
this file does not produce another one.

| `n` | cells (10 tasks × 4 arms × `n`) | dollars, three arms measured + one stand-in | weekly-meter points, at 0.037 a cell | headline cells per arm |
|---|---|---|---|---|
| 4 | 160 | ≈ $7.62 | ≈ 5.9 | 24 |
| 3 | 120 | ≈ $5.72 | ≈ 4.4 | 18 |
| 2 | 80 | ≈ $3.81 | ≈ 3.0 | 12 |

**The meter conversion is round 1's and it has not been re-measured.** 0.037
points a cell comes from round 1's own spend against the account's weekly meter,
with the run isolated from other work: 80 cells for 3 points. Round 2 published
its dollars and **not** its points, so the points column above is the older
measurement carried forward, and it is the softer of the two columns.

**What the choice costs in reading, so it is not only a money question.** The rule
above never divides by `n`: the conditions are about tasks that discriminate, not
about cells. What `n` buys is how much a single flake can move one task's rate —
at `n = 2` one cell is 50 points of a task, at `n = 4` it is 25 — and how often a
task lands with no scorable cell at all. Round 2 is the demonstration: the entire
`≈ host` reading rests on one task at 0.50, which is two cells out of four.

## What the run is allowed to change afterwards, and what it is not

**Allowed:** the harness, over a development task; the wording of a report; a
second capture with the cause of the difference named.

**Not allowed:** the tasks (they are fixed by
[`fixtures.sha256`](fixtures.sha256)); the split between development and held out,
and the headline set derived from it ([`split.json`](split.json)); this file; the
prediction in [`prediction.md`](prediction.md); the arms in [`arms.md`](arms.md);
the promise in [`protocol.md`](../protocol.md). A change to any of those after a
result exists makes that result a pilot, not a measurement, and it has to be said
in that word.

**And the re-freeze does not widen that list.** This file was rewritten once, with
no cell of the round run and no mechanism of it built, and the arms it swapped were
the only thing swapped. What made that admissible is that there was no result to
choose it against; after the first cell, there is, and the paragraph above is then
the whole of what may move.
