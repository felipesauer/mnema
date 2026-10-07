# Where each Red Flag came from

Every row of the table in `SKILL.md` answers something the project measured. No row is a guess
about what an agent might say, and none was written from a run made for this skill: the rows
were assembled from captures that already existed. What a capture shows is stated here with its
limits, because a row is only as good as the observation under it.

A row is not rewritten without a result from before and after the change. The skill shapes
behaviour the way code does, and this file is where the next row's evidence goes.

## "Nobody asked me to record this."

The field data quoted in `packages/code/src/mcp/instructions.ts`: 6 of 9,448 tool calls over
twelve days went to this server, and the three that wrote came after a person typed that it
should be used. It is one project over twelve days, so it says what happened there and not how
often it happens.

## "I will find the tool when I need it."

The same passage of `packages/code/src/mcp/instructions.ts`: every tool search the agent made
was a `select:` of a name it had already decided on, never a search by what a tool does. The
host's documentation, quoted there, says a host that defers tools loads only tool names and
server instructions at session start.

## "I already saved it in my own memory."

`packages/code/src/commands/recall.ts` (the opening paragraph): over twelve days in one project,
the host's own memory was written more than twenty times with nobody asking, and this record's
three notes were written after a person asked. It shows where an agent's notes went in those
sessions. It does not show why, and the row does not claim to know the agent's reason.

## "The person said it in the conversation, so it is written down."

On 27 August 2026, in 16 cells of one arm, on two tasks (a late fee and a freight band) the arm
without the decision wrote nothing and ended its turn asking the person for the rule ("I need to
know: what's the late fee rate?"). That capture is one arm, and no cell of it measures an arm.
What it does show is where an agent puts a rule it does not have: to the person, in the
conversation. It is kept as history in `docs/evidence.md` of the repository, with no file that
reruns it.
That a conversation is not part of the project's record is a fact about the conversation, not
something that capture measured.

## "I know this project, I do not need to look at what is decided."

In the rounds of 18 and 20 August 2026 (Claude Haiku 4.5), mcp_asked was false in every cell
that had the server to ask (20 of 20 and 40 of 40); in the round of 21 August 2026 it was true in
2 of 80, both on one task that already conformed. These are kept as history, with their day,
model and number of runs, in `docs/evidence.md` of the repository, and nothing in the tree
reruns them. `plugin/README.md` opens on the same number.
