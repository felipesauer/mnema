# the record at scale

**What each read and each write costs as the record grows to 10, 30 and 100 thousand events,
before and after the projection is kept between reads.** A team of four reaches the last in about
two years; the registers the product has been used on are under the first.

The captures are in [`results/2026-10-02/`](results/2026-10-02/): the whole matrix as one line per
run ([`matrix.jsonl`](results/2026-10-02/matrix.jsonl)), the busy-lock rounds on a record that had
been read ([`busy-warm.jsonl`](results/2026-10-02/busy-warm.jsonl)), and the build, node, machine
and load ([`stamp.txt`](results/2026-10-02/stamp.txt)). Read every number beside that stamp.

## How it was measured

[`harness/`](harness/) is committed: it is a stopwatch over reads and writes that ship, meant to be
run again against a later build.

- **The record** is synthetic and is written once per size by `make-record.mjs` through the
  product's own event builders and tables (one checkpoint per act, the cadence the writer keeps),
  into a project `mnema init` founded in a sandbox. `verify` passes on it. A seed fixes the text,
  the ids and the order.
- **The arms** are two built checkouts: the trunk (`BASE_WT`) and this branch (`HEAD_WT`).
  `ab.sh` runs every wall as **base, head, head, base**, so a machine that drifts moves both
  arms; each cell is the median of the repeats inside one process, and the table takes the median
  of the two processes per arm.
- **Isolation**: every cell works on a private copy of the frozen record, with its own `HOME`, and
  removes it. The whole matrix ran under a memory ceiling.
- A CLI cell is the wall time of `node cli.js <verb>` including the process: the floor of the
  binary is in every number. *First* is the first run on a record nobody has read; the other column
  is the median of the runs after it.

## The numbers (seconds unless a unit is written)

Before is the trunk, after is this branch.

| wall | 10k | 30k | 100k |
|---|---|---|---|
| the first read after a write, in a held session (ms) | 57.9 → 0.85 | 146.6 → 0.60 | 533.7 → 0.70 |
| `search`, after the first read | 0.65 → 0.21 | 1.32 → 0.18 | 3.67 → 0.18 |
| `brief`, after the first read | 0.70 → 0.22 | 1.40 → 0.25 | 3.96 → 0.38 |
| `recall`, after the first read | 0.79 → 0.33 | 1.61 → 0.46 | 4.76 → 1.21 |
| `search`, the first read (builds the projection once) | 0.65 → 0.79 | 1.32 → 1.58 | 3.69 → 4.62 |
| `search`, peak memory (MB) | 179 → 84 | 315 → 84 | 562 → 84 |
| `decision record` (numbering), after the first | 0.76 → 0.24 | 1.50 → 0.21 | 4.27 → 0.22 |
| `task move` | 1.04 → 0.54 | 2.07 → 0.89 | 6.16 → 2.34 |
| `decision move` | 1.54 → 0.78 | 3.59 → 1.47 | 11.54 → 4.43 |
| the census of one edit (ms) | 39.1 → 5.3 | 120.4 → 16.4 | 425.6 → 62.3 |
| `linkBreaksAsOfNow`, per call (ms) | 0.18 → 0.15 | 0.12 → 0.12 | 0.17 → 0.17 |
| three moves at once refused `TAIL_BUSY` (of 9) | 0 → 0 | 0 → 0 | 4 → 0.5 |
| `mnema --version`, the floor (ms) | 171.5 → 159.3 | | |

How to read the ones that are not obvious.

- **The first read costs more, once.** It builds the projection and keeps it, which is what every
  read after it does not pay: +0.1 s at 10k, +0.9 s at 100k. A record read for the first time pays
  that once per clone and again only when the product's stamp or the record's shape changes.
- **`recall` is not flat at 100k** (1.21 s): it reads more than it asks the index for, and that
  remainder is the record's, not the replay's.
- **The moves still replay.** `task move` and `decision move` locate the entity's tree and, after
  the write, read the move back for the report, and both are still a replay of the record (about 2 s
  each at 100k). What they no longer do is replay under the lock, which is what `TAIL_BUSY` was.
- **`TAIL_BUSY` at 100k**: nine moves in three rounds of three, twice per arm on a record nobody
  had read: 5 and 3 refused before, 1 and 0 after. On a record that had been read first
  ([`busy-warm.jsonl`](results/2026-10-02/busy-warm.jsonl)): 4 and 3 before, and none in three
  runs after. The one refusal after is the first writer building the projection while two others
  wait; the roster the write checks is read from the kept projection and no longer replays the
  record under the lock (2.2 s at 100k).
- **The floor**: the width authority (`string-width`, 25 ms to load) was reached while the program
  was being built, by the one verb whose help aligns a column of words. Printable ASCII is answered
  without it now. The recovery measured here is 12 ms of the 25: the rest of what that load cost is
  not attributed to anything yet.
- **`linkBreaksAsOfNow`** names every broken tail and is flat in the record: 0.17 ms per call.

## Reproducing

```
export MEASURE_DIR=<a scratch directory inside the temporary directory> BASE_WT=<built trunk> HEAD_WT=<built branch>
for n in 10000 30000 100000; do bash harness/make-fixture.sh $n; done
bash harness/matrix.sh
```

The key root of a fixture is its own sandbox; `make-record.mjs` refuses one under the real
`~/.mnema`.
