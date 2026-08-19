# The five arms of round 2

**Declared before the fifth one exists.** Four of these arms ran round 1 and are
unchanged, byte for byte, down to the command line. The fifth is a **declaration**:
no code in the harness seeds it yet, and the harness refuses to run a cell of this
round until it does — the arms are a field of [`split.json`](split.json), the
harness compares that field against the arms it can actually seed, and a mismatch
ends the run by name.

That refusal is the point. A round that quietly ran four of five arms would write a
`cells.jsonl` with no line for the arm the round exists to measure, over tasks that
can only be spent once.

| arm | what it holds | what it isolates |
|---|---|---|
| `base` | no record, no memory, no decision file | the floor |
| `prosa` | the same decision, verbatim, in a `DECISIONS.md` committed at the repository root | **the knowledge without the product** |
| `host` | the same decision in the coding agent's own automatic memory, seeded before the cell | **the alternative that is already installed** |
| `mnema` | the record with the decision written and accepted, MCP on, and nothing pushed at the agent | **the product as round 1 measured it** |
| `mnema+` | the `mnema` arm, plus the record **served unasked and charged for** | **the surface built in answer to round 1** |

## Why `mnema` stays, and it is not sentiment

Round 1 measured the `mnema` arm at **0/8** on the two tasks that discriminated —
exactly what `base`, which carries no decision at all, scored — with `mcp_asked`
false in twenty of twenty instrumented cells. That number is the reason `mnema`
cannot be dropped: it is the control that separates two different claims.

- `mnema+` > `mnema` says **the charging is what worked**.
- `mnema+` ≈ `mnema` says the surface changed nothing measurable.
- Without `mnema` in the round, a high `mnema+` says only *"a record plus a
  surface beats no record"*, and the round could not tell which half did it.

`host` is the other half of the same question, and it is the uncomfortable one: it
carried the same knowledge in a mechanism the host injects without being asked, and
it conformed 8/8 where `base` conformed 0/8. If `mnema+` ties with `host`, the
mechanism is not ours to claim credit for; what is left of the product is the
proof, which is a different promise and a true answer.

## What `mnema+` has to hold when it exists

Written here, now, so the slice that builds it has a target it did not choose after
seeing a result. It is the `mnema` arm plus **one** variable — the surface — and the
surface is bound by the six ties of the project's foundation plus the seventh:

| tie | what it means for a cell of this arm |
|---|---|
| **G1** the rule is the RECORD's | anything the arm pushes or refuses names the accepted decision, **by id**, out of the cell's own record. A cell whose surface cites nothing is a broken cell, not a result |
| **G2** every charge is a fact | what the surface pushed or refused is an attributed event in the cell's own record, so the cell can be read afterwards for what governed it |
| **G3** the proof does not change meaning | `verify` gains no field and no level for this arm. A block is a fact like any other |
| **G4** every charge is switchable off, and the switch is recorded | the arm declares the surface ON; a cell that turned it off records that it did |
| **G5** silence is never an answer | the cell says the surface RAN. Round 1's near-miss is the precedent: a mute handler and a handler that never fired produce the same cell, and they are opposite conclusions about the product. `hook_ran` exists because of it, and this arm cannot ship without its equivalent |
| **G6** what is pushed at a MODEL is framed | text from the record that reaches the model arrives framed as record, not as instruction |
| **G7** the capability lives in the portable half | the arm's intelligence is in the MCP server and the CLI; the host wiring is a manifest. An arm whose behaviour lives in the hook is an arm that measures Claude Code |

**And the isolation is round 1's, unchanged.** Same model, same permission mode,
same per-cell sandbox, same fresh record and identity per cell, same appended
system prompt in all five arms, same command line. The only thing that differs
between arms is the CONTENT of the per-cell configuration — which is the correction
that saved a published benchmark elsewhere whose baseline was running the treatment
in secret through a global hook, and it is why this arm will be declared item by
item rather than installed from outside.

**What this file does not do.** It does not say the surface will work, and it does
not predict which row of [`reading.md`](reading.md) the round will land on. Three of
those rows are outcomes in which the product's first promise still does not survive.
