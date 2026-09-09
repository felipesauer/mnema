# opening read cost

**What the opening read's fourth declaration of a limit costs it.** One number, its
share of the whole read, and how both behave as the record grows.

`bootstrap` gained a field that says which kinds of record it does not look at, and how
many of each the record holds (`copilot/src/context/unread.ts`). The module it was added
to is documented almost entirely about not spending, so the addition owed a number rather
than the word "cheap".

The capture is dated [`results/2026-09-08/`](results/2026-09-08/cost.txt) and carries its
own stamp: the commit, the node version, the machine and its load. Read the number beside
the build it came from.

Unlike [`channel-cost/`](../channel-cost/), the harness is committed
([`harness/cost.mjs`](harness/cost.mjs)) — it is a stopwatch over a read that ships, meant
to be run again against a later build, the arrangement [`p1/`](../p1/) keeps.

## The number

Over the record `bootstrap`'s own budget paragraph is written against — 30 live tasks, 15
decisions, 25 adopted patterns, 20 memories, 10 observations:

| | ms |
|---|---|
| the whole opening read | 0.402 |
| **the declaration alone** | **0.142** |
| the declaration's share | **35%** |
| noise floor (the same read timed twice) | 0.030 |

A third of the read is not what "two counts" sounds like, and the share is published
rather than rounded away.

## Why it is that large

The count is `search`'s own `COUNT(*)` over `record_search`, and that table declares
`kind UNINDEXED` (`core/src/db/schema.ts`). So counting ONE kind scans every searchable
record of EVERY kind: the cost is a function of the whole record, not of the memories in
it. A single-size measurement cannot see that, which is why there is a sweep:

| searchable records | the declaration | the whole read | share |
|---|---|---|---|
| 75 | 0.126 ms | 0.324 ms | 38.8% |
| 375 | 0.177 ms | 0.448 ms | 39.6% |
| 1,500 | 0.411 ms | 0.946 ms | 43.5% |
| 3,750 | 0.862 ms | 1.931 ms | 44.7% |

Both grow together, so the share holds between 38% and 45% across a fiftyfold range. The
absolute figure is what decides: **under a millisecond at fifty times a modest record**,
paid once when a session opens — not per turn and not per write.

## What was NOT done, and it is a real option

Two cheaper shapes exist and neither was taken:

- one `GROUP BY kind` in place of two counts halves the scans;
- counting the entity tables (`memories`, `observations`) instead of the index drops the
  scan to the rows of the kind asked for.

Both need a new function on `core`'s projection cache. That is a change with its own
reasoning and its own consumer, and neither is worth opening for a read whose measured
worst case is 0.9 ms. Named here so the next reader inherits the option rather than the
surprise.

## How it refuses to flatter itself

- **Alternating order.** Every figure is measured with the whole read first and again
  with the addition first. Identical work has to tie; the order gaps are in the capture.
- **A control that has to tie.** A third timer runs the same `bootstrap` twice under two
  names. The difference between its two figures is the noise floor, and no smaller gap is
  reported as a finding.
- **The answer is checked before anything is timed.** A bench over a read that returns
  nothing measures an early return, so the harness asserts the work total, the pattern
  count and the declaration itself before the first stopwatch starts.
- **Its own sandbox**, made and destroyed by the harness. Nothing is written into the
  working tree.

## What this does not measure

Whether an agent that reads the declaration behaves differently. That is a bench round
against a model, it costs a session window, and it is out of scope here — the claim
measured is the cost of producing the field, not the value of having it.
