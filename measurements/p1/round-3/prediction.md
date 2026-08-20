# What round 3 predicts, task by task, before it runs

**This file exists because the alternative was selection.** Round 2's `≈ host` gap
is one task — `a14-tie-break`, `mnema+` at 0.50 against `host` at 1.00 — and the
tasks of this round could have been chosen *because they resemble that one*, which
would be tuning against a result and would turn any number the round produces into
nothing. So the tasks were written by a criterion blind to the mechanism, and the
claim about them is written here, before the round, where it can be checked
afterwards against something that was frozen.

**A round in which this prediction fails is a result, not a failure.** It says the
property below is not the property that separates the arms, which is worth more
than a high number with no explanation.

## What this file predicts now, and it changed with the arms

**At this round's first freeze, this file predicted a gain.** The round then carried
an arm — `mnema++` — that moved the governing rule to **before** the model's first
write, and the prediction was that it would gain over `mnema+` wherever the first
write settles the verdict. **That arm is withdrawn and the hypothesis behind it is
refuted by round 2's own cells** ([`arms.md`](arms.md) carries the refutation and
the two rows of data that make it). What is left is not a weaker version of the same
claim. It is a different kind of claim, about the pair the round now measures:

> **A task decided on the first write is a task the per-edit push CANNOT have acted
> on.** The push arrives with the result of the edit that triggered it, so on such a
> task it arrives after the bytes that settle the verdict. `mnema+` and `mnema-doc`
> differ only in that push. **So on a task decided on the first write, `mnema+` ≈
> `mnema-doc` is what this file predicts** — not as a hope about the product, but as
> the only thing the mechanism permits.

**That is falsifiable, and it is checkable per cell rather than per round.** The
column is `mcp_pushed`, it already exists, and round 2's committed cells carry it.

| what a cell says | what it means for this prediction |
|---|---|
| `mcp_pushed = 1` | one dispatch to the cell's own server, so **at most one matched edit**. The push had nothing later to act on, and a tie between the two arms on that cell is **expected** and says nothing about the channel's value |
| `mcp_pushed ≥ 2` | the channel spoke more than once, so there was a write the pushed text arrived **before**. **This is the only place a difference between the two arms can come from the push.** Necessary and not sufficient: the bench cannot tell a host dispatch from the agent calling the same tool itself |
| `mcp_pushed = 0` beside a changed file | the push never fired although the agent wrote — an **invalid cell**, named as one, with both causes the bench cannot separate stated |
| `mcp_pushed = null` | the column cannot answer, and [`reading.md`](reading.md) then does not read this prediction on that task at all |

**And the direction it can fail in is stated now.** If the two arms **differ** on a
headline task whose `mnema+` cells all carry `mcp_pushed = 1`, then the difference
is not the push — the push could not have acted there — and the round owes a name
for whatever it was, out of its own data. If they differ **only** on tasks whose
cells reach 2, the prediction has held and the push has a measured mechanism.

## Where the mechanism was measured

The capture of 19 Aug 2026 in [`../../mcp-tool-channel/`](../../mcp-tool-channel/)
replaced the model API with a stand-in and read the requests the real host sends.
What it measured about this product's per-edit channel:

> **Where it lands.** In the request after the edit, as a message of its own —
> **after** the tool result, not before it. So the rule arrives with the outcome of
> the edit that triggered it: in time for every later edit of the session and for a
> correction of that one, and not in time to shape the first one's bytes.

Everything above follows from that sentence and from the count of dispatches. It is
the product's own behaviour, measured against the real host, and it is why *"the
push could not have acted"* is a statement about mechanism rather than an inference
from a rate.

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

**Unchanged from the first freeze, and it is unchanged because it is still true.**
The criterion above is about the shape of a task, and nothing about withdrawing an
arm changes the shape of a task.

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
later-decided ones, because it contains none of the latter.

**And building a later-decided task on purpose would have been the selection this
file exists to avoid.** Varying the task shape along the mechanism's own axis is
choosing tasks by mechanism, which is the thing the split is frozen to prevent. The
honest move is to declare the uniformity and pay for it.

**What survives the uniformity is the cells, and that is the change this re-freeze
buys.** At the first freeze the prediction was about the *set*, and a set of ten
identically-shaped tasks can only be checked in aggregate. Read as **possibility**
instead, the unit is the cell: the same ten tasks now carry a per-cell condition,
because whether a second write happened is a fact about a run and not about a task.
A task classified *first write* whose cells come back with `mcp_pushed ≥ 2` is a
task where the agent wrote again anyway — the classification was about what the
ticket forces, never about what an agent will do — and **those cells are where the
push had its chance**. The prediction is that the two arms tie where the count is 1,
and it is refuted if they do not.

## What the two arms cannot tell apart, said plainly

`mnema-doc` and `mnema+` differ in one switch position, so a difference between them
is the push. **What neither arm isolates is WHERE the push arrives.** If the two tie,
this round says the push does not help *as it currently arrives*, and it does not say
that no arrival point would. The arm that would answer that is the one withdrawn from
this round, and it is worth building only if this round shows the push acting at all —
which is the order [`arms.md`](arms.md) argues for and the reason the withdrawal is
not a retreat.

## The one way this freeze is weaker than round 2's, and it is not hidden

Round 2's tasks were frozen by someone who did not know what the mechanism would
do, because the mechanism did not exist. **Round 3's were written by someone who
knew round 2's result and had already formed a hypothesis about its one bad task.**
No digest can fix that. What was done instead:

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
4. **the hypothesis those tasks were written under is the one this round withdrew.**
   The arm that tested it is gone and the tasks stayed, which is the opposite of
   tuning: a set chosen to suit a mechanism does not survive the mechanism being
   dropped, and the reason this one does is that the criterion never mentioned it;
5. **this paragraph**, which is the only real protection: the reader is told that
   the freeze is weaker and in which direction.
