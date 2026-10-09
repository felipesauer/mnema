---
name: recording-decisions
description: Use when a choice between approaches, libraries or trade-offs has just been settled in this project, when an option was turned down, or when the person has just told you how something is to be done here
---

# Recording decisions

A choice settled in this session and not recorded is gone when the session ends: the next
session works it out again, or undoes it. mnema is this project's signed, append-only record of
those choices, kept with the repository, and the server this plugin connects is the way to write
to it.

<SUBAGENT-STOP>
If you were dispatched by another agent to do a task, you do not record. Put each decision you
made in your final reply: what was settled, why, and what was turned down. End the reply with one
fenced block whose info string is `mnema-handback`, holding
`{"decisions":[{"settled":"…","why":"…","turnedDown":"…"}]}`, the list empty if you settled nothing
(`mnema handback --schema` prints the schema). A hook of this plugin sends a reply without it back
once. Whoever dispatched you records it. Then skip the rest of this skill.
</SUBAGENT-STOP>

## When it applies

- A choice was settled that someone could later question: a library, an approach, a trade-off.
- An option was turned down, and the reason is not in the code.
- The person told you how something is to be done here, or corrected how you did it.

## What to do

1. Look first. `governing_rules` with a path lists what is already recorded for it, and `search`
   finds a record by the words written in it. A choice that is already recorded is not recorded again.
2. Record it when it is settled, not in a batch at the end: `record_decision`, with the `rationale`
   and, in `alternatives`, what was turned down and why.
3. A decision is born `proposed`. A person accepts it; it is in force here once accepted, and not before.
4. Something learnt about this project that its code does not show, and that the next session
   would otherwise work out again, goes to `capture_memory`.
5. A rule that governs a path is enforced at the host's editing tools, not at its shell. Writing
   to such a path through the shell (`sed -i`, a redirect) goes round the rule and is not done:
   if the rule stands in the way, say so to the person.

Not for the record: a credential (a record is permanent, and a public one is committed and
cloned), personal data such as an email address (the `mnid` already says who wrote), what
the code or its history already says, or a log of every step.

## Red Flags

Each row is a thought that comes before a choice goes unrecorded, and what the project measured
against it. Where every one came from: `references/where-each-flag-came-from.md`.

| Thought | Reality |
|---|---|
| "Nobody asked me to record this." | Nobody will. Of 9,448 tool calls over twelve days in the field, 6 went to this server, and the three that wrote came after a person typed that it should be used. A settled choice is the ask. |
| "I will find the tool when I need it." | A host that defers tools loads only their names and the server's instructions. Every tool search seen in the field was for a name already decided on, never for what a tool does. The name is `record_decision`. |
| "I already saved it in my own memory." | In the same field data the host's own memory was written more than twenty times unasked, while this record's three notes came after a person asked. The host's memory is not signed, not kept with the repository, and not part of this project's record. |
| "The person said it in the conversation, so it is written down." | The conversation is not kept with the project. Where a rule was not in the project, 2 of 16 measured cells ended by asking the person for it in chat and changed no file; what the person answers there lives only there until somebody records it. |
| "I know this project, I do not need to look at what is decided." | The agent asked the record in none of 20 cells in the first round and none of 40 in the second; in the third, 2 of 80. What is in force is one call away: `governing_rules`. |

Where this host names the tools and what it calls them: `references/tools-by-host.md`.
