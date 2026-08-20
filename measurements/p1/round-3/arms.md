# The five arms of round 3

**Declared before the fifth one exists.** Four of these arms ran round 2 and are
unchanged, byte for byte, down to the command line. The fifth is a
**declaration**: no code in the harness seeds it yet, and the harness refuses to
run a cell of this round until it does — the arms are a field of
[`split.json`](split.json), the harness compares that field against the arms it
can actually seed, and a mismatch ends the run by name.

That refusal is round 2's, and it worked exactly as written: it stopped round 2
until `mnema+` existed and then **lifted by itself** the day it did, without a
switch. It is reused here for the same reason. A round that quietly ran four of
five arms would write a `cells.jsonl` with no line for the arm the round exists
to measure, over tasks that can only be spent once.

| arm | what it holds | what it isolates |
|---|---|---|
| `base` | no record, no memory, no decision file | the floor |
| `prosa` | the same decision, verbatim, in a `DECISIONS.md` committed at the repository root | **the knowledge without the product** |
| `host` | the same decision in the coding agent's own automatic memory, seeded before the cell | **the alternative that is already installed** — and the arm that won round 2 |
| `mnema+` | the record with the decision written and accepted, MCP on, and the record **served unasked and charged for** on every edit | **the product as round 2 measured it** |
| `mnema++` | the `mnema+` arm, plus the governing rule put in front of the model **before its first write** | **the one variable round 2 left open** |

## Why `mnema` is not in this round, and it is not a saving

`mnema` — the record present, MCP on, nothing pushed at the agent — **has been
measured twice and answered the same both times.**

| round | `mnema` | `base` | read as | the mechanism column |
|---|---|---|---|---|
| 1 | 0/8 on the two tasks that discriminated | 0/8 | `≈` | `mcp_asked` false in **20 of 20** |
| 2 | 18.1% | 16.7% | `≈`, +1.4pt | `mcp_asked` false in **40 of 40** |

A third measurement of it would spend a fifth of this round — 40 cells at
`n = 4` — to reconfirm a fact that two independent captures agree on, over tasks
that cannot be spent twice. It is dropped for that reason and for no other.

**And the cost of dropping it is stated, because it is real.** With `mnema` in
the round, a high `mnema+` could be split into *the record was reachable* and
*the charging reached the agent*. Round 2 made that split — `mnema+` > `mnema`,
**+73.6 points, 6 of 6 tasks discriminating** — and this round **cannot make it
again**. What round 3 therefore cannot see is a *regression* in that split: if
something in the product broke the charging between rounds, round 3 would read a
low `mnema+` and have no arm to attribute it to. That is the price, it is
accepted, and the reason it is acceptable is that `mnema+` is itself in this
round as the control for `mnema++` — so the charging is still being measured,
just not against its own absence.

`base` stays for the same reason it stayed in round 2: without a floor, a tie has
no scale, which was round 1's design defect. `prosa` stays because it is the
uncomfortable arm — round 2 measured **54.2%** for a decision sitting in one
committed markdown file, which is more than half of what the product's own
surface achieved, and any round that drops it stops being able to say so.

## What `mnema++` has to hold when it exists

Written here, now, so the slice that builds it has a target it did not choose
after seeing a result. It is the `mnema+` arm plus **one** variable — *when* the
governing rule reaches the model — and the surface is bound by the six ties of
the project's foundation plus the seventh, exactly as `mnema+` was.

| tie | what it means for a cell of this arm |
|---|---|
| **G1** the rule is the RECORD's | anything the arm puts in front of the model names the accepted decision, **by id**, out of the cell's own record. A cell whose injection cites nothing is a broken cell, not a result |
| **G2** every charge is a fact | what was put in front of the model is an attributed event in the cell's own record, so the cell can be read afterwards for what governed it — **and for WHEN**, which is the whole of what this arm varies |
| **G3** the proof does not change meaning | `verify` gains no field and no level for this arm |
| **G4** every charge is switchable off, and the switch is recorded | the arm declares the injection ON; a cell that turned it off records that it did |
| **G5** silence is never an answer | the cell says the injection RAN, and says it separately from the per-edit push it is layered on. Round 2's `hook_ran` exists because a mute handler and a handler that never fired produce the same cell; this arm needs its own equivalent, because it has **two** channels and one line has to be able to say which of them spoke |
| **G6** what is pushed at a MODEL is framed | text from the record that reaches the model arrives framed as record, not as instruction — and this matters more here than in `mnema+`, because this arm's text arrives before the model has read a line of the code it is about |
| **G7** the capability lives in the portable half | the arm's intelligence is in the MCP server and the CLI; the host wiring is a manifest. An arm whose behaviour lives in the hook is an arm that measures Claude Code |

**And one requirement that is this arm's alone.** The line has to carry **how
many times the agent wrote** in the cell. Round 2's line cannot answer it:
`mcp_pushed` is **1 in 47 of the 48 cells that have the column**, because the
per-edit channel speaks once per cell and not once per edit, and `num_turns`
counts turns of conversation and not writes. This arm exists to move text from
*after the first write* to *before it*, so a round that cannot count the writes
cannot check its own prediction. [`prediction.md`](prediction.md) states the
prediction; [`reading.md`](reading.md) makes the column a condition of reading
it.

**The isolation is round 1's, unchanged, and round 2 ran it.** Same model, same
permission mode, same per-cell sandbox, same fresh record and identity per cell,
same appended system prompt in all five arms, same command line. The only thing
that differs between arms is the CONTENT of the per-cell configuration — which is
the correction that saved a published benchmark elsewhere whose baseline was
running the treatment in secret through a global hook, and it is why this arm is
declared item by item rather than installed from outside.

**What this file does not do.** It does not say the injection will work, and it
does not predict which row of [`reading.md`](reading.md) the round will land on.
**Three of those rows are outcomes in which the arm this round exists to measure
is worth nothing measurable, and one is an outcome in which it makes the product
worse.**
