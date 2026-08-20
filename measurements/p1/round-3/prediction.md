# What round 3 predicts, task by task, before it runs

**This file exists because the alternative was selection.** Round 2's `≈ host` gap
is one task — `a14-tie-break`, `mnema+` at 0.50 against `host` at 1.00 — and there
is a measured hypothesis about why. Choosing round 3's tasks *because they resemble
that one* would be tuning against a result, and it would turn any number the round
produces into nothing. So the tasks were written by a criterion blind to the
mechanism, and the claim about them is written here, before the round, where it can
be checked afterwards against something that was frozen.

**A round in which this prediction fails is a result, not a failure.** It says the
hypothesis below is wrong, which is worth more than a high number with no
explanation.

## The hypothesis, and where it was measured

The capture of 19 Aug 2026 in [`../../mcp-tool-channel/`](../../mcp-tool-channel/)
replaced the model API with a stand-in and read the requests the real host sends.
What it measured about this product's per-edit channel:

> **Where it lands.** In the request after the edit, as a message of its own —
> **after** the tool result, not before it. So the rule arrives with the outcome of
> the edit that triggered it: in time for every later edit of the session and for a
> correction of that one, and not in time to shape the first one's bytes.

The hypothesis follows from that sentence and from nothing else: **on a task whose
verdict is settled by the bytes of the first write, the rule arrives too late.**
`host` carries the same knowledge in the model's context from the first token, and
`host` scored 4/4 on `a14` where `mnema+` scored 2/4. `prosa` — the decision in a
committed file the agent has to open — also scored 2/4 there.

`mnema++` is the arm that tests it: the same product, the same charge, the rule in
front of the model **before** its first write.

## The criterion, declared before any task was classified

> **A task is DECIDED ON THE FIRST WRITE when a conforming solution and a
> violating solution are both single-edit solutions of the same function, and
> neither the ticket nor the happy path forces the agent to write again.** The
> choice between the two readings is then made in the bytes of the first edit, and
> a channel that arrives with the result of that edit arrives after the decision.
>
> **A task is DECIDED LATER when the natural first draft has to be edited again
> before it works** — it throws, it misses a case the ticket names, or it leaves a
> stated contract unused — so a rule arriving with the first edit's result arrives
> before the bytes that settle the verdict.

## The classification, and it is uniform

| task | axis | headline | expected | why |
|---|---|---|---|---|
| `a15-commission-base` | A | no | **first write** | one method, `commissionOwed`. Both readings are a sum and a multiplication; the violating one is a single call to `invoicedTotal()`, and it passes the happy path (a period with nothing outstanding) unchanged |
| `a16-event-order` | A | no | **first write** | one method, `timeline`. Both readings are a `sorted(...)` with a different key, and the violating key is also the order the entries were added in — so even doing nothing passes the happy path |
| `a17-billed-seats` | A | **yes** | **first write** | one method, `billedSeats`. The violating reading is `members().length`; nothing about it fails on a workspace where everybody signed in inside the cycle |
| `a18-dunning-recipients` | A | **yes** | **first write** | one method, `dunning_recipients`. The violating reading reads one documented field, `owner_id`, and answers correctly for an account whose only member is its owner |
| `a19-batch-pick` | A | **yes** | **first write** | one method, `pickFor`. The violating reading is the first batch in the order they were received, and it picks the same batch when the batches arrived in expiry order |
| `a20-over-long-note` | A | **yes** | **first write** | one method, `store`. Truncating and refusing are each one line, and both store a note that fits, unchanged |
| `a21-session-expiry` | A | **yes** | **first write** | one method, `validAt`. Both readings are one subtraction against a different field, and both answer correctly for a session never used after it was issued |
| `a22-graduated-usage` | A | **yes** | **first write** | one method, `charge_for`. The violating reading is `rate_for(units) * units` — one multiplication — and it charges correctly for usage inside the first tier |
| `b5-column-name` | B | no | **first write** | negative control: one function, and nothing external to know. Carried here so the table covers every task rather than the ones that suit it |
| `b6-wrap-words` | B | no | **first write** | negative control, same reason |

**Ten of ten, and the uniformity is not a convenience.** It is a property of the
protocol's own task shape, which
[`protocol.md`](../protocol.md) fixed in August 2026 and which this round does not
change: *a repository that satisfies its tests, a ticket asking for one extension,
two defensible implementations that agree on the common case*. A task built that
way is a single function whose natural draft passes the happy path — so it is
first-write-decided by construction. **Every task of rounds 1 and 2 was too.**

## What that costs this prediction, said before the number

**The prediction cannot be a within-round contrast.** With every task on the same
side of the criterion, the round cannot compare first-write tasks against
later-decided ones, because it contains none of the latter. What is left is a
prediction about the **set**, and it is refutable in one specific way, stated now:

> If the hypothesis is right, `mnema++` should gain over `mnema+` **across the
> headline**, not on one task. If it gains on some of these six and not others,
> then the property this file names is not the property that separates them, and
> the prediction has failed even if the arm wins.

**And building a later-decided task on purpose would have been the selection this
file exists to avoid.** Varying the task shape along the mechanism's own axis is
choosing tasks by mechanism, which is the thing the split is frozen to prevent. The
honest move is to declare the uniformity and pay for it.

## The evidence already against the hypothesis, from round 2's own cells

**This is the part that makes the prediction harder to confirm, and it was
available before the round for nothing.** Read out of the committed
`cells.jsonl` of [`../results/2026-08-20-full/`](../results/2026-08-20-full/):

| what the data says | why it matters here |
|---|---|
| `mcp_pushed` is **1** in every one of `mnema+`'s 24 headline cells — 22 of them scorable, 2 `BROKEN` — and `channel_served` is `edit-rules-push:1` in all 24 | the channel spoke **once per cell, on the first edit**, in all six headline tasks — including the five where `mnema+` scored **1.00**. The timing the hypothesis blames was **identical everywhere**, and the outcome was not |
| `mnema+` on `a14`: turns `6, 3, 6, 3`, verdicts `VIOLATES, CONFORMS, CONFORMS, VIOLATES` | inside the one task that failed, the turn count does **not** separate a conforming cell from a violating one. Both 3-turn cells and both 6-turn cells split one each |
| `a14`'s turn counts are the **lowest** of the six headline tasks for `mnema+` (median 4.5, against 5–9.5 for the others) | this is the *supporting* half: fewer turns is less chance for a later edit to act on a rule that arrived late |
| `host` conformed on `a14` at **3 turns** as well as at 9 | knowledge already in the context settled that task in as few turns as `mnema+` took to get it wrong |

**The honest summary of those four rows: the hypothesis has one supporting
indication and one direct counter-indication, both at `n = 4`, and neither is a
test.** If *when the text arrives* were the whole story, `mnema+` should have
suffered on all six headline tasks and it suffered on one. What survives is a
narrower hypothesis — that `a14` was a task where nothing after the first write
revisited the choice — and round 3 can only check it with the column defect 5 of
[`reading.md`](reading.md) requires.

## The one way this freeze is weaker than round 2's, and it is not hidden

Round 2's tasks were frozen by someone who did not know what the mechanism would
do, because the mechanism did not exist. **Round 3's were written by someone who
knew round 2's result and had already formed this hypothesis.** No digest can fix
that. What was done instead:

1. **the task set was written to the domain criterion**, and each candidate was
   accepted or rejected on the four clauses of that criterion — both readings
   defensible, agreeing on the common case, the natural implementation being the
   violating one, and a plausible third reading landing in `VIOLATES`;
2. **`a14-tie-break`'s contents were not opened** while the new tasks were written.
   Its file names were seen in a directory listing and nothing else, which is why
   no task of this round is about ranking or about breaking a tie;
3. **the classification above was made after all ten tasks were finished**, not
   while they were being chosen, and it came out uniform — which is the outcome a
   set tuned toward the mechanism would not have produced;
4. **this paragraph**, which is the only real protection: the reader is told that
   the freeze is weaker and in which direction.
