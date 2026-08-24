# The sieve, and what it is allowed to decide

**Committed before the sieve's first cell, and the order is the whole of it.** This file fixes
which arm sieves, how many times it runs, what band keeps a task, what happens to the cells it
produces, and what the round does if too few tasks survive. Every one of those is a decision that
could otherwise be taken after seeing a number, and a sieve chosen after its own output is not a
sieve — it is a selection.

The sieve is **not** the comparison. It spends the bench; the comparison is frozen after it, in
[`reading.md`](reading.md), and this file may not be edited once a sieve cell exists.

---

## 1. What it is for, and it is a conference rather than a mechanism

Round 3's `mnema-doc` scored **1.00 on all six headline tasks**, and so did `mnema+`. The
subtraction that round existed to make was between two arms at the ceiling. A tie at the ceiling
does not say the two channels are worth the same; it says the tasks left nothing for a second
channel to add.

**So the fourth round's tasks are designed to leave room, and the sieve is the check that the
design worked.** It is not what produces the room — §2 is. What it does is refuse to spend the
comparison on a task that saturated anyway, and it does so on numbers rather than on the author's
opinion of his own tasks.

## 2. Where the room comes from: four mechanisms, declared per task

A task has room when the opening document **does not suffice on its own** — when applying the
decision the record carries to the discriminating case is work even with the decision in hand.
Round 3's tasks each carried one rule, stated in the opening, directly applicable: the worst
possible shape for showing that anything beyond the document adds value.

Four mechanisms produce room, and **every axis-A task of this round declares exactly one**:

1. **The rule is one among many.** The decision carries a table and only one line reaches the
   ticket. Finding it is the work, and taking a neighbouring line is a violation.
2. **Two rules compose.** Each is clear alone; together they need an order or a precedence, and
   the other order lands somewhere else.
3. **The rule holds under a condition.** It applies only if the agent **detects** the case — and
   the case is in the code or the data, never in the ticket.
4. **Several rules seem to fit and one does.** Selecting is the work, and choosing wrong is a
   violation rather than a broken cell.

| task | mechanism | what the room is |
|---|---|---|
| `a23-credit-before-tax` | 2 · two rules compose | development. A credit reduces the taxable base, and the tax is what the reduced base owes; the two do not commute |
| `a24-cycle-anchor` | 3 · under a condition | development. A month shorter than the anchor bends the date, and only detecting that case tells the bend from a moved anchor |
| `a25-late-fee` | 1 · one among many | five contract families, five penalty lines, and the civil-code default is right for none of them |
| `a26-freight-band` | 4 · several seem to fit | four live rules reach a parcel at once; the charged weight is what the bands are read with |
| `a27-payout-cutoff` | 2 · two rules compose | date the request, then count the banking day. The other order collapses the weekend |
| `a28-plan-change` | 3 · under a condition | proration is for changes that raise the price, and which way the price moved is not in the ticket |
| `a29-exempt-lines` | 1 · one among many | six kinds of line, and the trap is that EXEMPT is not the same as UNTAXED |
| `a30-retry-budget` | 3 · under a condition | 429 sits inside the 4xx range and is not a rejection, and a named wait replaces the backoff |
| `a31-effective-at` | 4 · several seem to fit | three rules plausibly reach a seat removal; capacity is the line the table runs on |
| `a32-discount-stack` | 2 · two rules compose | discounts add against list, and the ceiling holds the SUM, in that order |
| `a33-branch-registration` | 1 · one among many | four of five rules answer with the head office, which is what hides the fifth |
| `a34-usage-rollover` | 3 · under a condition | a plan change inside the cycle forfeits the leftover, and the cycle record is where that shows |
| `a35-dunning-pause` | 4 · several seem to fit | four pause rules, and the fourth is about the invoice rather than about the account |
| `a36-credit-note-order` | 2 · two rules compose | oldest invoice first, principal before interest — both bite only where the credit runs out |
| `a37-sla-clock` | 3 · under a condition | the clock stops while the customer holds the ticket, and only the event log says whether that happened |
| `a38-reversal-period` | 1 · one among many | four kinds book in the open period and the fifth restates the original one |
| `a39-quota-reset` | 2 · two rules compose | reset the meter, then put the bought units back. The other order spends them |
| `a40-competence-month` | 4 · several seem to fit | a retainer carries a provision date precisely because work happens under it, and that is not what it sells |

**Four candidates of each mechanism, and the balance is deliberate**: a round whose room came from
one trick would measure the trick.

**The negative controls carry no decision and no mechanism.** `b7-roman-numeral` and
`b8-run-length` are the contamination detector: everything needed is in the ticket, every arm must
tie, and they are not sieved because there is nothing for a sieve to find.

## 3. The sieve, in full

| | |
|---|---|
| **arm** | `mnema-doc` |
| **runs** | 8 per candidate |
| **candidates** | the sixteen axis-A tasks of `split.json`'s `candidates` |
| **rate** | `CONFORMS` over SCORABLE cells, the round's own definition |
| **kept** | a candidate whose rate is **at or above 0.25 and at or below 0.75** |
| **dropped as a task defect** | a candidate with fewer than 6 of its 8 cells scorable |
| **the cells** | **discarded.** They are published as a capture and never counted in the comparison |

### Why `mnema-doc` sieves, and not `host`

**The question the round asks is whether the push helps where the document does not suffice.** It is
the document's room that has to exist, so the document's own arm is what measures it. Sieving with
`host` would keep tasks that are hard for the coding agent's memory, which is a different property
and not the one the comparison turns on.

**The objection to sieving with the compared arm is real and it is answered by measurement rather
than by argument.** Simulated with a true effect of **zero** — both arms given the same rate on
every task — sieving on `mnema-doc` and **discarding** the sieve's cells moves the comparison by
**−0.16 points**. Sieving on `mnema-doc` and **reusing** those cells as the round's cells moves it
by **−3.86 points**, in the direction that makes `mnema-doc` look worse. The bias is not in
sieving; it is in counting a cell twice. That is why the discard rule above is a rule and not a
courtesy.

### Why eight runs

Four is what the rounds have used and it is not enough to sieve with. Simulated: at four runs,
**34%** of tasks whose true rate is 90% land inside the band and are kept; at eight it is **19%**,
at twelve **11%**. Eight is where the leak stops being most of a third and starts being a fifth,
and twelve costs half a round again for four points.

**The leak is declared rather than fixed.** A sieve at eight runs still admits about one in five of
the tasks it exists to exclude, so the comparison may contain a saturated task. The reading names
that when it happens: a headline task on which both mnema arms come back 1.00 is reported as such,
with its sieve rate beside it.

## 4. What the sieve is NOT allowed to decide

- **It does not edit a task.** A candidate that saturates is dropped, never repaired. Repairing a
  task against its own sieve result is iterating on a held-out task, which is the one thing the
  split's rule forbids outright;
- **it does not choose the band afterwards.** 0.25 to 0.75 is fixed here, before a cell;
- **it does not choose the arms, the runs or the threshold of the comparison.** Those are
  `reading.md`'s, and the threshold comes from [`../threshold.md`](../threshold.md) for the shape
  the sieve leaves behind;
- **it does not contribute a cell to any number the comparison publishes.**

## 5. How many survive, and what each answer means

**The headline set is every survivor, up to a ceiling of twelve. If more than twelve survive, the
twelve with the lowest task ids** — a tie-break that is blind to the sieve's numbers, which is the
only kind that may be applied after them. The ceiling is a budget decision: twelve tasks × two arms
× eight runs is 192 cells before the regression check and the controls.

| survivors | what the round does | what it means |
|---|---|---|
| **12 or more** | the twelve lowest ids | the design worked and the ceiling, not the sieve, is what bounds the round |
| **4 to 11** | all of them, and the threshold is re-derived for that shape | the round runs smaller and says so. Power is recomputed from the shape it HAS, and published in `reading.md` before the first comparison cell |
| **fewer than 4** | **the comparison does not run** | condition 1 of the reading needs at least four eligible tasks. Below that there is no round to freeze, and the finding is about the task design rather than about the product. The sieve's capture is published anyway, because it is the evidence for that finding |

**The last row is the one worth writing down.** A sieve that returns almost nothing says the four
mechanisms did not produce room, and that is a real answer about a real attempt — cheaper than the
comparison and worth more than a fourth saturated round.
