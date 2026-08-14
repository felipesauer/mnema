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
| every arm ties on axis A | either the tasks are not unrecoverable enough — a design defect, and the preflight should have caught it — or the agent re-derives everything, which is an earlier round's finding generalised |
| any arm wins on axis B | **contamination. No number from the run counts** |

## What the run is allowed to change afterwards, and what it is not

**Allowed:** the harness, over a development task; the wording of a report; a second capture
with the cause of the difference named.

**Not allowed:** the tasks (they are fixed by [`fixtures.sha256`](fixtures.sha256)); the split
between development and held-out ([`split.json`](split.json)); this table; the promise in
[`protocol.md`](protocol.md). A change to any of those after a result exists makes that result
a pilot, not a measurement, and it has to be said in that word.

## One thing this file does NOT yet fix, said out loud

**The table reads `>` and `≈`, and the threshold that separates them is not decided.** With
n=4 per (task, arm) and six axis-A tasks, each arm's headline is a conformance rate over 24
cells, and "greater" and "about equal" over such a rate is a decision — about how large a
difference has to be to count, and about what is done with cells that fail their correctness
gate.

It is a decision about the experiment, so it is not taken here. But it has to be taken
**before the first cell runs**, and written into this file: chosen afterwards, it is exactly
the thing this directory exists to prevent, because the number would then be looked at first
and the rule for reading it chosen second.
