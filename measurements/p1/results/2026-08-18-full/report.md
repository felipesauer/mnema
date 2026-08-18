# P1, first round — what it measured and what it says

**116 cells. The round is valid, and by the rule fixed before it ran, no arm is `>` any other.**

The reading below follows [`reading.md`](../../reading.md), which was committed before the first
cell. Where the rule does not cover what happened, that is said as a gap in the rule — it is not
patched here, because a rule rewritten after the number is not a rule.

## The round is valid

Both axis-B tasks tie at 4/4 for all four arms. Axis B carries no decision; an arm winning there
would mean contamination and would void every number in this file. Nothing won there.

## The table

Conformance over scorable cells; `BROKEN` — code that does not run — leaves numerator and
denominator and is counted beside them.

| task | base | prosa | host | mnema |
|---|---|---|---|---|
| `a2-due-day` * | 0/4 | 1/4 | **4/4** | 0/4 |
| `a4-collation` * | 0/4 | 2/4 | **4/4** | 0/4 |
| `a5-no-retry` * | 1/1 · 3 broken | 0/0 · 4 broken | 1/1 · 3 broken | 2/2 · 2 broken |
| `a6-partner-code` * | 4/4 | 4/4 | 4/4 | 4/4 |
| `b1-csv-quotes` | 4/4 | 4/4 | 4/4 | 4/4 |
| `b2-moving-average` | 4/4 | 4/4 | 4/4 | 4/4 |
| `a3-idempotency` (development) | 4/4 | 4/4 | 4/4 | 4/4 |

\* the four held-out axis-A tasks named in [`split.json`](../../split.json) as the headline.

**Headline**, the mean of the per-task rates over those four: **`host` 100% · `prosa` ~58% ·
`base` 50% · `mnema` 50%**.

## What the rule says

`>` required two things at once: an aggregate difference of more than 25 points, **and** the direction
repeating in at least 3 of the 4 held-out tasks.

`host` exceeds `base` by 50 points — over the threshold. The direction repeats in **2** of 4:
`a5` and `a6` separated nobody. **So no comparison in this round is `>`. Every one of them is `≈`.**

## Three gaps in the rule, found by running it

1. **The "3 of 4" condition assumes four tasks that discriminate.** Two did not: `a6` put every arm
   at 4/4, and `a5` broke most of its cells. A condition meant to stop one task from carrying the
   headline also stops two tasks from carrying it when the other two are degenerate.
2. **An arm can have no scorable cell at all.** `prosa` on `a5` is 0 of 0 — four cells, four
   `BROKEN`. The mean of four rates is undefined when one does not exist; the number above is over
   the three that do, and that choice is being disclosed, not defended.
3. **The `BROKEN` ceiling was reached exactly, not exceeded.** The rule voids the comparison when an
   arm is broken in *more than* a quarter of its headline cells. `prosa` is broken in exactly 4 of
   16. The comparison is read; a knife-edge decided it.

## What the two discriminating tasks showed

Over `a2` and `a4` together — the two where the decision is genuinely unrecoverable from the code:

**`host` 8/8 · `prosa` 3/8 · `base` 0/8 · `mnema` 0/8.**

The arm carrying the decision in the record scored what the arm carrying no decision scored.

## Why, and this part is measured

`mcp_asked` is `false` in **20 of 20** instrumented `mnema` cells. The column distinguishes three
silences; `false` is *the server started and nobody called it*, not *no server*. **The agent never
called a single tool.** On `a4` it violated four times out of four with the decision one call away.

This is not "the record does not help". It is "the agent does not ask" — a different finding with a
different fix, and without this column the round would have reported the first one.

## What this says about the first promise

The promise was: *when a recorded decision the code does not reveal exists, the agent with mnema
respects it and the agent without it violates it.* [`reading.md`](../../reading.md) has a row for
`mnema ≈ base`, and that is the row this round landed on. **The promise did not survive as written.**

What the round does not say: that a record cannot change what an agent writes. The `host` arm
carried the same decision, in a mechanism the host injects without being asked, and conformed 8/8 on
exactly the tasks where `base` conformed 0/8. The knowledge was usable. The reaching was missing.

## Cost, and a budget that was exceeded

$5.44 of vendor-reported cost over 116 cells. Measured against the account's own weekly meter, with
the run isolated from other work: **80 cells moved it 3 points** — about 0.037 points a cell. The
round consumed **5 points** where **3** had been authorized. The 128-cell design never fit the
budget it was given, and that is now a number rather than an estimate.

## What is committed here, and what is held back

`cells.jsonl` only. The raw agent output and the diffs show the code each cell produced, and code
about a task describes the task — for the held-out tasks that would reveal, before the reveal, what
[`fixtures.sha256`](../../fixtures.sha256) keeps to a digest. They are held until the tasks are
published, per the rule in [the results README](../README.md).
