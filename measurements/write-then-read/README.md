# write then read

**What does a WRITE cost the read that follows it?** The session keeps its projections warm, and
that fixed the read. It left the write paying the whole bill: an append marks the cache, the next
read replayed the chain, and a channel that appends on every edit made the next replay dearer than
the last.

Two questions, and the second is the one that matters:

1. what does the pair a push actually performs cost — one signed append, then the read the next push
   is served from — at three record sizes?
2. does charging still get **more expensive the more it charges**? That is a property of the design
   rather than an instant, and it is why the first number was worth chasing.

The probes live on the local workbench, the arrangement [`channel-cost/`](../channel-cost/),
[`switch-cost/`](../switch-cost/) and [`asks-a-person/`](../asks-a-person/) already keep. *(This
sentence named [`p1/`](../p1/) first, and p1 left that list: its runner is committed at
[`p1/harness/`](../p1/harness/). The line stays as the record of an arrangement that was once
uniform, and the reason it stopped being uniform is a difference rather than an exception — an
instrument three rounds were measured with is re-run; a stopwatch is not.)* This directory holds the captures, each stamped
with the commits, the node, the machine and its load. **Read every number beside the build and the
LOAD it came from, never beside this prose.** No model was called: this is a stopwatch over the
product's own functions.

## 1 · The diagnosis that was handed over was wrong about where the time goes

The measurement this work started from
([`asks-a-person/`](results/../../asks-a-person/README.md), §6.2 of the delivery report beside it)
had split the 413 ms of a charging run into its terms and found the pair — append, then read — at
**16.5 ms against 1.1 ms** for the read alone. Right, and the diagnosis of WHY was not: it said the
cost was the nine folds a rebuild runs, and proposed skipping the folds a kind does not feed.

[`where-a-rebuild-spends-it.json`](results/2026-08-19/where-a-rebuild-spends-it.json) decomposes a
rebuild on the base commit, each term timed alone:

| term | empty | realistic (207 events, 148 KB) | large (874 events, 628 KB) |
|---|---|---|---|
| read the chain into one order | 0.028 | 1.43 | 6.01 |
| **the nine folds** | **0.003** | **0.058** | **0.091** |
| drop every table + recreate the schema | 0.820 | 0.889 | 0.807 |
| materialize the reference index | 0.041 | 1.14 | 4.92 |
| materialize the full-text index | 0.038 | 0.55 | 1.91 |
| materialize the nine other tables | 0.288 | 0.76 | 2.13 |
| **the whole rebuild** | **1.11** | **4.82** | **16.04** |

**The folds are 1.2% of a realistic rebuild and 0.6% of a large one.** What costs is reading the
chain (30–37%) and writing the rows (~50%, of which the reference index alone is a quarter to a
third), plus 0.8 ms of DROP that is flat in the record — recreating a schema that already exists is
0.055 ms, so that term is the dropping.

And the premise under the proposal was false as well: the reference index is **one row per
appearance** and every event has a subject, so there is no kind it does not index. The run table
reads every kind too, by a different route — `lastFactAt` is the latest instant of any event whose
envelope pins it to the run, so that fold reads the ENVELOPE of every kind whatever its `kind`
switch says.

## 2 · The pair, four arms, alternated

[`the-pair-a-push-makes.json`](results/2026-08-19/the-pair-a-push-makes.json). Two arms per side,
run **base · branch · branch · base** at load 4.4–4.7 on sixteen cores, with only the compiled files
swapped between arms (`dist` deleted and rebuilt each time). p50 of 40 repetitions, in ms:

| | base | base | branch | branch |
|---|---|---|---|---|
| **realistic** — the read alone, warm | 0.103 | 0.105 | 0.105 | 0.107 |
| one signed append alone | 0.213 | 0.206 | 0.208 | 0.213 |
| **the pair** | **5.99** | **5.89** | **0.760** | **0.760** |
| the pair, alternated placing | 6.68 | 6.80 | 0.732 | 0.737 |
| a write that changes an entity table, then the read | 8.18 | 8.09 | 1.92 | 1.91 |
| **large** — the read alone, warm | 0.178 | 0.181 | 0.176 | 0.177 |
| **the pair** | **18.16** | **18.55** | **0.841** | **0.850** |
| the pair, alternated placing | 18.93 | 18.66 | 0.814 | 0.825 |
| a write that changes an entity table, then the read | 19.23 | 19.25 | 3.71 | 3.71 |

**8× on a realistic record and 22× on a large one**, and the two placings of each arm agree, which
is what says the loop position is not the effect. The read alone and the append alone are unchanged
to the third decimal — the paths this did not touch did not move.

The last row is the honest limit: a write that changes an entity table still re-materializes that
table and the full-text index, so it still grows with the record (1.92 ms against 3.71 ms). It is
4–5× cheaper and it is not flat.

## 3 · The property: does charging still get dearer the more it charges?

211 charges in a row, each one an append plus the read the next is served from. Every arm grew the
chain by **exactly 241,947 bytes**, so the arms did identical work.

| | base | base | branch | branch |
|---|---|---|---|---|
| shots 1–25 | 5.54 | 5.61 | 0.897 | 0.853 |
| shots 26–75 | 5.92 | 5.91 | 0.788 | 0.783 |
| shots 76–125 | 6.36 | 6.39 | 0.775 | 0.785 |
| shots 126–175 | 7.04 | 7.17 | 0.791 | 0.755 |
| shots 176–211 | **8.04** | **7.72** | **0.749** | **0.756** |
| the whole run | **1416 ms** | **1426 ms** | **177 ms** | **174 ms** |

**On the base the per-charge median rises 38–45% along the run. On the branch it does not rise.**
The whole run is 8.1× faster, and the reason it is more than the per-pair ratio is exactly the
property: the base's later charges were dearer than its earlier ones.

## 4 · What the branch does, in one paragraph

The retained cache remembers the ORDER it was built from and how far into each tail that order
reached. A read that has to catch up asks what arrived beyond that mark — the entries above it, not
the chain — and if the arrivals form a suffix of the order it already holds, it folds the extended
order (the same nine folds, over the same ordered stream) and writes only the tables those arrivals
feed, appending to the reference index rather than replacing it. A chain that changed any other way —
a tail pruned, a tail gone, a fact arriving that does not follow under the merge's own comparison —
is replayed whole. The residual term that still scales with the record is the folds, at roughly
100 ns per event.

**What did NOT get cheaper: the first read of a session.** It replays the chain and costs what a
replay costs — 1.11 / 4.78 / 16.04 ms, unchanged. The added `readdir` per tail that the frontier
needs costs 0.02 ms, flat, and every process that opens a cache and exits (the CLI) pays that and
gets nothing back.
