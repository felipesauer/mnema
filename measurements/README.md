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
| [`p1/`](p1/) | **Does the record change the work?** Pre-registered, and **measured once**: the first round's numbers are committed under [`p1/results/`](p1/results/), and the first promise **did not survive as written**. A second round — new tasks, five arms, a reading that closes the three gaps the first one found in its own rule — is pre-registered in [`p1/round-2/`](p1/round-2/) and **has not run** |
| [`p3/`](p3/) | **Does the proof survive someone with write access?** Eleven attacks [frozen before any of them ran](p3/protocol.md); nine carried out, and [every prediction held](p3/results/2026-08-18/report.md). No model was called — this one is filesystem and cryptography, and the attacker's own scripts are committed beside the verifier's output |
| [`channel-cost/`](channel-cost/) | **What does a delivery channel cost before anything is delivered through it?** The floor of a command-line invocation against the floor of a call into an already-connected server, each measured with its work term separated from it, plus how many files a session of this machine actually edits. It is what decided that a per-edit hook is affordable at all |
| [`mcp-tool-channel/`](mcp-tool-channel/) | **Does the host inject what a hook returns, and in what shape?** The real binary, a real server, and a stand-in for the model API so the request sent *after* the hook is the evidence. It refuted the reading the design started from — prose returned by a hook is dropped in silence — and it holds the cost of the one hook that shipped |

*(The line that stood here said `p1/` was **"Pre-registered. No number exists yet."**, and it was
the whole of this table. It was true on 13 Aug 2026 and false from the 18th, when the round landed
in the directory beside it; `p3/` had by then been pre-registered, attacked and reported, and this
index named none of it. The premise is rewritten rather than deleted, because an index that
contradicts the data next to it is the one defect a reader cannot check around.)*

**The last two are not pre-registered, and that is the difference rather than an exemption.**
A `p` directory asks whether a PROMISE of the product holds, so the reading has to be frozen
before the number exists or the number decides its own reading. The other two ask what a
mechanism costs and what a host actually does — questions with no promise to bias, whose
answer is a stamped capture and whose protocol is the script committed beside it. They are here
because they are measurements of this product and belong under one index; they are named apart
because a reader must not take an engineering number for evidence about a claim.

*(This table listed only the two `p` directories for a day after the other two landed beside it
— the same defect as the note above, one level down: an index is read as the whole of what is
here.)*

**There is no `p2/`, and the gap in the numbering is not an omission.** The names follow the
PROMISES, not this directory: `p1` is the first promise and `p3` the third. The second is the one
[`p3/protocol.md`](p3/protocol.md) calls *"about form"*, and no protocol for it is pre-registered
here — which is a thing this index says rather than a thing a reader has to infer from a missing
directory.

## What each capture under `p1/results/` is

One directory per run, and two of them are not the same kind of thing. The count in a report is the
count that report is about, and the counts do not add up to each other — so they are named here.

| | |
|---|---|
| [`2026-08-17-pilot/`](p1/results/2026-08-17-pilot/) | **4 cells** — one task, four arms, one run. The calibration pilot: it measured what a cell costs and it falsified the column the design had trusted to answer whether the host's memory was alive. Its task is a development task by rule, so its raw output and diffs are committed |
| [`2026-08-18-full/`](p1/results/2026-08-18-full/) | **112 cells** — seven tasks × four arms × four runs, the pre-registered round. Its `report.md` opens on *"116 cells"*, and that number is the protocol's **accumulated spend** at the time — these 112 plus the pilot's 4, whose $5.25 and $0.18 make the $5.44 the same report states. The file is a capture and is **not edited**; this row is what disambiguates it. Committed: `cells.jsonl`, and the raw output and diffs of `a3-idempotency` alone, because that task is a development task and open by design. The held-out tasks' raw output and diffs stay back until the tasks are published |
| [`2026-08-18-mechanism/`](p1/results/2026-08-18-mechanism/) | **8 cells** — a fifth arm on the two tasks the round had already shown to discriminate. **Not a measurement, and it says so in every line** (`selection_note`): the task selection is biased by a result, so no rate from it compares with the round's. Committed: `cells.jsonl` only — both its tasks are held out |
