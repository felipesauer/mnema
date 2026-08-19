# switch cost

**What the switch costs on the path a host runs before every file is written, and what the
switched-off path costs when it delivers nothing.**

Every channel this product pushes at a model without being asked can be switched off, and the
switching is recorded. The switch is read from the record, so the read happens on a hot path: the
channel it guards was measured at **0.79–0.83 ms** of work on a realistic record and **3.2–4.3 ms**
on a large one ([`../mcp-tool-channel/`](../mcp-tool-channel/)), and the term that dominates it is
the derivation of what is in force, run on every call. Putting one more derivation in front of that
is exactly the kind of thing that gets shipped unmeasured.

Two questions, and only the first is about the guard:

1. what does reading the switch add, on its own?
2. what does the **switched-off** path cost — the case where the product hands over nothing and
   could still charge for it?

**Read every number beside the build and the LOAD it came from, never beside this prose.**

## 1 · How it was measured

The probe lives on the local workbench (`.refactor/active/the-switch-is-a-fact/probe/`); this
directory holds the captures, each stamped with the commit, the node, the machine and its load.

- **The switch is timed ON ITS OWN**, over the **session's own warm caches** — the same objects the
  tool reads, asked the same question — so the delta is a measurement rather than a subtraction
  between two totals.
- **The order is alternated.** Every term is timed forward and then reversed, and both are
  reported: identical work has to agree, and where it does not the figure is the order's.
- **The baseline is a read that already existed** (`read_record`), timed in the same process on the
  same warm session. It is the in-run control on the machine.
- Each figure is the p50 of 2,000 timings after 300 warm-up calls, in three record regimes — the
  same shapes the channel's own capture used, so the figures sit beside that one.
- **Nothing is prorated.** The session totals are the measured per-firing figure times the measured
  edit counts (p50 34, p90 121, max 3,424), at all three points.

**THE MACHINE WAS BUSY, and that is stamped rather than hidden.** Both runs were taken at a 1-minute
load average of **8–9** on 16 cores, against **2.96** for the channel's own capture. What that
spoils is any claim that these absolute figures replace that one; what it does not spoil is the
DELTA and the RATIO, which are measured in the same process at the same load, forward and reversed.
The in-run control says so: `read_record` on the realistic record comes back at 0.129–0.145 ms here
against 0.148 ms there — the small reads did not move.

## 2 · The switch costs 0.04 ms, and it does not scale

| record | switch read alone | the hook, a rule matches | the hook, nothing matches | `read_record` beside it |
|---|---|---|---|---|
| empty | **0.042–0.051** ms | 0.305–0.334 ms | 0.297–0.374 ms | 0.293–0.347 ms |
| realistic (16 in force, 25 patterns, 30 tasks, 8 addresses) | **0.037–0.043** ms | 0.884–1.062 ms | 0.864–0.996 ms | 0.129–0.145 ms |
| large (101 in force, 50 addresses) | **0.037–0.051** ms | 3.399–4.285 ms | 3.609–4.405 ms | 0.130–0.188 ms |

Every cell is the range across two runs and both orders.

**The switch is FLAT.** It is 0.04 ms on an empty record and 0.04 ms on one with 101 decisions in
force — because it is an indexed lookup by primary key, one per tree, over a projection the session
already keeps warm. The thing it guards grows ~11× across the same three regimes. So the guard is
about **5%** of the realistic work term and **1%** of the large one.

**The whole-hook figures stay in the bands the channel's own capture published**, and where the
realistic one reads a little high the honest answer is that this measurement cannot split the
residual: the switch accounts for 0.04 ms of it, the machine was at three times the load, and the
large regime — where a systematic addition would show most — lands dead inside its published
3.2–4.3 band. A third run should be expected inside these ranges; one outside them is news.

## 3 · The switched-off path does not charge for what it does not deliver

| record | the hook, channel switched OFF | the same hook, channel on and a rule matching |
|---|---|---|
| empty | **0.137–0.184** ms | 0.305–0.334 ms |
| realistic | **0.126–0.148** ms | 0.884–1.062 ms |
| large | **0.126–0.176** ms | 3.399–4.285 ms |

**It is flat too, and that is the whole point.** Switching the channel off removes the term that
scales with the record: the reply is decided before the derivation runs, so a 101-decision record
costs what an empty one costs. On the large regime that is **21–34× cheaper** than the delivering
path, and cheaper than `read_record`.

What is left is not zero, and it is worth naming: 0.13–0.18 ms against 0.04 ms for the switch read
itself. The difference is the tool's own floor — refusing outside a project, and assembling the
session's scoped caches — which every read of this server pays and no switch can remove.

**Over a whole session**, at the measured edit counts, floor (1.24 ms per warm `mcp_tool` firing,
from [`../channel-cost/`](../channel-cost/)) plus work:

| record | p50 (34 edits) | p90 (121) | max (3,424) |
|---|---|---|---|
| large, channel ON | 0.18–0.19 s | 0.63–0.67 s | **17.7–18.9 s** |
| large, channel OFF | 0.05 s | 0.17 s | **4.7–4.9 s** |
| realistic, channel ON | 0.07–0.08 s | 0.26–0.28 s | 7.3–7.9 s |
| realistic, channel OFF | 0.05 s | 0.17 s | 4.7 s |

The switched-off row is the same in every regime, because the record no longer reaches the call.

## Which of these numbers expire, and what invalidates each

| number | expires when |
|---|---|
| the switch read (0.04 ms) | the reading changes shape. It is a primary-key lookup per tree over a warm projection; it would stop being flat the day the switch stopped being a row |
| the whole-hook terms | the reading changes, or the record's shape does. They are the channel's own numbers plus this guard, and the channel's capture is where they belong |
| the switched-off terms | the tool's own floor changes — the project check and the cache assembly are what is left in them |
| the session totals | the edit counts do. They are a snapshot of one machine in Aug 2026 |
| every absolute figure here | **the machine's load does.** Both runs were taken at 8–9; the ratios and the delta are within-run and survive that, the absolutes do not |

## What is here

| | |
|---|---|
| [`results/2026-08-19/switch-cost.json`](results/2026-08-19/switch-cost.json) | run A, load 9.39 — every term, order alternated |
| [`results/2026-08-19/switch-cost-run-b.json`](results/2026-08-19/switch-cost-run-b.json) | run B, load 8.19 — published so the spread is data rather than a claim |
