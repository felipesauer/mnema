# The threshold, and what it protects against

**Committed before round 4 is designed, and that order is the whole of it.** A threshold changed
after a round has produced a number is a threshold chosen to fit the number, and no sentence
written afterwards repairs that. This file changes the derivation of the threshold while there is
no round waiting on it: the four rounds of simulation it rests on are in
[`threshold.mjs`](threshold.mjs), which is committed and runs with `node`, and the recount in §6
shows that not one verdict this directory has published moves.

**Rounds 1, 2 and 3 are not re-read.** Their readings
([`reading.md`](reading.md), [`round-2/reading.md`](round-2/reading.md),
[`round-3/reading.md`](round-3/reading.md)) and their reports stay exactly as they are, in the
same way round 2's reading left round 1's alone: a pre-registration is worth what the order is
worth. What follows governs round 4 and the rounds after it, and §6 is a conference — a check that
the new number would not have moved the old ones — not a re-reading of them.

---

## 1. The premise this file falsified

All three readings derive the 25 points the same way. Round 3's, line 180:

> *"The 25 points is round 1's, and its derivation is what condition 1 protects: **with four
> eligible tasks one whole task is worth 25 points**, so a difference of 25 or less can be produced
> by a single task while the others tie."*

**The derivation is the size of one task.** Two things came out of that and neither was noticed:

**The number stopped tracking the derivation.** Rounds 2 and 3 ran **six** eligible tasks, where
one whole task is worth 16.7 points, and kept 25. By accident they were stricter than their own
stated rule.

**And the rule as written is loose.** The derivation names a quantity the gap has to beat; it never
asks how often noise alone beats it. Simulated with a true effect of **zero** — the two arms given
the same rate on every task — a threshold of one whole task publishes a false `>`:

| the shape a round ran | one whole task | false `>` per pair |
|---|---|---|
| round 1, 4 tasks × 4 runs | 25.0 | **9.5%** |
| rounds 2 and 3, 6 tasks × 4 runs | 16.7 | **18.5%** |

At the shape the last two rounds ran, the rule **as written** would publish a false `>` in nearly
one null pair in five. **The 25 they inherited was better than its own reason** — it ran at 5.4%.

**The derivation is what is wrong, not the number.** So it is replaced by one that measures the
thing the threshold is for.

## 2. The rule

> **The threshold is the smallest one whose false-positive rate, under a true effect of zero, is at
> or below a declared target — simulated at the round's own shape, under every declared assumption
> about the true rates, and published with the round before its first cell runs.**

Six things are part of that sentence and each of them is a decision:

1. **The false positive is counted PER PAIR, both directions.** `X < Y` is not a third verdict —
   every comparison is read both ways — so a pair with no real difference has **two** chances to
   publish a false `>`. A derivation that measures one direction sets the threshold at twice the
   rate it claims, and that is exactly the error the study feeding this file made.
2. **Under a true effect of zero**, with both arms drawing from the same rate on each task. That is
   the state the threshold exists to refuse.
3. **At the round's own shape.** The aggregate is a mean of N task rates over R runs each, so what a
   given threshold costs depends on N and R. This is the drift §1 names: one number carried across
   two shapes meant two different rules.
4. **Under every declared assumption about the true rates, and the threshold is the strictest of
   them.** The assumption decides the number (§4), so the rule does not depend on picking the right
   one.
5. **The threshold may not be an attainable gap.** The aggregate moves in steps of 100/(N·R) points.
   A threshold placed on one of those steps leaves which side a round falls on to floating point;
   `readGreater` **refuses** rather than guessing, and the candidates it searches are the midpoints
   between steps. This is not hypothetical: at rounds 2 and 3's shape, 25 is exactly six steps.
6. **Published with the round, before its first cell.** The simulation is committed, seeded, and
   named in the round's reading, so the number and the instrument that produced it travel together.

**Conditions 1, 2, 4 and 5 of the reading do not change.** Eligibility, the `BROKEN` ceiling, the
count of discriminating tasks with the direction in more than half of them, and the negative
control are conditions of the round. Every figure in this file is measured **with** the
discriminating-task condition in force.

### The sentence a round's reading carries

So that there is one wording and not two, a reading that adopts this rule writes its condition 3 as:

> *the aggregates, each taken over the **same** eligible tasks, differ by more than **T** points,
> where T is derived by [`threshold.md`](../threshold.md) for this round's shape and printed with
> the seed that produced it.*

### And this is a significance level, which the readings say they do not use

All three readings carry the line *"No significance test, no p-value, no confidence interval"*, and
**a false-positive target is the same quantity a significance level names.** The distinction is
real but it is narrower than that line reads, so it is stated here rather than left for a reader to
catch:

- **no per-comparison statistic is published.** A round still reports rates, per-task dispersion,
  discriminating and degenerate counts. No comparison acquires a p-value, and none acquires an
  interval;
- **what changed is where the rule's own constant comes from.** It used to come from the size of a
  task; it now comes from simulating how often the rule itself is wrong. That is one number, fixed
  before the round, about the rule — not a number computed after the round, about a result.

**A rule with a constant in it has an error rate whether or not anybody measures it.** The three
rounds already had one — 9.5% and 5.4% per pair — and not measuring it is what let it drift by a
factor of two between round 1 and round 2 without anyone noticing.

## 3. The target, and why it is five per cent

**Five per cent of null pairs.** The reason has two anchors and neither of them is habit.

**It is the strictness this directory has actually been running at.** The rule rounds 2 and 3 read
under — 25 points at six tasks × four runs — is **5.4% per pair**. So a 5% target is not a
loosening of anything the record has done; it is that same strictness stated as what it is, so that
it survives a change of shape. (Round 1's four-task shape sat at 9.5%, which is the drift again.)

**And it is what the whole directory can carry.** Of the 22 pairs published across three rounds,
**11 produced no `>` at all** — about half the pairs a round reads are pairs where a false `>` is
the risk. Three more rounds is roughly 24 pairs, about 12 of them without a real effect: at 5% each
the directory expects **0.6** false `>`, and carries about a **46%** chance of ever containing one.

**That is stated rather than hidden, because it is not a promise of zero.** What makes it
acceptable is the second gate this directory already runs: every headline finding here has been
re-measured in the round after it — round 1's `mnema ≈ base` in round 2, round 2's `mnema+ ≈ host`
in round 3 — and a false `>` at 5% survives one replication one time in twenty.

**Why not stricter, measured.** At the ten-task, eight-run shape the round-4 study recommends:

| target per pair | threshold | reads `>` from | power at 15pt | at 20pt | at 30pt |
|---|---|---|---|---|---|
| 1% | 20.625 | 21.25pt | 22% | 47% | 91% |
| 2% | 19.375 | 20.00pt | 28% | 54% | 94% |
| **5%** | **15.625** | **16.25pt** | **47%** | **72%** | **98%** |
| 10% | 13.125 | 13.75pt | 60% | 82% | 99% |

**A 1% target halves the power at 15 points.** A round that costs about $16 and misses a real
15-point effect four times in five is its own kind of failure, and it is the failure this project
has already had: the round-3 study measured that under the old rule the round could see nothing
under 30 points at any price. **A 10% target puts more than one false `>` into the directory over
three rounds**, which is more than the replication gate can absorb.

**If a later round has reason to move the target, it moves it in its own reading, before its first
cell, and says what changed.** The number is not sacred; the order is.

## 4. The assumption, and what the threshold becomes if it is wrong

**This is the most fragile part of the derivation and it is not left implicit.** How often noise
alone produces a gap depends on where the true rates sit: two arms that both pass a task 95% of the
time contribute almost no noise, two at 50% contribute the most there is. **An assumption about the
tasks is an assumption about the threshold.**

The assumption the round-4 study used is **uniform between 35% and 70%** — what a sieve that keeps
only the tasks neither arm finds easy would produce. The others below are there because the rule
must not depend on it. At ten tasks × eight runs, seeded, 40,000 simulated rounds each:

| assumption about the true rates | threshold it asks for | reads `>` from | false `>` per pair |
|---|---|---|---|
| uniform 35–70% | **15.625** | 16.25pt | 4.5% |
| uniform 20–80% | **15.625** | 16.25pt | 3.6% |
| uniform 50–90% | 14.375 | 15.00pt | 3.9% |
| uniform 10–50% | 14.375 | 15.00pt | 4.1% |
| half the tasks at 30%, half at 70% | 14.375 | 15.00pt | 4.8% |
| every task at 50% | **15.625** | 16.25pt | 4.8% |

**The spread is one step — 1.25 points.** The assumption moves the threshold by less than the
granularity of the measurement, and **the rule takes the strictest**, so a sieve that lands
somewhere other than 35–70% cannot loosen the rule; at worst it makes it slightly conservative.

**That is the answer to "what if the assumption is wrong", and it is the reason the rule is written
as `the strictest across every declared assumption` rather than as `simulate under the assumption`.**
Adding an assumption to `ASSUMPTIONS` in [`threshold.mjs`](threshold.mjs) can only raise the
threshold, never lower it.

## 5. What it costs and buys at a given shape

At the shape the round-4 study recommends, ten tasks × eight runs — 160 cells, the same as round 3:

| | 25 points (the old rule) | 15.625 (this rule, 5% target) |
|---|---|---|
| reads `>` from a gap of | 25.00pt | **16.25pt** |
| false `>` per pair | 0.2% | **4.5%** |
| power at 10 points | 3% | **23%** |
| power at 15 points | 11% | **47%** |
| power at 20 points | 27% | **72%** |
| power at 30 points | 79% | **98%** |

**Four points of false positive bought thirty-six points of power at 15.** And at the shape rounds
2 and 3 ran, six tasks × four runs, **the same 5% target makes the rule stricter, not looser** —
31.250, reading `>` from 33.33 points rather than from 29.17. The rule is not a loosening dressed
as a derivation; which way it moves depends entirely on the shape, which is the point of deriving
it per shape.

**This file does not choose N and R.** The round's reading does, and then names the threshold this
instrument derives for that choice.

## 6. The record, recounted — and nothing moves

**This is a conference, not a re-reading.** Every ordered pair of every round that has run is
recomputed from the committed cells under **that round's own conditions**, changing only the
threshold. The instrument refuses to report anything if its recount does not reproduce what those
rounds published — round 1's *"no comparison in this round is `>`"*, round 2's eight of twenty
ordered pairs, round 3's three.

| | round 1 | round 2 | round 3 |
|---|---|---|---|
| pairs | 6 | 10 | 6 |
| read `>` | 0 | 8 | 3 |
| change side at 15.625 | **none** | **none** | **none** |

**And the margin is far wider than the number.** The published gaps leave an empty band: no
comparison in three rounds landed between **8.33** and **36.11** points. But the stronger fact is
this:

> **No threshold whatsoever — 25, 15.625, or 0.5 — adds a `>` to this record.** All 33 ordered
> pairs that did not read `>` were refused by the **discriminating-task and direction** conditions,
> not by the threshold. Every threshold from 0 up to 36.11 points leaves all three rounds exactly as
> they were read.

**The threshold has never yet been the condition that decided a verdict in this directory.** That
is a fact about the record, not a property of the new number, and it is what makes changing the
derivation now — rather than after a round is close to the line — a change nobody has to take on
trust. Above 36.11 the record does move, which is what makes the sentence above a measurement
rather than a tautology: at 40.5 points round 2 loses three of its eight `>`.

## 7. Running it

```
node measurements/p1/threshold.mjs                      # ten tasks x eight runs, the study's shape
node measurements/p1/threshold.mjs --tasks 6 --runs 4   # the shape rounds 2 and 3 ran
node measurements/p1/threshold.mjs --seed 7 --rounds 80000
node --test measurements/p1/threshold.test.mjs          # the instrument's own cases
```

**No model is called and nothing is spent.** The full run takes about eleven seconds and prints the
three sections this file quotes: the threshold under each assumption, what 25 points was actually
doing at each shape a round ran, and the recount.

**It is seeded.** The default is `--seed 20260823`, and every figure in this file came from it; the
derived threshold at ten × eight is 15.625 under all five seeds tried (1, 7, 20260823, 99991,
314159). A published number from an unseeded simulation is a number nobody else can get.

## 8. What this file does not do

- **It does not touch conditions 1, 2, 4 or 5 of the reading.** In particular the
  `at least 3 eligible tasks discriminate` condition stays; §6 shows it is the condition that has
  actually been doing the work.
- **It does not model `BROKEN` cells or ineligible tasks.** The simulation gives every arm a rate on
  every task. A round in which one arm loses tasks to `BROKEN` has fewer eligible tasks than it
  planned, and its threshold should be derived for the shape it **has**, not the one it declared —
  which is a reason to derive the number again when the round's capture exists, and to say so if it
  moved.
- **It does not decide how many tasks or how many runs a round buys.** That is a spending decision
  and it belongs to whoever holds the budget.
- **It does not make round 4 exist.** Round 4 may never be run; if it is, its reading names the
  shape, and the threshold for that shape comes from here.
