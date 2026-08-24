# The four arms of round 4

**The same four round 3 ran, byte for byte, and the round changed everywhere else.** No arm
arrives, no arm leaves, and that is deliberate: round 4 asks round 3's question again on tasks
that can answer it. Changing the arms as well would make the two rounds incomparable in exactly
the way that would matter.

| arm | what it holds | what it isolates |
|---|---|---|
| `base` | no record, no memory, no decision file | the floor, without which a tie has no scale — and the regression check that blocks every other row |
| `host` | the same decision in the coding agent's own automatic memory, seeded before the cell | **the alternative that is already installed** — the arm that has beaten or tied this product in every round it has run |
| `mnema-doc` | the record with the decision written and accepted, MCP on, the **opening document** served, and the per-edit push **switched off** | the document channel alone |
| `mnema+` | the same, with the per-edit push **on** | **the product as it ships**, and the difference between the two arms is the push, and only the push |

**The pair is still the point**, and the subtraction between `mnema-doc` and `mnema+` is still one
switch position in the cell's own record. What round 3 could not do with that pair was see
anything: both arms scored 1.00 on all six headline tasks, so the subtraction had no room to
happen in. Round 4 changes the tasks and the size, and leaves the pair alone.

## What round 3 measured with these arms, and why the arms are not the thing to change

| | round 3 |
|---|---|
| `mnema+` ≈ `mnema-doc` | +0.0pt, **0 of 6** tasks discriminating. Both arms 100.0% |
| `mnema-doc` ≈ `host` | +0.0pt. Both 100.0% |
| `mnema+` > `base` | +66.7pt, 6 of 6. The regression check held, so every other row was readable |

**Three arms at the ceiling is a fact about the tasks.** `base` scored 33.3% on the same six
tasks, so the tasks did carry a decision the code does not reveal — they were unrecoverable
without the knowledge and trivial with it. Nothing in an arm fixes that, which is why this round
spends its design on the tasks and its money on the size.

## Why `mnema++` is still not here

`mnema++` — the governing rule put in front of the model **before** its first write — was withdrawn
from round 3 because round 2's own cells had already refuted the hypothesis it existed to test.
Round 3's `arms.md` said it comes back *"if, and only if, this round shows that the push adds
something"*, and round 3 showed the opposite: `mnema+` ≈ `mnema-doc` at zero points.

**So the condition for building it has not been met, and this round is what could meet it.** If
round 4 reads `mnema+` > `mnema-doc`, the arm that varies the arrival point acquires the premise it
has never had. If round 4 reads `≈` again, on tasks that this time had room, the question about
timing has been asked twice and answered twice.

**And the cost of not having it is the same cost round 3 declared, unchanged**: a round that reads
`≈` cannot separate *the push does not help* from *the push does not help WHERE IT CURRENTLY
ARRIVES*. Round 3 could not tell those apart and neither can this one.

## Why `prosa` and `mnema` are still not here

Both left in round 3, both for reasons that are published there and that this round does not
retract: `prosa` sits at the same distance from both arms of the pair, so it adds no term to the
subtraction; `mnema` has been measured twice — `mcp_asked` false in 20 of 20 and then 40 of 40 —
and a third measurement would spend a quarter of a round to reconfirm two agreeing captures.

**The costs round 3 declared for dropping them are unchanged and are repeated rather than assumed
forgotten.** Without `prosa`, a high `mnema-doc` cannot be read against the cheapest thing that
carries the same decision. Without `mnema`, a low `mnema-doc` cannot be split into *the record was
reachable* and *the document reached the agent* — so this round, like round 3, cannot attribute a
regression in that split, and `base` is the only thing standing where that check would be.

## What is different in this round, and none of it is an arm

| | round 3 | round 4 |
|---|---|---|
| headline tasks | 6 | the sieve's survivors, up to 12 |
| runs per (task, arm) | 4 | **8** |
| threshold | 25 points, derived from the size of one task | derived per shape by [`../threshold.md`](../threshold.md), from a declared false-positive target |
| how the tasks were chosen | written and frozen | written to four declared mechanisms, then **sieved** on `mnema-doc` |

**The size is where the money went, and the reason is measured.** At ten tasks, moving from four
runs to eight takes the round from seeing a 15-point effect 11% of the time to 47%. The arms could
not have bought that at any price.

## The isolation, unchanged

Same model, same permission mode, same per-cell sandbox, same fresh record and identity per cell,
same appended system prompt in all four arms, same command line. The only thing that differs
between arms is the CONTENT of the per-cell configuration, and for the pair this round is about,
one recorded switch position. Everything [`round-3/arms.md`](../round-3/arms.md) declared about how
`mnema-doc` is built — the switch route rather than withholding the address, the byte-identical
hook declaration, `edit-asks-a-person` inert and asserted inert on both sides — holds here without
amendment, and the preflight checks it before every run.
