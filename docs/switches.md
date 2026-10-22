# What is switched on, and what begins off

mnema puts the record in front of a model in several places without being asked: the document a
session opens with, the rules at each edit, a line after a write, a hook at the end of a turn.
Each of those is a **channel**, and each can be switched off with `mnema switch off <name>`. Two
channels begin the other way round: they are **off until a person switches them on**, because what
they do reads a conversation or holds a write.

Switching is recorded: it is a signed, attributed, dated fact of the chain, committed with the
repository by default, so a reader can tell *"no rule addressed that file"* from *"somebody turned
the push off that week"*. Only a person at a shell switches a channel: the MCP server has no tool
for it, so an agent cannot switch off what governs its own work through the door built for agents.
`mnema switch` prints where each one stands now and who switched it; the verbs and their flags are
in [the command reference](cli-reference.md#switching-off-what-mnema-hands-to-a-model).

<!-- The table below is generated from packages/code/src/record-framing.ts: edit the table there. -->

| Channel | Begins | What it carries | To flip it |
| --- | :---: | --- | --- |
| `brief-document` | on | the document `mnema brief` prints, which a session opens with and a subagent starts with: the decisions in force and the adopted patterns of the committed record, by name | `mnema switch off brief-document` |
| `recall-document` | on | the notes `mnema recall` prints, which a session opens with: the memories and observations recorded for this project, from every tree this machine holds for it, the ones near what the session touches first | `mnema switch off recall-document` |
| `edit-rules-push` | on | the rules addressed at a file, handed over at each edit of it, beside the result of that write | `mnema switch off edit-rules-push` |
| `edit-asks-a-person` | on | the pause before a file is written where the record asks that a person look first: the rules go on arriving, and nothing stops | `mnema switch off edit-asks-a-person` |
| `edit-refuses-a-write` | on | the refusal of a write where a rule of the record refuses one: such a write goes through, the rules go on arriving, and a rule that asks for a person still asks | `mnema switch off edit-refuses-a-write` |
| `agent-accepts` | on | an agent ruling a decision in force: with it off, an agent’s `accept` is refused and only a person at the command line can accept: a proposed decision waits, and nothing else changes | `mnema switch off agent-accepts` |
| `edit-first-write-gate` | off | the hold on the first write of a session to a file a rule addresses: with it on, that write is refused once, with the rules in the reason, and the same write repeated goes through. Off until switched on; it holds in Claude Code, where the server remembers the session | `mnema switch on edit-first-write-gate` |
| `user-corrections` | off | the proposals recorded from what a person typed into a session: with it on, a `Stop` hook reads the transcript, and each time the person corrected the agent a decision is recorded as proposed in this machine’s private tree, and so is each answer the person gave to a question the agent asked. Off until switched on | `mnema switch on user-corrections` |
| `choice-settled` | on | the sentence handed to the agent after a question it asked the person was answered: that a choice may have been settled there and which tool records it. It reads which tool ran and writes nothing | `mnema switch off choice-settled` |
| `host-memory-mirror` | on | the copy of the host’s own memory: with it on, a `PostToolUse` hook copies each note Claude Code writes to its memory directory into this machine’s private tree, once per content, leaving out the index `MEMORY.md` and the notes about the person (`type: user`) | `mnema switch off host-memory-mirror` |
| `decision-file-written` | on | the line beside a write to a file that holds decisions (an ADR, a plan, a ledger, a rules file) the record cites nowhere, naming the command that reads it into the record, once per session and file | `mnema switch off decision-file-written` |
| `subagent-handback` | on | the return of a subagent that ends its final reply without the block of decisions the record asks for: with it on, a `SubagentStop` hook sends the subagent back once, with the format; off, a subagent stops as it would without the plugin | `mnema switch off subagent-handback` |
| `tool-call-count` | on | the local count of tool calls: with it off, the server keeps no line of the calls it answers and `mnema usage --tools` shows what was kept before. The count is a file on this machine, outside the record, with the tool’s name and its result and nothing of the arguments | `mnema switch off tool-call-count` |
| `last-session` | on | the section of the notes `mnema recall` prints that says where the last session stopped: its goal, the decisions it recorded and the counts of what it left, read from its journal when it was another session and a recent one | `mnema switch off last-session` |
| `after-a-compaction` | on | the sentence a conversation is handed right after it was compacted, saying what the session had recorded before (decisions by label, notes copied, files edited, questions answered with no decision after), read from its journal | `mnema switch off after-a-compaction` |
| `session-journal` | on | the session journal: with it off, no file is kept of what a session did with the record, and nothing can say, to a later session, to a compaction or on the run that closes, what this one did. The journal is a file on this machine, outside the record, holding ids and counts and none of the session’s words | `mnema switch off session-journal` |
| `session-tally` | on | the line a session’s `Stop` hook prints: how many files its own tool calls wrote and how many decisions were recorded since it opened | `mnema switch off session-tally` |

<!-- End of the generated table. -->

A channel that begins on stays on until somebody records a switch off, and one that begins off
stays off until somebody records a switch on. Where two trees disagree (the committed one and this
machine's private one) and cannot be ordered, off wins.
