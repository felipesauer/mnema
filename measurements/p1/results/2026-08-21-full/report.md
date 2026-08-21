# P1, round 3 — the per-edit push adds nothing measurable

**The channel this product ships and charges for on every edit did not move the number, and
that is the row the round's own frozen rule predicted.** `mnema+` and `mnema-doc` differ in one
switch position — the per-edit push, on in the first and off in the second — and over the six
headline tasks they scored **100.0% both**: gap **+0.0 points**, **0 of 6** tasks discriminating.
By [`round-3/reading.md`](../../round-3/reading.md) that is `≈`, and the row it lands on reads:

> `mnema+` ≈ `mnema-doc` — **the per-edit push adds nothing measurable.** It is the outcome
> round 2's own cells predict […] and it puts a decision on the table that is not this file's
> to take: a channel that pays its derivation on **every edit of every session**, that is
> **charged for**, and that does not move the number.

**And a second row of the same table landed with it.** `mnema-doc` ≈ `host`, gap **+0.0
points** — *"the document alone ties with the memory the coding agent already ships, and every
part of the surface beyond that document is weight."*

**What did not happen is the row that would have blocked every other one.** `mnema+` ≈ `base`
is the round's own regression check, and it did not occur: `mnema+` **100.0%** against `base`
**33.3%**, **+66.7 points**, 6 of 6 discriminating, `mnema+` higher in all 6 — so `mnema+` >
`base` and round 2's +73.6 replicates in direction. Every other row of the table is therefore
readable, and the two above are what it says.

**Nothing was capped and nothing was voided.** All **four** arms carry a rate on **both**
negative controls, so condition 5 vetoes nothing; the two controls came back **100.0% in all
four arms**, so the contamination clause does not fire. **160 of 160 cells resolved**, **zero
`BROKEN`**, **zero instrument failures**, **zero re-runs**, **zero invalid cells**.

| | |
|---|---|
| capture | 160 cells — 10 tasks × 4 arms × 4 runs, the pre-registered round 3 |
| ran | 2026-08-21, 10:01–11:14 local, in a dedicated worktree (see *Isolation*) |
| model | `claude-haiku-4-5-20251001`, fixed, in every line |
| CLI | `2.1.228 (Claude Code)` |
| product build | `mnema_build_sha256_16 = 600f14d93aa9e4dd` — **one build, all 160 cells** |
| schema | `mnema-bench/cell/7`, every line |
| cost | **$7.3791**, against the $7.62 the frozen table costed for `n = 4` |
| pre-registration | [`round-3/`](../../round-3/) — untouched by this run |

---

## `mcp_pushed`, per task, before any rate

The frozen reading makes this column a **condition** of reading the prediction, and the frozen
prediction is checked **per cell** against it. So it comes first, as the ruler orders.

| task | `base` | `host` | `mnema-doc` | `mnema+` |
|---|---|---|---|---|
| `a15-commission-base` | null ×4 | null ×4 | **1,1,1,1** | **1,1,1,1** |
| `a16-event-order` | null ×4 | null ×4 | **1,1,1,1** | **1,1,1,1** |
| `a17-billed-seats` | null ×4 | null ×4 | **1,1,1,1** | **1,1,1,1** |
| `a18-dunning-recipients` | null ×4 | null ×4 | **1,1,1,1** | **1,1,1,1** |
| `a19-batch-pick` | null ×4 | null ×4 | **1,1,1,1** | **1,1,1,1** |
| `a20-over-long-note` | null ×4 | null ×4 | **1,1,1,1** | **1,1,1,1** |
| `a21-session-expiry` | null ×4 | null ×4 | **1,1,1,1** | **1,1,1,1** |
| `a22-graduated-usage` | null ×4 | null ×4 | **1,1,1,1** | **1,1,1,1** |
| `b5-column-name` | null ×4 | null ×4 | **1,1,1,1** | **1,1,1,1** |
| `b6-wrap-words` | null ×4 | null ×4 | **1,1,1,1** | **1,1,1,1** |

**`mcp_pushed = 1` in 80 of 80 cells of the two arms that carry the hook. Not one cell of this
round reached 2.** `null` in `base` and `host` is the correct value and not a gap: those arms
declare no server, and `mcp_probe` says so in each of those 80 lines.

**What that does to the prediction, by the frozen rule.** One dispatch is **at most one matched
edit**, and the capture of 19 Aug measured that the pushed text lands *after* the tool result of
the edit that triggered it. So in **every** cell of this round the per-edit text arrived after
the only write the cell had, and **the push could not have acted anywhere**. The prediction
declared exactly this — *"on a task decided on the first write, `mnema+` ≈ `mnema-doc` is what
this file predicts"* — and it **held**: the two arms tie, on every task, and the tie has a
mechanism rather than only a number.

**And the round therefore cannot say the thing it would most like to say.** No headline task
came back with `mcp_pushed ≥ 2`, so **no cell of this round is one where the push had its
chance**. The `≈` is not evidence that the channel would fail if it arrived in time; it is
evidence that, **as it currently arrives**, it never gets a turn. The frozen files name this
limit in advance, in three places, and this capture is the measurement of it rather than a
surprise: the arm that would move the arrival point is the one round 3 withdrew, and
[`arms.md`](../../round-3/arms.md) declared the price of withdrawing it before any cell ran.

**One column reached 2 and it is a different one.** `mcp_calls` — the agent's own calls — is 1
in **two** cells (below), where the total `tools/call` count at the wrapper was 2 and only one
of them was the pushed tool. `mcp_pushed` stayed 1 in both.

---

## The rates

**A rate is `CONFORMS` over `SCORABLE`** — cells whose `status` is `ok` and whose verdict is
`CONFORMS` or `VIOLATES`. Every pair below has all four cells scorable, so every `n` is 4 and
no pair is missing a rate.

### The six headline tasks

| task | `base` | `host` | `mnema-doc` | `mnema+` |
|---|---|---|---|---|
| `a17-billed-seats` | 75.0% (3/4) | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| `a18-dunning-recipients` | 25.0% (1/4) | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| `a19-batch-pick` | 0.0% (0/4) | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| `a20-over-long-note` | 0.0% (0/4) | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| `a21-session-expiry` | 25.0% (1/4) | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| `a22-graduated-usage` | 75.0% (3/4) | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| **mean of the per-task rates** | **33.3%** | **100.0%** | **100.0%** | **100.0%** |

**The dispersion travels with the aggregate, and here it is the flattest this protocol has
produced.** Three arms are 1.00 on all six tasks — no task at 0.50, nothing for a mean to
hide. The spread is entirely in `base`, and it spans 0.0% to 75.0%: the six tasks are not
equally unrecoverable, and the two that `base` half-solves (`a17`, `a22`) are the two where a
plausible natural draft happens to conform.

### The two negative controls and the two development tasks

| task | `base` | `host` | `mnema-doc` | `mnema+` |
|---|---|---|---|---|
| `b5-column-name` (control) | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| `b6-wrap-words` (control) | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| `a15-commission-base` (dev, pilot) | 50.0% (2/4) | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |
| `a16-event-order` (dev) | 0.0% (0/4) | 100.0% (4/4) | 100.0% (4/4) | 100.0% (4/4) |

**The development tasks are published and are not in any headline number**, by the rule frozen
before the round. They behave like the headline set, which is a fact about them and not an
argument for folding them in.

---

## The five conditions, pair by pair

Every comparison is over the tasks that can separate **that pair**, in both directions.

| pair | eligible | discriminating | degenerate (equal) | aggregate | gap | `BROKEN` share | read as |
|---|---|---|---|---|---|---|---|
| `host` vs `base` | 6/6 | 6 | 0 | 100.0% / 33.3% | **+66.7pt** | 0% / 0% | **`host` > `base`** |
| `mnema-doc` vs `base` | 6/6 | 6 | 0 | 100.0% / 33.3% | **+66.7pt** | 0% / 0% | **`mnema-doc` > `base`** |
| `mnema+` vs `base` | 6/6 | 6 | 0 | 100.0% / 33.3% | **+66.7pt** | 0% / 0% | **`mnema+` > `base`** |
| `host` vs `mnema-doc` | 6/6 | **0** | 6 | 100.0% / 100.0% | **+0.0pt** | 0% / 0% | **`≈`** |
| `host` vs `mnema+` | 6/6 | **0** | 6 | 100.0% / 100.0% | **+0.0pt** | 0% / 0% | **`≈`** |
| **`mnema-doc` vs `mnema+`** | **6/6** | **0** | **6** | **100.0% / 100.0%** | **+0.0pt** | **0% / 0%** | **`≈`** |

**Condition by condition, for the pair the round is about.** 1: 6 of 6 eligible, over the
minimum of 4. 2: `BROKEN` is 0% on both sides, under the quarter that is inside the refusal. 3:
the gap is **0.0** points, and 25 was the bar — it fails by the whole of it. 4: **0** eligible
tasks discriminate, and the bar is 3. 5: both arms have a rate on both controls, so nothing is
capped. **Conditions 3 and 4 are the ones that decide it, and neither is close.**

**No comparison fell between two lines.** Three pairs clear all five conditions with a
two-thirds gap; three pairs fail conditions 3 and 4 at zero. There is no pair in this capture
where a judgement call was available.

### Condition 5, and it vetoed nothing

| arm | rate on `b5-column-name` | rate on `b6-wrap-words` | may be read as `>` |
|---|---|---|---|
| `base` | 100.0% | 100.0% | yes |
| `host` | 100.0% | 100.0% | yes |
| `mnema-doc` | 100.0% | 100.0% | yes |
| `mnema+` | 100.0% | 100.0% | yes |

**All four arms, both controls, a rate on each.** This is the clause round 2's capture forced
into existence — that round's `mnema+` had **no** rate on **either** control, 8 `harness_error`
cells and 8 identical re-runs, and three `>` readings were published for it anyway. The bench
defect behind it (`surfaceProblem` classifying the correct axis-B outcome as an undelivered arm,
because it never asked which axis it was on) is closed, and **this is the capture that
exercises the fix**: 32 axis-B cells across four arms, every one of them `ok` and scorable.

### The contamination clause

| control | `base` | `host` | `mnema-doc` | `mnema+` | differ? |
|---|---|---|---|---|---|
| `b5-column-name` | 100.0% | 100.0% | 100.0% | 100.0% | no |
| `b6-wrap-words` | 100.0% | 100.0% | 100.0% | 100.0% | no |

**No two arms differ on an axis-B task. The round counts.**

---

## Cells that produced no verdict, and cells that were invalid

**There were none of either.**

| class | count | why |
|---|---|---|
| `ok` / `CONFORMS` | 138 | |
| `ok` / `VIOLATES` | 22 | |
| `ok` / `BROKEN` | **0** | no cell produced code that failed the correctness gate |
| `harness_error` | **0** | |
| `ruler_broken` | **0** | |
| re-runs consumed | **0** | the frozen re-run clause was not needed once |
| **invalid by the prediction rule** | **0** | `mcp_pushed = 0` beside a changed file did not occur in any of the 80 hooked cells |

**`truncated` false in 160 of 160. `permission_denials` 0 in 160 of 160. `result_subtype`
`success` in 160 of 160.** **This is the first full round of the protocol with zero `BROKEN`
cells**: round 1 had **12 of 112**, round 2 had **7 of 208** plus 16 `harness_error`. It says
something about the task set rather than about the arms — these ten were written to a criterion
that asks the natural draft to pass the happy path, and it did, in every cell of every arm — and
it is also what makes condition 2 of the reading trivially satisfied for every pair instead of
being a judgement.

**One cell changed no file at all.** `a18-dunning-recipients` · `base` · run 3: `files_changed`
0, `added_lines` 0, 14 turns, verdict **`VIOLATES`**. That is a scorable cell and not a broken
one: the discriminant read the repository as it was handed over, and the unchanged code
violates the decision the arm was never told. The arm without the record spent fourteen turns
and wrote nothing.

---

## What the mechanism columns say, and the arm proves itself out of the line

**The switch position is read from `mnema switch`, not promised by the bench.**

| column | `mnema-doc` | `mnema+` |
|---|---|---|
| `channels_on` | `["brief-document:on","edit-asks-a-person:on","edit-rules-push:off"]` ×40 | `["brief-document:on","edit-asks-a-person:on","edit-rules-push:on"]` ×40 |
| `hook_ran` | `true` ×40 | `true` ×40 |
| `channel_served` | `[]` ×40 | `["edit-rules-push:1"]` ×32 · `[]` ×8 |
| `mcp_pushed` | `1` ×40 | `1` ×40 |

**The two arms differ in one bit, and the line carries which bit.** `edit-rules-push` is `off`
in 40 of 40 cells of one arm and `on` in 40 of 40 of the other, and every other channel is in
the same position on both sides.

**G5 of the frozen `arms.md` asks the line to tell two silences apart, and it does.** In
`mnema-doc` the document **ran** (`hook_ran: true`, `brief:1` in `hook_invocations`) and the push
**did not speak** (`channel_served: []` beside a `channels_on` that says `off`). Those are
opposite conclusions about the product and the line does not merge them.

**And the eight empty `channel_served` of `mnema+` are the eight axis-B cells, all of them.**
`b5-column-name` and `b6-wrap-words`, runs 1–4: the channel was `on`, the host dispatched
(`mcp_pushed: 1`), and the tool answered nothing because no rule addresses those files. An empty
list there is an **answer**, and the 32 cells that carry `edit-rules-push:1` are exactly the 32
axis-A cells. The channel behaved as declared on both axes without a single exception.

### The agent asked, and this is the first time in three rounds that it did

`mcp_asked` has been **false in every cell of every previous round** — 20 of 20 in round 1, 40
of 40 in round 2. In this capture it is **true in 2 of 80** cells that had a server to ask:

| cell | `mcp_calls` | `mcp_tools` | verdict |
|---|---|---|---|
| `a17-billed-seats` · `mnema-doc` · r1 | 1 | `["read_record:1","rules_before_an_edit:1"]` | `CONFORMS` |
| `a17-billed-seats` · `mnema+` · r4 | 1 | `["read_record:1","rules_before_an_edit:1"]` | `CONFORMS` |

**And in one further cell the agent used the CLI instead of the server.**
`a17-billed-seats` · `mnema+` · r2 carries `hook_invocations: ["brief:1","read-record:1"]` — the
cell-owned `mnema` shim logged a `read-record` the handler did not make. That is the second
difference the isolation note declares about this arm and it is measured rather than assumed.

**What it is not.** Three cells out of eighty, all on one task, all already `CONFORMS`, in arms
that scored 100.0% with and without asking. It changes no number in this report and it supports
no claim about the record being reachable being worth anything: the arm that would test that
(`mnema`, the record present and nothing pushed) was measured twice, answered `≈` twice, and is
not in this round. It is recorded because the column has been flat for two rounds and is not
flat any more.

**`memory_changed` is false in 160 of 160.** No arm wrote to the memory directory, including
`host`.

---

## `memory_read`, counted, and the `relatime` note the handoff asked for

| value | cells |
|---|---|
| `memory_read: false` | 128 |
| `memory_read: true` | 32 |
| `memory_read: null` | **0** |

| `memory_read_probe` | cells |
|---|---|
| *"atime: a read that is not the harness's own moves it on this filesystem"* | **160** |

**The column did not oscillate in this capture, and the pattern it produced is exact.** All 32
`true` are in `host`, and they are **32 of that arm's 32 axis-A cells**. All 8 of that arm's
axis-B cells are `false` — which is correct, because on axis B the host memory is seeded empty
and there is nothing to open. The other three arms are `false` in 40 of 40, which is also
correct: `base` has no memory file, and the two `mnema` arms carry their knowledge in a record
rather than in the memory directory.

**The instability is real and it is a property of this machine, not of this capture.** `/` is
ext4 mounted `relatime` and `/tmp` is not a separate mount, so the per-cell sandboxes live under
`relatime`: the access time only advances when it is already older than `mtime`/`ctime` (or 24
hours old), so the first read after the seed records and later ones need not. Run the bench's
own suite twice on this machine and **different** cases fail. **Nothing was fixed for this
round** — a defect is a finding — and the column declares `null` rather than `false` wherever
the probe says the filesystem does not record access. In this capture the probe answered
positively 160 times and no cell needed the `null`, so the column happens to be clean here;
**that is luck about ordering and not a property anybody should rely on.** No number in this
report depends on it.

---

## One build, and the round is about one product

| `mnema_build_sha256_16` | cells |
|---|---|
| `600f14d93aa9e4dd` | **160** |

**One digest across the whole round.** `mnema_version` is `0.0.0` in all 160 lines, which is
what a `package.json` says and not what ran; the digest is the bytes. Round 2 had to be moved
into a dedicated worktree mid-preflight because another process rebuilt `packages/code/dist`
while it was starting, and this column exists so that a round measuring two products cannot
publish one number. It did not happen here, and the column is what says so rather than a
paragraph.

The probe in every line names the tree: *"sha256 of 281 .js file(s) under `packages/*/dist` of
`/home/felipe/…/round3-run/mnema`"* — the worktree, which is the isolation below stated in the
data.

---

## Cost, against the number the frozen table costed

| arm | cells | total | $/cell | turns | costed in advance |
|---|---|---|---|---|---|
| `base` | 40 | $1.9146 | **$0.0479** | 6.3 | $0.0449 (round 2, measured) |
| `host` | 40 | $1.7625 | **$0.0441** | 6.0 | $0.0485 (round 2, measured) |
| `mnema-doc` | 40 | $1.8729 | **$0.0468** | 5.8 | $0.0486 (**stand-in**) |
| `mnema+` | 40 | $1.8290 | **$0.0457** | 5.9 | $0.0486 (round 2, measured) |
| **round** | **160** | **$7.3791** | **$0.0461** | 6.0 | **≈ $7.62** |

**$7.3791 against $7.62 — 3.1% under, and the direction is the one the freeze declared.**
`mnema-doc` had no measured figure and its column was `mnema+`'s own, labelled a stand-in and
argued to be an **upper bound** because the arm receives strictly less text. Measured, it is
**$0.0468** against the $0.0486 that stood in for it: the bound held, by 3.7%.

**The per-cell spread across four arms is $0.0441–$0.0479, and the arm with the whole surface
is the second cheapest.** `mnema+` at $0.0457 is **cheaper per cell than `base`** at $0.0479,
and its turn count (5.9) is lower than `base`'s (6.3). **That ordering is new**: in round 2 the
same arm was dearer than the floor ($0.0486 against $0.0449), and in round 1 the `mnema` arm was
too ($0.0507 against $0.0439). This is the first capture in which carrying the whole surface
costs less per cell than carrying nothing, and the mechanism is visible in the turns rather than
in the tokens — an arm that is told the decision writes the code and stops, and `base` spends
turns deciding. One cell of `base` spent fourteen of them and wrote nothing at all.

**Machine time: 58.0 minutes of cell duration, 73 minutes wall clock** (10:01:16 → 11:14:48),
of which 410 s is the preflight the spending mode runs before it plans. Weekly-meter points are
**not** published here: the 0.037/cell conversion is round 1's, was not re-measured, and
carrying it forward would be an estimate wearing a measurement's clothes. The dollars are the
vendor's own result message, per the `cost_source` in every line.

---

## Isolation, and what was proved before a cell ran

**A dedicated worktree, self-contained.** `/home/felipe/…/round3-run/mnema`, detached at
`e085c7b3`, `pnpm install --frozen-lockfile` + `pnpm build`, and **a copy of the workbench
inside it** — without that copy the harness finds the workspace root by marker from where it
lives and resolves to the main tree, which is how round 2's first attempt failed. Proved rather
than assumed: the preflight run inside the worktree named
`…/round3-run/mnema/plugin/hooks/session-start.mjs` as the handler it measured, and the run
named `…/round3-run/mnema/plugin` as the surface under measurement.

**The worktree's product is byte-identical to the main tree's.**
`packages/code/dist/cli.js` → `34fb4446c22ca29993ff98421dcbbace02c91e6b79c2c220aaaaef52c553dc9f`
in both.

**The snapshot was checked against the mutation matrix at the moment of copying.** **0 of 41
mutations applied**, using the `from:`/`to:` strings of the bench's own `mutate.mjs` as the
discriminant. This is the check that was missing when the round's third attempt was defeated: a
snapshot taken while another session's mutation battery had `h` applied froze that defect inside
the worktree, and twenty minutes of red preflight named a cause a three-second check would have
named first. Three of the 41 report as *ambiguous* because the mutated text is a substring of
the clean text; in all three the clean string is **present**, which is what proves them clean.

**Both preflights green, 12 of 12 checks each.**

| gate | duration | result |
|---|---|---|
| `--selftest` on the main tree | 298 s | every check passed |
| `--selftest` inside the worktree | 410 s | every check passed |
| `--full --round 3 --runs 4` without `--yes` | — | planned **160 cells** and stopped, exit 2 |
| `--full --round 3 --runs 4 --yes` | 4 412 s | 160 of 160, exit 0 |

**The run was executed once.** No cell was re-run, no capture was overwritten, and nothing in
`round-3/` was edited.

**The main tree was untouched.** `git status --porcelain` at the end is **identical line for
line** to the baseline recorded on arrival, and no file of the shared workbench has an mtime
inside this session's window.

---

## Two gaps in the instrument, named because they are the round's to name

### 1 · The frozen pre-spend gate has no literal site

[`reading.md`](../../round-3/reading.md) fixes it in these words:

> **No cell of this round runs until every declared arm has produced one SCORABLE axis-B cell
> in the preflight.**

**There is no check by that name, and no check that produces a scorable cell.** A scorable cell
needs a verdict over code a model wrote, and the preflight calls no model — so the clause as
written asks the preflight for the one thing it defines itself as not doing.

**What exists instead covers the failure class, and it covers it on the right axis.** The two
surface checks walk **56 cells across both hooked arms**, and their axis-B half asserts the
correct axis-B outcome for each: *"where the axis records nothing OR the arm switched the
channel off it said nothing and recorded nothing"*. That is precisely the instrument-blindness
defect 4 was written about — an instrument that cannot see the treatment arm on the control —
and it was green in both preflights before a cell ran.

**And the enforcing half of the same rule is implemented and was applied.** Condition 5 is a
property of the capture, it is computed above for all four arms, and it would have capped any
arm the detector could not see. In this round it capped none, because the detector saw all four
on both controls. **The gate's purpose was served; its literal text was not implemented, and a
reader is owed that distinction rather than a green checkmark.**

### 2 · The line does not say which round it belongs to

`resultLine` takes `round` as an argument with no default, under a comment that reads *"Which
round's tasks this cell ran, because one caveat depends on it and nothing else in the line can
say it."* The argument is used only to decide `selection_note`, and **`round` is not a key of
the emitted line** — `'round' in line` is `false` in all 160.

The consequence is bounded: the round is derivable from `fixture`, because the split's own
`crossRoundProblems` check asserts that no task appears in two rounds, and it is green. So the
information is recoverable, and the comment's claim that *nothing else in the line can say it*
is the part that is false — the fixture id can. It is reported rather than fixed, because
fixing the bench during the round is fixing the bench against a result.

---

## Debt this capture leaves behind

- **`harness/mutate.mjs` is not importable, and importing it runs the battery.** The matrix is
  `const MUTATIONS` with no `export`, and the loop that applies each mutation is at top level
  with no `import.meta.url` guard. An attempt to verify the inherited `mutations-shim.mjs`
  against it **by import** started the battery and applied mutation `z9` to the worktree
  snapshot; the main tree was untouched, because `mutate.mjs` derives its target directory from
  its own `import.meta.url`. The snapshot was discarded, re-copied and re-gated. **The safe
  check is textual**, and it was done: the shim's array is byte-identical to the real one, 329
  lines and 41 entries.
- **The mutation matrix of the slice that built `mnema-doc` is still unfilled** — its report
  carries `## As mutações — *(preenchido ao final da matriz)*`. The bench is clean of applied
  mutations, which is evidence the battery ran to the end and reverted, but no write-up of it
  exists. The instrument that spent this round's money is therefore **not certified in
  writing**, and that is a fact about the certification and not about this capture.
- **The `relatime` instability** above. Not fixed, by instruction, and no number depends on it.
- **173 sandboxes under `/tmp`** from this and earlier sessions, and **two orphaned
  wrapper+server pairs** (pids 2929423/2929430 and 2929608/2929615) alive since 22:39 of 20 Aug
  with their sandboxes still on disk. Neither was created by this run and neither was killed by
  it: ownership between two sessions is ambiguous, and killing the wrong one corrupts a live
  measurement. They are idle and they did not touch this round.
- **The contaminated worktree** at `/home/felipe/…/round3/mnema` (257 MB, detached at
  `e085c7b3`) still carries mutation `h` and was left in place deliberately as the evidence for
  the third attempt's diagnosis. This round used a **new** worktree and did not reuse it.

---

## What this capture does and does not license

**It answers the question the round was pre-registered to answer.** The +73.6 points round 2
measured for `mnema+` over `mnema` belong to the **opening document**, not to the per-edit
push: with the push switched off through the product's own verb, the arm scores the same
100.0% on all six headline tasks. The subtraction is one recorded switch position and nothing
else, and it comes out at zero.

**It does not say the push is worthless in principle.** It says the push, **arriving where it
arrives**, never had a later write to act on in any of 160 cells, and that the two arms tie.
Those are two different claims and only the second is measured. Distinguishing them needs an arm
that moves the arrival point, which round 3 withdrew before it ran and which
[`arms.md`](../../round-3/arms.md) said should be built *"if, and only if, this round shows that
the push adds something."* **This round shows that it does not**, so by that file's own order the
timing arm stays unbuilt.

**It does not retract, or re-test, round 2's 54.2% for `prosa`.** That arm is not in this round
and its published number stands as published.

**It does not compare `mnema-doc` against the cheapest thing carrying the same decision.**
`prosa` would have been that comparison and the freeze declared the cost of dropping it. So the
strongest available reading of this capture — *a single committed markdown file already achieved
54.2% in round 2, and the whole surface achieves 100.0% here against a `base` of 33.3%* — mixes
two captures and two task sets, and this report does not make it a claim.

**And it does not say the surface beats the installed alternative.** `mnema-doc` ≈ `host` and
`mnema+` ≈ `host`, both at +0.0 points with 0 of 6 tasks discriminating. Round 2 read
`mnema+` ≈ `host` at −8.3 points over 1 discriminating task; here the tie is exact. **The
document ties with the memory the coding agent already ships, and the round says the same thing
about the whole surface.**
