# measurements

What this project measured about itself, and how each number is to be read.

A claim about a product is worth what its measurement is worth, and a measurement is worth
what was fixed **before** the number existed. So this directory holds two kinds of file and
keeps them apart:

- **the pre-registration** — the promise, the arms, the isolation, the scorer, and the reading
  of every possible outcome. It is committed **before** the run;
- **the captures** — one file per run, under `results/`, added afterwards and never edited.

## The rules this directory keeps

**One capture per file, and the date is in the name.** A second run of the same protocol is a
second file, not an edit of the first. Two captures that disagree are allowed to live side by
side with the cause of the difference named; a capture that is silently replaced destroys the
only evidence that the difference existed.

**Nothing is overwritten.** That includes a run that went badly. A broken evaluation mode is
published broken, without an invented number in its place.

**The version of the product and of the model is inside the file**, not in the prose beside
it. A result that does not say which build produced it cannot be reproduced or contradicted.

**The qualification rides in the line, not in the paragraph next to it.** Every result line
carries its own caveat fields — which model, how it was scored, where the cost came from —
so whoever opens the data without this README still reads them.

## What is committed here, and what is not

The tasks a measurement runs against are **not** published while they are held out: the
directory commits a **hash per task**, and the task itself only after it has been used. A task
published before it is used is a task the thing being measured may have already read.

The consequence is stated rather than hidden: while a measurement is pending, a third party can
check that the tasks did **not change** between the freeze and the result, and cannot yet check
what they say. The ids name a domain (`a1-rounding`), never the rule the task turns on.

## What is here

| | |
|---|---|
| [`p1/`](p1/) | **Does the record change the work?** Pre-registered. No number exists yet. |
