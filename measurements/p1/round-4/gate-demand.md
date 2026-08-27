# What the happy-path gate demands — pre-registration

**Frozen 2026-08-27, before the first cell.** This file fixes the arm, the tasks, the runs, the
reading and the refusals. It may not be edited once a cell of this measurement exists.

It is written by someone who has not seen a `base` cell of round 4, because that is the whole of a
pre-registration.

---

## 1. The question, and it is about the TASKS

Round 4's sieve report says, of its own capture:

> *it did not measure `base` or `host`. Whether an arm without the decision can pass these tasks'
> happy-path gates is **unmeasured**, and there is an **inspection** rather than a number in the
> delivery's report: **8 of the 16 gates demand a value that only the decision carries**.*

**This measurement turns that inspection into a number, and nothing else.**

A task whose happy-path gate cannot be passed without the decision does not measure whether an agent
**reasoned** with a rule. It measures whether the agent **received** the rule at all — a weaker
claim, and one round 5 must not be built on unknowingly.

## 2. What it is NOT allowed to decide

- **It is not a comparison.** No arm is scored against another. The sieve already established that
  15 of these 16 tasks sit at the ceiling; nothing here revisits that.
- **A `CONFORMS` from `base` is NOT evidence that the record adds nothing.** It is evidence that
  **that task's gate** does not demand the decision. The subject is the task.
- **No cell of this measurement counts toward any arm's rate**, in this round or any other. It
  belongs to task design, and the capture says so in its own README.
- **It does not revive round 4's comparison.** `headline.json` says `comparison_runs: false` and that
  stands.

## 3. The arm, the tasks, the runs

| | |
|---|---|
| **arm** | `base` — the arm with no decision in front of it, and the only one that answers the question |
| **tasks** | the **16 candidates** of round 4, read from the frozen `split.json` — not a subset, not a re-selection |
| **runs** | **n = 1** |
| **cells** | **16** |

**Why `base` alone.** `host` would answer a different question — whether the coding agent's own
memory carries the value — and that question is not what round 5's design needs. Adding it doubles
the spend for a fact this measurement does not use.

**Why n = 1.** The reading below is a **floor**, not a rate: one `BROKEN` proves the gate can refuse
an arm without the decision. A single cell cannot prove the opposite, and §5 says exactly what an
all-`CONFORMS` task is allowed to mean.

## 4. What is read, and it is already in the record

**No change to the scorer, the fixtures or the discriminants.** The verdict vocabulary is already
`CONFORMS` / `VIOLATES` / `BROKEN`, and **`BROKEN` is the word the task's own discriminant emits when
the happy-path gate refuses** — the same reading the sieve report used when it removed
`a27-payout-cutoff` for refusing 3 of its 8 cells on that gate.

`RULER_BROKEN` is **not** a verdict and is never counted as one. A cell that cannot be scored is
re-run once; if it cannot be scored twice, it is published as unscorable and named.

## 5. The reading, fixed before the number

For each of the 16 tasks, `base` produces one verdict:

| verdict from `base` | what it says about the TASK |
|---|---|
| **`BROKEN`** | the gate **demands** something the arm without the decision does not have |
| `VIOLATES` | the gate **passes** without the decision; the task discriminates on the rule, which is what a task should do |
| `CONFORMS` | the gate passes **and** the arm got the rule right without being told — the task discriminates on nothing |

**The headline number is the count of `BROKEN` over 16.**

**And it is compared to one prior claim, declared here:** the delivery's inspection said **8 of 16**.
- **6 ≤ BROKEN ≤ 10** — the inspection is confirmed within its own coarseness.
- **BROKEN < 6** — the inspection **overstated**, and round 5 may reuse more of this task shape than
  it thought.
- **BROKEN > 10** — the inspection **understated**, and the mechanism-1/4 task shape is worse than
  the sieve already showed.

**Every one of the three is an answer.** None of them cancels the round-4 finding, which was about
mechanisms and stands on the rates already published.

## 6. What round 5 is allowed to take from this

**Only this:** a task whose gate `base` cannot pass is a task that measures reception, not reasoning,
and round 5 declares for each of its tasks whether it is of that kind — **before** its first cell.

It takes **nothing** about arms, channels or the push.

## 7. The refusals

- **The bench runs alone.** No other work in the session window. A shared tree already invalidated a
  spend-once round.
- `--selftest` green before anything spends.
- Sandboxes are the harness's own; nothing is written to the working tree.
- The capture is published whole, including cells that failed, and **no cell of it is ever counted as
  a measurement of any arm**.
- If the spend exceeds **$2.00**, the run stops and says where. The estimate is ~$0.60 at round 4's
  observed per-cell cost; a 3× overrun is a fact about the instrument and worth stopping for.
