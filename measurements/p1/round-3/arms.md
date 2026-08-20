# The four arms of round 3

**Declared before the arm that separates them exists.** Three of these arms ran
round 2 and are unchanged, byte for byte, down to the command line. The fourth is
a **declaration**: no code in the harness seeds it yet, and the harness refuses to
run a cell of this round until it does — the arms are a field of
[`split.json`](split.json), the harness compares that field against the arms it
can actually seed, and a mismatch ends the run by name.

That refusal is round 2's, and it worked exactly as written: it stopped round 2
until `mnema+` existed and then **lifted by itself** the day it did, without a
switch. It is reused here for the same reason. A round that quietly ran three of
four arms would write a `cells.jsonl` with no line for the arm the round exists to
measure, over tasks that can only be spent once.

| arm | what it holds | what it isolates |
|---|---|---|
| `base` | no record, no memory, no decision file | the floor, without which a tie has no scale |
| `host` | the same decision in the coding agent's own automatic memory, seeded before the cell | **the alternative that is already installed** — and the arm that won round 2 |
| `mnema-doc` | the record with the decision written and accepted, MCP on, the **opening document** served, and the per-edit push **switched off** | **the half of the surface round 2 measured without knowing it** |
| `mnema+` | the same, with the per-edit push **on** | **the product as round 2 measured it** — and the difference between the two arms is the push, and only the push |

**The pair is the point.** `mnema+` in round 2 carried two channels at once, and
no arm of that round separated them. This round's whole question is which of them
the number belongs to, and the answer is a subtraction between two arms that
differ in **one switch position**.

## Why this round changed after it was frozen, and why that is allowed

**This round was frozen once already, with five arms — `base`, `prosa`, `host`,
`mnema+`, `mnema++` — and it is re-frozen here, in the same pull request, before
any mechanism of it was built and before a single cell of it ran.** That is the one
change a pre-registration permits, and the reason it is permitted is that nothing
about it can have been chosen after a result: there is no result. The tasks, their
digests, the split and the headline set are **untouched** — swapping an arm touches
no task — and the withdrawal is carried as data in
[`split.json`](split.json)'s `arms_withdrawn`, so a reader does not have to take
this paragraph's word for which arms left.

**What forced it is written in the round's own data, not in an opinion.** Round 2's
committed `cells.jsonl` says `mcp_pushed` is **1 in all 24 headline cells** of
`mnema+`, and that column counts the `tools/call` messages the host dispatched to
the cell's own server — one per matched `Write|Edit|NotebookEdit`. One dispatch is
therefore **at most one matched edit**, and the capture of 19 Aug in
[`../mcp-tool-channel/`](../mcp-tool-channel/) measured that the pushed text lands
**after** the tool result of the edit that triggered it. So in every headline cell
of round 2 the per-edit text arrived after the only write that cell had: **the push
could not have changed a byte of the code in any of them, including the five tasks
where the arm scored 1.00.** What round 2 measured, on that arm, was the opening
document.

## Why `mnema++` is not in this round

`mnema++` — `mnema+` with the governing rule put in front of the model **before**
its first write — was declared to test one hypothesis: that the shortfall on
`a14-tie-break` was about **when** the text arrives. **That hypothesis is refuted
by round 2's own cells, and the refutation was free.**

| what round 2's committed line says | what it does to the hypothesis |
|---|---|
| `mcp_pushed` is **1** in **24 of 24** `mnema+` headline cells, and `channel_served` is `edit-rules-push:1` in all 24 | the timing was **identical** in all six headline tasks — including the five that scored **1.00** |
| five of the six headline tasks scored **1.00** and one scored **0.50** | a cause that was the same everywhere cannot explain an outcome that differed in one place |

An arm built to vary a quantity that has already been shown not to vary with the
outcome measures nothing. It is withdrawn for that reason and for no other, and
**it comes back if, and only if, this round shows that the push adds something** —
that is the `mnema+` > `mnema-doc` row of [`reading.md`](reading.md), and it is the
row that gives a timing question a premise it does not currently have.

**And the cost of withdrawing it is stated, because it is real.** If the push turns
out to add nothing, this round cannot distinguish *the push does not help* from
*the push does not help WHERE IT CURRENTLY ARRIVES*. That distinction needs an arm
that moves it, and this round will not have one. What makes the price acceptable is
the order: an arm that varies the arrival point is worth building once something is
known to arrive and act, and today nothing is.

## Why `prosa` is not in this round

`prosa` — the same decision, verbatim, in a `DECISIONS.md` committed at the
repository root — **did the job it was built for, and the number is published.**

| round | `prosa` | read as |
|---|---|---|
| 1 | **3/8** over the two tasks that discriminated (`a2-due-day` 1/4, `a4-collation` 2/4) | the knowledge without the product is not nothing, and it is not the product either |
| 2 | **54.2%** over six headline tasks | **more than half of what the product's own surface achieved**, from one committed markdown file |

That is the uncomfortable measurement of this whole front, it is in
[`results/2026-08-20-full/report.md`](../results/2026-08-20-full/report.md), and
**nothing in this round retracts it.** The reason it leaves is that the question
this round asks is **internal to the surface** — which of two channels the surface's
own number belongs to — and `prosa` cannot answer it: it carries neither channel,
so it sits at the same distance from both arms of the comparison and adds no term
to the subtraction.

**And the cost is stated.** With `prosa` in the round, a high `mnema-doc` could be
read against the cheapest thing that carries the same decision, and this round
cannot make that comparison. The claim *"the value is the knowledge, not the
product"* therefore stands on round 2's 54.2% and is **not re-tested here**. It is
not weakened either: a published number does not need a second round to keep
meaning what it said.

## Why `mnema` is not in this round, and it is not a saving

`mnema` — the record present, MCP on, nothing pushed at the agent — **has been
measured twice and answered the same both times.**

| round | `mnema` | `base` | read as | the mechanism column |
|---|---|---|---|---|
| 1 | 0/8 on the two tasks that discriminated | 0/8 | `≈` | `mcp_asked` false in **20 of 20** |
| 2 | 18.1% | 16.7% | `≈`, +1.4pt | `mcp_asked` false in **40 of 40** |

A third measurement of it would spend a quarter of this round — 40 cells at
`n = 4` — to reconfirm a fact that two independent captures agree on, over tasks
that cannot be spent twice. It is dropped for that reason and for no other.

**And the cost of dropping it is stated, because it is real.** With `mnema` in the
round, a high `mnema-doc` could be split into *the record was reachable* and *the
document reached the agent*. Round 2 made that split — `mnema+` > `mnema`, **+73.6
points, 6 of 6 tasks discriminating** — and this round **cannot make it again**.
What round 3 therefore cannot see is a *regression* in that split: if something in
the product stopped the document reaching the agent between rounds, round 3 would
read a low `mnema-doc` and have no arm to attribute it to. That is the price, it is
accepted, and what makes it acceptable is that `mnema+` is in this round with its
own round-2 figure to be checked against — the row `mnema+` ≈ `base` of
[`reading.md`](reading.md) is exactly that check, and it blocks every other row
until it is explained.

## What `mnema-doc` has to hold when it exists

Written here, now, so the slice that builds it has a target it did not choose after
seeing a result. It is the `mnema+` arm **minus one channel**, and the surface is
bound by the six ties of the project's foundation plus the seventh, exactly as
`mnema+` was.

**It needs no product code, and saying so is part of the declaration.** The switch
this arm turns exists and is measured — `mnema switch --off edit-rules-push`, one
indexed lookup per tree, **0.04 ms** flat in the size of the record
([`../switch-cost/`](../switch-cost/)). What does not exist is the **seeding**: the
harness's arm list has no `mnema-doc` in it, so the round is still refused, and it
is refused twice over — the harness's own round list stops at 2, and its arm list
stops at round 2's five. The mechanism this round waits on is a bench mechanism.

| tie | what it means for a cell of this arm |
|---|---|
| **G1** the rule is the RECORD's | the opening document names the accepted decision of the cell's own record, by id, exactly as in `mnema+`. A cell whose document cites nothing is a broken cell, not a result |
| **G2** every charge is a fact | the document's service is an attributed event in the cell's own record, so the cell can be read afterwards for what governed it |
| **G3** the proof does not change meaning | `verify` gains no field and no level for this arm |
| **G4** every charge is switchable off, and the switch is recorded | **this arm IS a switch position**, and that is why the tie is the load-bearing one here: the cell records `edit-rules-push` off, with who switched it and when, and the line carries the position of every channel. A cell of this arm whose line says the push was on is an invalid cell |
| **G5** silence is never an answer | the cell says the document RAN (`hook_ran`) and says, separately, that the push did **not** speak — an empty `channel_served` for `edit-rules-push` beside a `channels_on` that says it was off. The two silences are opposite conclusions about the product and the line has to tell them apart |
| **G6** what is pushed at a MODEL is framed | the document arrives framed as record, not as instruction — unchanged from `mnema+`, and it is the only channel left in this arm to frame |
| **G7** the capability lives in the portable half | the arm's intelligence is in the MCP server and the CLI; the host wiring is a manifest. An arm whose behaviour lives in the hook is an arm that measures Claude Code |

**There are TWO ways to build this arm and the choice between them is declared
here, because the other one is already measured.** The bench's own isolation note
records that without the `governs` address on the seeded decision *"the tool answers
`{}` and appends nothing, so the arm would collapse into the document channel
alone"* — which is a `mnema-doc` built by **withholding the address**. It is
rejected: an arm seeded with no address holds a **different record** from `mnema+`,
so the pair would differ in the record's content and in the channel at once, and the
subtraction between them would no longer be the push. **The switch route keeps the
two records identical** — same decision, same acceptance, same address — and puts
the whole difference in one recorded switch position. That the rejected route works
is not in doubt; what it cannot do is isolate.

**The third channel is ON in both arms, and it is inert in both for a reason the
bench asserts.** `edit-asks-a-person` was on in all 48 `mnema+` cells of round 2 and
stopped nothing, because the gate needs a rule carrying the `asks-for-a-person`
address and the seed deliberately gives none — a `-p` cell has nobody to ask, and
every cell of an arm that had it would come back with the edit refused. The bench
asserts that absence rather than trusting it. So the channel is in the same position
on both sides of the subtraction and contributes nothing to it, which is what being
a controlled variable means.

**And one requirement that is this pair's alone: the hook declaration is
byte-identical in both arms.** The host must still call the tool before every
matched edit in `mnema-doc`, and the tool must answer with nothing, because the
channel is off — the product already works that way, and both switches are read
before the path is even resolved. Two consequences, and they are the reason the arm
is declared this way rather than by removing the hook:

1. **the two arms differ in exactly one bit** — a switch position in the cell's own
   record — instead of differing in a switch *and* in the host wiring;
2. **`mcp_pushed` keeps counting in both arms**, so both sides of the comparison
   carry the number of dispatches the host made, which is the column
   [`prediction.md`](prediction.md) is checked against and the one
   [`reading.md`](reading.md) makes a condition of reading it.

**The isolation is round 1's, unchanged, and round 2 ran it.** Same model, same
permission mode, same per-cell sandbox, same fresh record and identity per cell,
same appended system prompt in all four arms, same command line. The only thing
that differs between arms is the CONTENT of the per-cell configuration — which is
the correction that saved a published benchmark elsewhere whose baseline was
running the treatment in secret through a global hook, and it is why this arm is
declared item by item rather than installed from outside.

**What this file does not do.** It does not say which half of the surface will win,
and it does not predict which row of [`reading.md`](reading.md) the round will land
on. **Three of that table's rows are outcomes in which a channel this product ships
and charges for on every edit is worth nothing measurable or worse, and one of them
is the outcome round 2's own data predicts.**
