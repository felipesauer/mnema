# What round 4 predicts, and what would falsify it

**Committed before the comparison's first cell.** It is checked **per cell**, against a column
that already exists in every line, and the rule for when it is not read at all is here rather
than decided afterwards.

**And it was written AFTER the sieve, which is declared rather than hidden.** The sieve's cells
are discarded by [`sieve.md`](sieve.md) and none of them is counted in any number the comparison
publishes — but they exist, they are published, and the figures in §2 below came out of them. A
prediction informed by a pilot is what a pilot is for; a prediction informed by the round's own
cells would be a description. The distinction is the discard rule, and it is the only thing
holding this file apart from a report.

---

## 1. The prediction, in one sentence

> **A push that arrives after the first write cannot act on a task the first write settled**, so
> `mnema+` ≈ `mnema-doc` is what this file predicts on any task whose cells report
> `mcp_pushed = 1`. A difference between the two arms has to appear where the channel had a turn,
> and `mcp_pushed ≥ 2` is the only column that says it had one.

This is round 3's prediction, unchanged in mechanism and changed in one fact: round 3 declared it
uniformly over all ten of its tasks and **not one cell of that round reached 2**, so the
prediction held and said nothing about the channel. Round 4 is not uniform, and §2 is why.

## 2. What the sieve measured about arrival, and it is not zero

Over the **22 real cells** of [`../results/2026-08-24-sieve-aborted/`](../results/2026-08-24-sieve-aborted/) — `mnema-doc`, the push switched off, the host still dispatching before every matched edit:

| `mcp_pushed` | cells | what it means |
|---|---|---|
| 1 | **20** | one dispatch, so at most one matched edit. The push could not have acted |
| **2** | **1** | `a30-retry-budget`, 16 turns. **A second dispatch happened**, so there was a write the pushed text arrived before |
| 0 | 1 | `a27-payout-cutoff`, beside `files_changed: 0` — the cell the vendor refused. Not a zero, and under schema 8 it is `harness_error` rather than a cell at all |

**One cell in twenty-two, against zero in eighty.** That is the whole of what the harder tasks
bought on this axis, it is measured rather than hoped for, and it is small. The round is designed
around it rather than against it: `a30-retry-budget` is the task where this prediction is
refutable, and the round says so before it runs.

## 3. Per task, and the mechanism is why

Every candidate is expected to be **decided on the first write** — the protocol's task shape is
one function, one edit, and a repository with no test suite for the agent to run against — with
the exception the sieve measured. The mechanism a task uses is what makes a second write likely or
not, and that is stated per task rather than averaged:

| task | mechanism | first write settles it? | why |
|---|---|---|---|
| `a25-late-fee` | 1 · one among many | yes | once the family is chosen, the schedule is one expression |
| `a26-freight-band` | 4 · several fit | yes | selecting the charged weight happens before the write |
| `a27-payout-cutoff` | 2 · compose | yes | two rules, one function, one edit |
| `a28-plan-change` | 3 · condition | yes | the condition is a branch in the same edit |
| `a29-exempt-lines` | 1 · one among many | yes | the selection is a set literal |
| `a30-retry-budget` | 3 · condition | **not always** | **measured**: 2 dispatches in 1 of 2 sieve cells. The rule has three clauses and a named exception, and the agent revised |
| `a31-effective-at` | 4 · several fit | yes | one table, one edit |
| `a32-discount-stack` | 2 · compose | yes | order and ceiling in one expression |
| `a33-branch-registration` | 1 · one among many | yes | one lookup |
| `a34-usage-rollover` | 3 · condition | yes | one guard |
| `a35-dunning-pause` | 4 · several fit | yes | an ordered chain of returns |
| `a36-credit-note-order` | 2 · compose | yes | two orders, one loop |
| `a37-sla-clock` | 3 · condition | yes | one pass over the log |
| `a38-reversal-period` | 1 · one among many | yes | one ternary |
| `a39-quota-reset` | 2 · compose | yes | one sum |
| `a40-competence-month` | 4 · several fit | yes | one match expression |

**Only the tasks the sieve keeps are read for this**, and the ones it drops are not read at all —
including `a30-retry-budget` if it does not survive. That is the honest consequence of sieving
after predicting per task: the task this prediction is most refutable on can leave the round, and
if it does, the round is back to being uniform and its `≈` means what round 3's meant.

## 4. How it is read

| outcome | reading |
|---|---|
| the prediction holds | the tasks where the push had no later write to act on are the tasks where the two arms tie. The `≈`, if that is the row, has a mechanism and not only a number |
| the prediction fails | the two arms differ on a task where `mcp_pushed = 1` throughout, so the push **could not have acted** — and then the difference is not the push, whatever else it is. **That is worth more than a confirmed number without an explanation**, and the round owes a name for it out of its own data |
| **`mcp_pushed` is `null` on either mnema arm for a task** | **the prediction is not read on that task at all.** Not read loosely, not read from `num_turns`: not read. The column is what makes the claim checkable |
| **no headline task reaches `mcp_pushed ≥ 2`** | **the round has more power and the same blind spot.** The sieve buys room in the RATE, not room for the channel to arrive in time. An `≈` on the pair then means exactly what round 3's meant — *the push does not help WHERE IT CURRENTLY ARRIVES* — and it says so instead of claiming more |

**The last row is the one to read first, and it is the limit this round could not design away.**
The sieve makes the tasks hard enough for the document's rate to move off the ceiling. It does
nothing about *when* the per-edit text lands, which is after the tool result of the edit that
triggered it. Those are two different constraints and only one of them was in this round's reach.

## 5. What no column here answers

`mcp_pushed` counts dispatches the host made. It does not say the model read what arrived, and it
cannot tell a host dispatch from the agent calling the same tool itself — so a second count proves
the channel spoke twice, never that a later write consumed what it said. It is a **necessary and
not a sufficient** condition, and that is unchanged from round 3.
