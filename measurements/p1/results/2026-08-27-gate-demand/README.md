# Round 4 · what the happy-path gate demands

> **NO CELL OF THIS CAPTURE IS A MEASUREMENT OF ANY ARM.** It ran one arm, `base`, and its subject
> is the **task**, not the arm. Nothing here counts toward `base`'s rate — or any other arm's — in
> round 4 or in any other round, and no number in it may be quoted as evidence about what the record
> adds or fails to add. A `CONFORMS` here says *this task's gate does not demand the decision*; it
> does **not** say the record was unnecessary.

**16 cells — the 16 candidates of [`../../round-4/split.json`](../../round-4/split.json) × `base` ×
1 run.** Pre-registered whole in
[`../../round-4/gate-demand.md`](../../round-4/gate-demand.md), frozen 2026-08-27 before the first
cell, by somebody who had not seen a `base` cell of round 4.

| | |
|---|---|
| capture | **16 cells**, 16 of 16 resolved, every one `status: ok` |
| ran | 2026-08-27, 18:01–20:28 UTC, in a dedicated worktree |
| instrument failures | **zero.** No `RULER_BROKEN`, no `harness_error`, no vendor refusal (`result_is_error` false and `api_error_status` null in all 16) |
| model | `claude-haiku-4-5-20251001`, fixed, in every line |
| product build | **one digest across all 16** — `721bddce3ca70068`, 298 files |
| schema | `mnema-bench/cell/8` |
| cost | **$0.9167**, $0.0573 a cell |
| what is counted as a measurement of an arm | **nothing.** See the first paragraph |

## The number this capture exists for

**`BROKEN` on 6 of 16.** The pre-registration's §5 fixed the three bands before the number:
`< 6` the delivery's inspection overstated · `6–10` it is confirmed within its own coarseness ·
`> 10` it understated. **Six lands inside the confirmed band, on its lower edge.**

| verdict from `base` | tasks | what it says about the TASK |
|---|---|---|
| **`BROKEN`** | **6** | the gate **demands** something the arm without the decision does not have |
| `VIOLATES` | 5 | the gate **passes** without the decision, and the task discriminates on the rule |
| `CONFORMS` | 5 | the gate passes and the arm got the rule right unprompted; the task discriminates on nothing |

**Read it as a floor, not as a rate.** `n = 1`. One `BROKEN` proves a gate *can* refuse an arm
without the decision; one `CONFORMS` proves nothing about the other direction. So the honest
sentence is **at least 6 of these 16 gates demand a value only the decision carries** — the other
ten are one observation each and are not shown to be passable.

## Every task, one line

`mech` is the room-mechanism [`../../round-4/sieve.md`](../../round-4/sieve.md) §2 declares for that
task. `sieve` is `mnema-doc`'s conforming rate from
[`../2026-08-24-sieve/`](../2026-08-24-sieve/), for context only — **the two captures are never
added together.**

| task | mech | `base` verdict | files changed | what the discriminant said | sieve |
|---|---|---|---|---|---|
| `a25-late-fee` | 1 | **`BROKEN`** | **0** | `Installment::lateFee is not implemented` | 1.000 |
| `a26-freight-band` | 4 | **`BROKEN`** | **0** | `freight_cents is not implemented` | 1.000 |
| `a27-payout-cutoff` | 2 | **`BROKEN`** | 1 | a Tuesday request settled 2027-05-20, not 2027-05-19 | 0.400 |
| `a28-plan-change` | 3 | **`BROKEN`** | 1 | an upgrade from 49.00 to 99.00 on day ten charged 1667, not 3333 | **0.714 — the sieve's only survivor** |
| `a29-exempt-lines` | 1 | **`BROKEN`** | 1 | an invoice of taxed lines claimed 30000 exempt, not 0 | 1.000 |
| `a30-retry-budget` | 3 | `VIOLATES` | 1 | — | 1.000 |
| `a31-effective-at` | 4 | `CONFORMS` | 1 | — | 1.000 |
| `a32-discount-stack` | 2 | `VIOLATES` | 1 | — | **0.000** |
| `a33-branch-registration` | 1 | `CONFORMS` | 1 | — | 1.000 |
| `a34-usage-rollover` | 3 | `VIOLATES` | 1 | — | 1.000 |
| `a35-dunning-pause` | 4 | `VIOLATES` | 1 | — | 0.875 |
| `a36-credit-note-order` | 2 | `CONFORMS` | 1 | — | 1.000 |
| `a37-sla-clock` | 3 | `CONFORMS` | 1 | — | 1.000 |
| `a38-reversal-period` | 1 | `VIOLATES` | 1 | — | 1.000 |
| `a39-quota-reset` | 2 | **`BROKEN`** | 2 | an account with 250 of its allowance left started with 1250, not 1000 | 1.000 |
| `a40-competence-month` | 4 | `CONFORMS` | 1 | — | 1.000 |

**Two of the six refusals are of a stronger kind, and the line that says so is `files_changed: 0`.**
On `a25-late-fee` and `a26-freight-band` the arm without the decision wrote **nothing at all** and
ended its turn asking for the rule — *"I need to know: what's the late fee rate? Does the rate vary
by contract kind?"*, *"the task describes the inputs but doesn't specify the actual pricing rules"*.
Those two gates do not merely demand a value the arm guessed wrong; the arm could not begin. The
other four wrote working-shaped code that the happy-path gate refused on a value.

## The mechanism cross-tab, and what it does NOT support

| mechanism | tasks | `BROKEN` |
|---|---|---|
| 1 · the rule is one among many (a table) | `a25` `a29` `a33` `a38` | **2 of 4** |
| 2 · two rules compose (an order) | `a27` `a32` `a36` `a39` | **2 of 4** |
| 3 · the rule holds under a condition | `a28` `a30` `a34` `a37` | 1 of 4 |
| 4 · several seem to fit, one does (a table) | `a26` `a31` `a35` `a40` | 1 of 4 |

The sieve report called the gate demand *"a second consequence of the table mechanisms"*. **This
capture does not support that attribution**: 3 of the 6 refusals come from the two table mechanisms
and 3 from the other two, which is what an even split across a balanced design looks like. The
inspection's count is confirmed; its explanation is not, and at `n = 1` per task this capture is not
powered to settle it either way.

## What this capture does not decide

- **nothing about any arm.** Repeated because it is the only way to misread this directory;
- **nothing about round 5's design**, which is not fixed here;
- **nothing about the ten non-`BROKEN` tasks' gates in general** — one cell each;
- **nothing about round 4's own finding**, which is about mechanisms and stands on the rates already
  published in [`../2026-08-24-sieve/`](../2026-08-24-sieve/).

## What is committed here

`cells.jsonl` and this file. **All sixteen candidates are held-out tasks**, so their raw output and
diffs describe tasks that have not been revealed and stay out of this tree — the same rule, for the
same reason, as [`../2026-08-24-sieve/`](../2026-08-24-sieve/) and the two rounds before it.
