---
name: recording-rulings
description: Use when the workflow you are following has you write down rulings, calls or provisional decisions in a ledger or progress file that is thrown away when the work ends
---

# Recording rulings

Some workflows have the agent decide and go on instead of stopping to ask, and keep what it
decided in a ledger beside the work: a line per ruling, with what was ruled, why, and what it
costs if it is wrong. Where that ledger is thrown away when the work ends, the calls go with it.
Recorded in mnema, they are kept with the repository, signed, and a person can accept or reject
each one later.

This skill leaves the workflow as it is. The ledger stays where the workflow keeps it, and each
ruling is also recorded.

<SUBAGENT-STOP>
If you were dispatched by another agent to do a task, you do not record. Put each ruling you made
in your final reply, as the workflow's own ledger line says it, and let whoever dispatched you
record it. Then skip the rest of this skill.
</SUBAGENT-STOP>

## What a ruling becomes

A ruling is a decision made without waiting for an answer, which is the state a decision is born
in here: `proposed`, awaiting a judgement. Nothing about it is in force until a person accepts it.

| In the ledger | In the record |
|---|---|
| What was ruled | the title of a `record_decision` |
| Why | its `rationale` |
| What it costs if it is wrong | the last line of the `rationale`, in the same words the ledger used |
| The option it was chosen over | `alternatives`, with why it was turned down |

Record it when the ruling is made, beside the ledger line, and not in a batch at the end.

## What the rest of the ledger becomes

- A minor the work left for later, found in review: a `record_observation` about the record it
  concerns, by its id; with no record to attach it to, `capture_memory`.
- The state of each step of the plan stays in the workflow's own file. This skill is only about
  the calls.

A ruling that is already recorded is not recorded again: `search` finds a record by the words
written in it.

The thoughts that come before a choice goes unrecorded, and what the project measured against each,
are the table in `recording-decisions`; a ruling is a settled choice like any other, so that table
applies to it. The tools are named the same in every host, and its `references/tools-by-host.md`
says what each host calls them.
