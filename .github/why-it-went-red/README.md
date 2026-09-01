# Why it went red

A red of this suite means one of two things, and until this existed nobody could tell them apart
without deciding by hand:

- **the guard caught something** — the case would fail on an idle machine too;
- **the machine was busy** — the case waited, lost its slice, and would have passed alone.

Two deliveries had to discount reds as the second. Both discounts were honest. Both were also a
human judgement dropped into the middle of the only evidence a mutation battery produces, because
that battery is worth something exactly when red means *the guard caught*.

## The two pieces

**`ledger.mjs`** is a vitest reporter. It rides `pnpm test` and `pnpm test:coverage`, and writes
`why-it-went-red.json` (gitignored) holding, per red and per case slower than 500 ms: the
duration, the ceiling the case actually ran under, and what the machine was doing in that case's
own window. It classifies nothing.

**`verdict.mjs`** reads that ledger and, for every red, **runs that case again on its own**:

```
pnpm why-it-went-red                       # after a red run
pnpm why-it-went-red --ledger <path> --json <path> --summary <path>
```

| it prints | it means |
|---|---|
| `THE GUARD CAUGHT` | it failed again alone. A defect, at this commit. |
| `IT DID NOT REPRODUCE ALONE` | it passed alone. Not a property of this commit. |
| `WAITS WITHOUT SAYING SO` | a case spent over 2500 ms of the *shared* ceiling **alone**, declaring none of its own. |
| `RULER BROKEN` | it could not tell. No verdict at all, exit 2. |

Exit codes: `0` nothing to read, `1` something to read, `2` the ruler broke.

## Why running it again, and not a load threshold

Three repairs were on the table and they are not equivalent.

Limiting how much of the suite runs at once lowers the **frequency** of contention and answers
nothing — on the day the machine is busy with something else, which is the day this bites, the
case bursts again and the hand-discount comes back. Reading a load figure and concluding *flake*
is worse: a real defect landing on a busy minute would be filed as noise and the finding would be
gone for good. Running the case alone is the only one that answers the **question** rather than
reducing the frequency, and it rests on an observation rather than an inference.

So the load figures are **printed and never read**. Nothing in `verdict.mjs` branches on them, and
a case pins that: the same capture, read once as it came off a machine with 80 runnable threads on
16 cores and once with every load field rewritten to idle, produces identical verdicts.

## The second half is the same mechanism

`the-ceiling-belongs-to-the-case` bans lifting the shared ceiling and says what the ban does not
reach: whether a case that waits actually *has* a ceiling of its own needs a duration, and a scan
over source has none. The ledger has one. A case over the budget is re-timed **alone** by the same
function that re-runs the reds, and is accused only if it is still over it with the machine to
itself — so contention cannot manufacture an accusation, and one rule cannot grow two meanings.

## What it does not cover

- *did not reproduce alone* is **not** *the machine was busy*. It is the absence of a property of
  this commit, and an order dependence between files or a race in the product lives there too;
- a case that fails only when other files run alongside it reads here as *did not reproduce*,
  which is right for the question asked and wrong as a claim that the case is fine;
- it says nothing about the **rate** of a flake. That is `.github/flake-sampler/`;
- the runnable count is Linux's. Elsewhere the samples carry `null` and the page says so.

Pinned by `packages/code/tests/the-red-says-why-it-went-red.test.ts`, against three captures of
this suite taken under load generated on purpose.
