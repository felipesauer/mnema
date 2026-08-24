# Round 4's sieve — one candidate of sixteen survived, and the comparison does not run

**The four mechanisms that were supposed to leave room did not leave it.** Sixteen tasks were
written so that the opening document would not suffice on its own — a rule that is one of many, two
rules that compose, a rule that holds under a condition, several rules of which one applies — and
`mnema-doc` scored **1.000 over eight runs on eleven of them**. By
[`round-4/sieve.md`](../../round-4/sieve.md) §5, frozen before the first cell, **fewer than four
survivors means the comparison does not run.** One survived.

| | |
|---|---|
| capture | **128 cells** — 16 candidates × `mnema-doc` × 8 runs, the pre-registered sieve |
| ran | 2026-08-24, 18:03–19:34 UTC, in a dedicated worktree |
| resolved | **128 of 128**, every one `status: ok`. **Zero instrument failures** |
| model | `claude-haiku-4-5-20251001`, fixed, in every line |
| product build | one digest across all 128 cells |
| schema | `mnema-bench/cell/8` |
| cost | **$8.7620**, $0.0685 a cell |
| what is counted as a measurement | **nothing.** The sieve's cells are discarded by its own rule |

---

## The rates, and the band that was fixed before them

Kept: a rate at or above 0.25 and at or below 0.75, over at least 6 scorable cells.

| task | mech | scorable | conforms | rate | kept |
|---|---|---|---|---|---|
| `a25-late-fee` | 1 | 7 | 7 | **1.000** | — too easy |
| `a26-freight-band` | 4 | 8 | 8 | **1.000** | — too easy |
| `a27-payout-cutoff` | 2 | **5** | 2 | 0.400 | — **in the band, and dropped: 5 scorable, under the floor of 6** |
| `a28-plan-change` | 3 | 7 | 5 | **0.714** | **KEPT** |
| `a29-exempt-lines` | 1 | 8 | 8 | **1.000** | — too easy |
| `a30-retry-budget` | 3 | 8 | 8 | **1.000** | — too easy |
| `a31-effective-at` | 4 | 8 | 8 | **1.000** | — too easy |
| `a32-discount-stack` | 2 | 8 | 0 | **0.000** | — too hard |
| `a33-branch-registration` | 1 | 8 | 8 | **1.000** | — too easy |
| `a34-usage-rollover` | 3 | 8 | 8 | **1.000** | — too easy |
| `a35-dunning-pause` | 4 | 8 | 7 | 0.875 | — too easy |
| `a36-credit-note-order` | 2 | 6 | 6 | **1.000** | — too easy |
| `a37-sla-clock` | 3 | 7 | 7 | **1.000** | — too easy |
| `a38-reversal-period` | 1 | 8 | 8 | **1.000** | — too easy |
| `a39-quota-reset` | 2 | 7 | 7 | **1.000** | — too easy |
| `a40-competence-month` | 4 | 8 | 8 | **1.000** | — too easy |

**Retention 1 of 16, 6.2%.** Two candidates landed inside the band by rate; one of them,
`a27-payout-cutoff`, was removed by the scorable floor because its own discriminant refused 3 of
its 8 cells on the happy-path gate.

## What it says, by mechanism, and this is the finding

| mechanism | the four rates | off the ceiling |
|---|---|---|
| **1 · the rule is one among many** | 1.000 · 1.000 · 1.000 · 1.000 | **0 of 4** |
| **4 · several rules seem to fit, one does** | 1.000 · 1.000 · 1.000 · 0.875 | **0 of 4** |
| 3 · the rule holds under a condition | **0.714** · 1.000 · 1.000 · 1.000 | 1 of 4 |
| 2 · two rules compose | **0.400** · **0.000** · 1.000 · 1.000 | **2 of 4** |

**The two mechanisms that carry a TABLE saturated every task they were used on.** Selecting the
applicable rule out of five contract families, six kinds of invoice line, five registration rules
or four competence rules is not work for this model with the table in front of it: it read the
table and picked right, eight times out of eight, on all eight of those tasks.

**Both mechanisms that produced anything are about ORDER, not about selection.** `a32-discount-stack`
— discounts added against list, with a ceiling on the sum — came back **0 of 8**: the agent
compounds the discounts and applies the ceiling to each, with the rule stating the opposite in front
of it. `a27-payout-cutoff` — date the request, then count the banking day — came back 2 of 5.

**So "the document does not suffice" is a property of composition, not of size.** A decision that
carries more rules does not become harder to apply; a decision whose rules do not commute does.

## What this round therefore cannot do, and what it costs

**The comparison does not run.** Condition 1 of a reading needs at least four eligible tasks, one
task cannot carry a headline, and `sieve.md` fixed that refusal before any cell existed rather than
after this table appeared. **There is no `reading.md` for round 4**: a pre-registration of a
comparison that a frozen rule refuses is a pre-registration of nothing.

**The tasks were not touched and will not be.** Fifteen of the sixteen candidates are unspent by
any comparison and stay held out. Repairing a task against its own sieve result is iterating on a
held-out task, which is the one thing this round's split forbids outright — and by the time these
rates existed, whoever edited them would be editing while knowing them.

**What was spent to learn it:** $8.7620 on the sieve, $1.2947 on the attempt that a session limit
aborted, $0.1662 on the round's four-cell pilot — **$10.22 in total**, against a comparison that
would have cost about $13 more and produced a number about one task.

**And the cost per cell is 49% above round 3's.** $0.0685 against $0.046, because these decisions
are larger: a five-family schedule or a six-line exemption table is more input than a single rule.
A round designed this way costs more per cell before it buys anything.

## What the sieve did NOT find, said plainly

- **it did not measure `mnema+`.** The push never ran in this capture; the arm here is
  `mnema-doc` with the channel switched off, and `channel_served` is empty in all 128 lines;
- **it did not measure `base` or `host`.** Whether an arm without the decision can pass these
  tasks' happy-path gates is **unmeasured**, and there is an inspection rather than a number in
  the delivery's report: 8 of the 16 gates demand a value that only the decision carries, which is
  a second consequence of the table mechanisms;
- **it did not show that the push would fail.** It showed that the tasks these mechanisms produce
  do not put the document below the ceiling, which is a fact about the tasks.
