# The plugin arm — a mechanism check, and not a measurement

**Eight cells. It is not a rate, and nothing here may be compared with
[the round](../2026-08-18-full/report.md).**

The round found the first promise did not survive as written, and named the cause without inference:
`mcp_asked` false in twenty of twenty instrumented `mnema` cells — the agent never called a tool.
The `host` arm carried the same decision in a mechanism the host injects **without being asked**, and
conformed 8/8 on exactly the two tasks where `base` conformed 0/8. The plugin is that mechanism on
our side, shipped and unproven.

**Why this is not a measurement.** These eight ran on the two tasks the round had already shown to
discriminate. The selection is biased by a result, the tasks are spent, and `n` is four. The caveat
rides in every line as `selection_note`, so a line read on its own still carries it.

## What ran

| task | base | prosa | host | mnema | **plugin** |
|---|---|---|---|---|---|
| `a2-due-day` | 0/4 | 1/4 | 4/4 | 0/4 | **4/4** |
| `a4-collation` | 0/4 | 2/4 | 4/4 | 0/4 | **1/4** |

The first four columns are the round's, quoted for reading. Only the last is from this file.

## What it answers

**The injected context arrives, and it can move the verdict.** On `a2` the arm went from 0/4 to 4/4
against the same task, the same model and the same prompt — one variable apart from the `mnema` arm.
`hook_ran` is true in all eight, so no cell is the silent-handler case that would have read as "the
plugin did not help".

**Arriving is not enough.** On `a4` the same mechanism, the same injection and the same handler
produced 1/4. A title handed over as the session opens did not survive to the moment the code was
written. Whatever the plugin buys, it is not uniform across tasks that are equally unrecoverable
from the code.

## What it found that nobody predicted

`mcp_asked` is **true in some of these cells** and was false in twenty of twenty instrumented cells
of the arm without the hook. Receiving the record at the opening appears to make the agent ask for
more of it afterwards. This file cannot say how reliably — that is a hypothesis a designed round
would have to test, on tasks nobody has spent.

`hook_invocations` names every verb that reached the cell's `mnema` through the shim the arm needs:
**`brief:1` and nothing else**, in all eight. The second difference this arm carries — a `PATH` the
agent's shell can also see — was declared before the run and was **not used**.

## What is committed here

`cells.jsonl` only, for the reason the [results README](../README.md) gives: the raw output and the
diffs describe the tasks, and the held-out tasks are not published yet.
