# measurements

What this project measured about itself, and how each number is to be read.

A claim about a product is worth what its measurement is worth, and a measurement is worth
what was fixed **before** the number existed. So this directory holds three kinds of file and
keeps them apart:

- **the pre-registration** — the promise, the arms, the isolation, the scorer, and the reading
  of every possible outcome. It is committed **before** the run;
- **the captures** — one file per run, under `results/`, added afterwards and never edited;
- **the instruments** — the runner that produces the cells, and the simulation that derives the
  numbers a pre-registration is then frozen around. They are committed for `p1/` alone, and the
  paragraph below says why that is a difference rather than an exemption.

*(This said **two kinds of file** until 23 Aug 2026, and what falsified it is
[`p1/threshold.mjs`](p1/threshold.mjs) — a file that is neither a pre-registration nor a capture:
it derives the threshold a reading will be frozen around, and it is committed because a number
fixed before a round is only worth the order if the derivation is visible too. The premise is
rewritten rather than deleted, because "the instrument is committed" was already true of
[`p1/harness/`](p1/harness/) and this list did not say so.)*

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

**And what a task may not be is asserted, not only ignored.**
`packages/code/tests/no-task-is-published-before-it-is-used.test.ts` asks git what it would
publish — committed files **and** untracked ones nothing ignores — and requires that no path of a
held-out task is among them, for every round. The ignore rules are the mechanism; that file is the
check, and it exists because a missing ignore line leaves held-out output unignored and one
`git add -A` from publication, which this project has done once with 304 files and come within
three days of a second time with 312.

**The INSTRUMENT is committed too, for [`p1/`](p1/) alone.** [`p1/harness/`](p1/harness/) is the
runner that produced every capture under [`p1/results/`](p1/results/), published because a number
whose instrument is not published is *our word* about how it was obtained — which is the one thing
this directory is organised against. It does not make the rounds reproducible, and the difference
between *checking the method* and *re-running our cells* is written at the top of that directory's
own README instead of being left for a reader to assume. The other directories' probes stay on the
workbench, and that is a difference rather than an exemption: a probe is a stopwatch used once, and
this is an instrument three rounds were measured with.

**And the second instrument derives a number rather than producing cells.**
[`p1/threshold.mjs`](p1/threshold.mjs) simulates how often a threshold publishes a `>` that is not
there, which is how the threshold for a round is now chosen; [`p1/threshold.md`](p1/threshold.md) is
the rule it serves, the target it derives against, and the reason that target is the number it is.
It calls no model and spends nothing. It is committed for the same reason the runner is, and for one
more: a threshold argued for in prose and computed in a script nobody has is a threshold chosen
after the fact with extra steps. Its own cases run with
`node --test measurements/p1/threshold.test.mjs`.

## What is here

| | |
|---|---|
| [`p1/`](p1/) | **Does the record change the work?** Pre-registered, and **measured three times**: every round's numbers are committed under [`p1/results/`](p1/results/), and the first promise **did not survive as written** in any of them. Round 2 — new tasks, five arms, a reading closing the three gaps round 1 found in its own rule — was pre-registered in [`p1/round-2/`](p1/round-2/) and ran on 20 Aug 2026: 208 cells, [`p1/results/2026-08-20-full/`](p1/results/2026-08-20-full/). The row it landed on was fixed in advance: the charged arm beats our own uncharged one by 73.6 points and is **`≈` with the memory the coding agent already ships**, and the whole of that gap is **one task**. **Round 3 was pre-registered in [`p1/round-3/`](p1/round-3/) and ran on 21 Aug 2026: 160 cells, [`p1/results/2026-08-21-full/`](p1/results/2026-08-21-full/)** — ten more new tasks, and **four** arms whose point is a subtraction, `mnema-doc` against `mnema+`, differing in one switch position, because round 2's winning arm carried an opening document and a per-edit push at once and no arm of that round held one without the other. **The subtraction came out at zero**: both arms 100.0% on all six headline tasks, 0 of 6 discriminating, so **the per-edit push adds nothing measurable and the +73.6 of round 2 belongs to the opening document**. `mcp_pushed` is 1 in 80 of 80 hooked cells, so the push had no later write to act on in any cell of the round — which is the mechanism the round's own prediction declared in advance. The document then ties with the host's memory as well (`mnema-doc` ≈ `host`, +0.0pt). *(This cell said **five arms with `mnema` out and `mnema++` in**, and it was true of the round's first freeze. What falsified it is the round's own data: `mcp_pushed` is 1 in all 24 headline cells of `mnema+`, so the push cannot have acted in any of them, and the arm that varied its arrival point was testing a refuted premise. The round was re-frozen before a cell of it ran; the withdrawn arms are data in its split.)* A reading that closes the two gaps round 2's own capture found, and a **prediction** declared per task, because the alternative to predicting is selecting tasks that resemble the one round 2 failed. *(This cell said the third round **"is pre-registered and has not run"**, which was true until 21 Aug 2026, and the run falsified it — the same sentence, about a different round, for the second time in this row. The premise is rewritten rather than deleted: what it claimed was a state of the directory, and the directory moved.)* *(This cell said the second round **"has not run"**, which was true until 20 Aug 2026, and the run falsified it.)* |
| [`p3/`](p3/) | **Does the proof survive someone with write access?** Eleven attacks [frozen before any of them ran](p3/protocol.md); nine carried out, and [every prediction held](p3/results/2026-08-18/report.md). No model was called — this one is filesystem and cryptography, and the attacker's own scripts are committed beside the verifier's output |
| [`channel-cost/`](channel-cost/) | **What the channel costs before it carries anything** — the floor of a hook, decomposed: a warm `mcp_tool` call against a spawned process (1.24 ms against 171.5 ms), and the size of what an injection would carry. No model was called |
| [`mcp-tool-channel/`](mcp-tool-channel/) | **Does the host inject at all, and what does the work cost** — twelve cases against the real `claude` binary with the model replaced by a stand-in, plus the work term of `rules_before_an_edit` at three record sizes, in two published runs |
| [`switch-cost/`](switch-cost/) | **What the switch costs on that same hot path**, and what the switched-off path costs when it delivers nothing. Two published runs, both stamped with the machine's load, because the absolutes do not survive it and the delta does |
| [`write-then-read/`](write-then-read/) | **What a WRITE costs the read that follows it** — the pair a push actually performs, at three record sizes, A/B'd between two built trees in alternating order; plus the property behind it, whether charging still gets dearer the more it charges. It also decomposes a rebuild, which is what falsified the diagnosis it was handed: the nine folds are 1% of it. No model was called |
| [`asks-a-person/`](asks-a-person/) | **Can the product make the host stop and ask a PERSON** — eight cases against the real binary, which established that the mechanism the plan named does not exist, that the one that does overrides every permission mode including `bypassPermissions`, and that a wrong value discards the whole reply in silence. Plus **how often a gate would actually fire**, measured over 200 commits of this repository: a 10× cliff for one segment of address depth, which is the number that decides whether this is usable |

*(THE COST DIRECTORIES — five of them now, with `write-then-read/` — WERE MISSING FROM THIS TABLE, and
the first two of them had been here for a day before anybody noticed — which is precisely the defect the parenthesis below describes,
arriving a second time by the same route. They are captures like every other file here and they
follow the same rules: one per file, nothing overwritten, the build inside the file. What they do not
have is a pre-registration, and the reason is a real difference rather than an exemption — a cost is
measured against a stopwatch and not against a promise, so there is no outcome to fix in advance and
nothing a late reading of the rule could bend. The one exception inside that exception is worth
naming: `asks-a-person/` §1 and §3 are not costs at all — they are facts about a HOST, measured with
a stand-in for the model, and what fixes them in advance is that the host's answer was unknown to
everybody, not just to us.)*

*(The line that stood here said `p1/` was **"Pre-registered. No number exists yet."**, and it was
the whole of this table. It was true on 13 Aug 2026 and false from the 18th, when the round landed
in the directory beside it; `p3/` had by then been pre-registered, attacked and reported, and this
index named none of it. The premise is rewritten rather than deleted, because an index that
contradicts the data next to it is the one defect a reader cannot check around.)*

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
| [`2026-08-20-full/`](p1/results/2026-08-20-full/) | **208 cells** — ten tasks × five arms × four runs (200), plus the **8 re-runs** the frozen reading rule requires for an instrument failure, kept beside their first attempt. Round 2, the pre-registered one, and the first capture here whose arms include the product's own surface. It ran in a **dedicated worktree** rather than the ordinary working tree, because another process rebuilt the product's `dist` during its preflight — stated in the report because a round whose build changes halfway measures two products. Committed: `cells.jsonl`, this report, and the raw output and diffs of `a7-partial-refund` and `a10-stock-cost`, the two development tasks. The eight held-out tasks' raw output and diffs stay back; their rates and verdicts are in the report |
| [`2026-08-21-full/`](p1/results/2026-08-21-full/) | **160 cells** — ten tasks × four arms × four runs, the pre-registered round 3, and **no re-run was needed**: 160 of 160 resolved, **zero `BROKEN`**, zero instrument failures, zero invalid cells. The round exists to attribute round 2's +73.6 to one of the two channels its winning arm carried, and the pair that answers it — `mnema-doc` against `mnema+`, one recorded switch position apart — **tied at 100.0% with 0 of 6 tasks discriminating**. It ran in a **dedicated worktree** with the workbench copied inside it, and the snapshot was checked against the bench's own mutation matrix at the moment of copying (**0 of 41 applied**) — a check added because an earlier attempt froze another session's applied mutation inside its snapshot. `mnema_build_sha256_16` is **one digest across all 160 cells**. Cost **$7.3791** against the $7.62 the freeze costed. Committed: `cells.jsonl`, this report, and the raw output and diffs of `a15-commission-base` and `a16-event-order`, the two development tasks. The eight held-out tasks' raw output and diffs stay back; their rates and verdicts are in the report |
| [`2026-08-24-pilot/`](p1/results/2026-08-24-pilot/) | **4 cells** — round 4's own pilot task × its four arms × one run, before that round's sieve spent anything. It is the four-cell check that the whole path works on a new round's tasks: `base` `VIOLATES`, the three seeded arms `CONFORMS`, `hook_ran` true in both surface arms, and `channel_served` empty in `mnema-doc` beside `edit-rules-push:1` in `mnema+` — the switch the pair subtracts, visible in the line. **$0.1662**, and not a measurement of anything: one run of one task. Its task is a development task by rule, so its raw output and diffs are committed |
| [`2026-08-24-sieve-aborted/`](p1/results/2026-08-24-sieve-aborted/) | **55 cells of a planned 128, and no number from it is read.** Round 4's sieve — 16 candidates × `mnema-doc` × 8 runs — stopped by hand partway through when the account's session limit turned every remaining cell into the vendor refusing to run. **33 of the 55 are that refusal**, and the harness wrote them as `status: ok` with a `BROKEN` verdict, because the gate that classifies a cell read the CLI's `subtype` (`success`) and not its `is_error` (`true`, beside `api_error_status: 429`). **A vendor refusing to run was indistinguishable from an agent whose code does not work.** Published aborted because a run that went badly is not overwritten; the fix, the three test cases and the two mutations are in the same delivery, the line carries `result_is_error` from schema 8, and the **492 cells committed before it were checked by hand and none carries the shape**. Committed: `cells.jsonl` and this report — all sixteen candidates are held out, so their raw output and diffs stay back |
| [`2026-08-24-sieve/`](p1/results/2026-08-24-sieve/) | **128 cells** — round 4's sieve, 16 candidates × `mnema-doc` × 8 runs, **128 of 128 resolved and zero instrument failures**. **Not a measurement of any arm**: its cells are discarded by that round's own frozen rule, and the arm here is `mnema-doc` with the per-edit channel switched off. What it decided is that **one candidate of sixteen survived the keep band** — eleven scored 1.000 over eight runs — so by `round-4/sieve.md` §5 round 4's **comparison does not run** and that round has no `reading.md`. The finding is by mechanism: the two that carry a TABLE (the rule is one among many; several rules seem to fit) saturated **8 of 8** tasks, and both tasks that left the ceiling were the mechanism about ORDER — `a32-discount-stack` at **0 of 8** with the rule in front of the model. Cost **$8.7620**, $0.0685 a cell, **49% above round 3's** because these decisions are larger. Committed: `cells.jsonl` and this report — all sixteen candidates are held out, so their raw output and diffs stay back |
