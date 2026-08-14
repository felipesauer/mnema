# How each outcome of P1 is to be read

**This table is committed before the first cell runs**, so that no outcome can be rationalised
after it appears. It is not a prediction and it is not a hope: every row below is an outcome
this protocol can produce, and the right-hand column is what the project will say if it does.

Three of the five rows are outcomes in which the product's first promise does **not** survive.
That is the point. A protocol whose every branch flatters the thing it measures is not a
measurement.

| outcome | reading |
|---|---|
| `mnema` > `base`, and `mnema` ≈ `prosa` | **the value is the proof, not the retrieval.** The first promise is misplaced, and the product's axis rests on the second and third promises instead. This is a good and true result |
| `mnema` > `prosa` and `mnema` > `host` | the first promise holds, and the number is the conformance rate |
| `mnema` ≈ `host` | **the host's automatic memory covers the case**, and what is left of the product is the proof. This is also an answer |
| every arm ties on the headline | either the tasks are not unrecoverable enough — a design defect, and the preflight should have caught it — or the agent re-derives everything, which is an earlier round's finding generalised |
| any arm wins on axis B | **contamination. No number from the run counts** |

## What the headline is a number about

**The four held-out axis-A tasks, and only those.** They are named in
[`split.json`](split.json) under `headline` — that is where a program reads them from, so that
one file decides it and not two. With n=4 per (task, arm), each arm's headline is a conformance
rate over 16 cells.

| task | axis | in the headline |
|---|---|---|
| `a1-rounding` | A | no — **development**: the harness is free to be iterated against it |
| `a2-due-day` | A | **yes** |
| `a3-idempotency` | A | no — **development** |
| `a4-collation` | A | **yes** |
| `a5-no-retry` | A | **yes** |
| `a6-partner-code` | A | **yes** |
| `b1-csv-quotes` | B | no — negative control: read for the tie, never for the headline |
| `b2-moving-average` | B | no — negative control |

The two development tasks are run, scored and published like every other cell. They are simply
never folded into the headline, because the harness may be fixed against them until it works,
and a task the harness was fixed against measures the harness as much as it measures the arm.
This is the second half of a rule this protocol borrowed and had at first copied only half of:
a benchmark that keeps a small development set to tune against publishes its **final score over
the held-out set alone**.

## How the rate is computed, and what `>` and `≈` mean

**Two levels, and both are published.** A conformance rate per task over its n=4, then the mean
of those four rates. This is the aggregation a published agentic benchmark elsewhere uses — the
mean across a tier's tasks, each task itself averaged over its runs — and it is used here for
its reason: an arm that takes one task 4/4 and loses the other three is not an arm that works,
and one pooled number over all the cells hides exactly that.

**The dispersion travels with the aggregate, always.** The four per-task rates are printed
beside it, agreeing or not. An aggregate published alone is the shape that forces a later
correction of the *"the maximum is a single best case, not the typical result"* kind, and the
correction never travels as far as the number did.

**One arm is read as `>` another only when both of these hold at once:**

1. the aggregates differ by **more than 25 percentage points**, and
2. the direction repeats in **at least 3 of the 4** held-out axis-A tasks.

**Anything else is `≈`.** Not "inconclusive", not "a trend", not "suggestive": `≈`, and the row
of the table above that carries it.

**The 25 points are not a chosen number.** With four tasks, one whole task is worth 25 points —
so a difference of 25 or less can be produced by a single task while the other three tie, and a
headline built on that would be a headline about one task. The second condition is the same
defect approached from the other side: published agentic results elsewhere swing from near-total
success on one task to near-zero on another in the same tier, so a large mean with a single task
under it is the expected shape of an accident, not of an effect.

**And the asymmetry is deliberate.** Calling `≈` where an effect exists understates this
product; calling `>` where none exists publishes a false claim about it in a public repository.
The first costs a delivery of confidence, the second costs the credibility of every other number
in this directory — and the table above already treats `≈` as a good and true result, so the
conservative rule loses nothing it needs.

**No significance test, no p-value, no confidence interval.** With n=4 the arithmetic would be
ceremony over a sample that does not carry it, and the two conditions above are the whole rule.

## Cells that produce no verdict

**A `BROKEN` cell leaves the numerator and the denominator, and the count is published per
arm.** `BROKEN` is the correctness gate refusing: the produced code does not run. Conformance
measured over code that does not run would be a number about nothing, and scoring it as a
violation would merge two different things — an agent that could not write the code, and an
agent that wrote it against the decision.

**The exclusion is not silent, because a silent one hides its own worst case.** An arm that
mostly produces broken code would otherwise publish a clean rate over the few cells that
happened to run. So the count sits in the table beside each rate, and: **if any arm is `BROKEN`
in more than a quarter of its headline cells (4 of 16), the comparison is not read at all.**
That is a run to repair and run again, not a run to score.

**An instrument failure is re-run exactly once, and both attempts are kept.** `harness_error`
and `ruler_broken` are not an agent choosing anything — a missing CLI, a half-applied seed, a
discriminant that cannot load. The cell runs again, once; the failed attempt stays in
`cells.jsonl` with its status, and the reading takes the `ok` line. A cell still without a
result after its one re-run is excluded and named, and its (task, arm) publishes the n it
actually has rather than the n it wanted.

**This does not break "touched once", and it does not break it only because it is written
here.** That rule forbids iterating after seeing a result; an instrument that broke produced no
result to iterate against. A re-run decided *after* seeing which cells failed would be a choice
made about the outcome, which is exactly why the rule is committed before the first cell runs.

## What the run is allowed to change afterwards, and what it is not

**Allowed:** the harness, over a development task; the wording of a report; a second capture
with the cause of the difference named.

**Not allowed:** the tasks (they are fixed by [`fixtures.sha256`](fixtures.sha256)); the split
between development and held-out, and the headline set derived from it
([`split.json`](split.json)); this file; the promise in [`protocol.md`](protocol.md). A change
to any of those after a result exists makes that result a pilot, not a measurement, and it has
to be said in that word.
