---
name: diagnosing-recording
description: Use when asked why an agent did or did not record a decision in a session, or when a session that settled choices left nothing in the project's record
---

# Diagnosing recording

A session that settled a choice and recorded nothing is evidence for the next row of the table in
`recording-decisions`. This reads the host's transcripts of the session and says what happened,
citing the line it says it from. A finding with no line is dropped.

<SUBAGENT-STOP>
If you were dispatched by another agent to do a task other than this diagnosis, skip this skill:
reading a conversation is its own task, and a subagent that wanders into one reads somebody's
private words for nothing.
</SUBAGENT-STOP>

## What the transcripts are, and where

The host writes one JSON object per line. Claude Code keeps them under `~/.claude/projects/`, or
under `$CLAUDE_CONFIG_DIR/projects/` where that is set, in a directory it names by flattening the
path it started in. That name is lossy — `/`, `.` and `-` all become `-`, so a sibling project can
share a prefix — so do not pick a session by directory name. A transcript belongs to a project when
the `cwd` recorded on its lines is the project's root or under it. `packages/code/src/transcripts.ts`
in the mnema repository is the product's own reader of this store and the reference for each fact
below; it reads token counts, never words, and this skill is the one place that reads words, on
purpose and for one question.

- A session is one main transcript and the transcripts of its subagents nested beside it. The
  session's id is on the lines (`sessionId`), not in the file name.
- A line per content block: one assistant message is several lines, and a tool call is its own
  line. Count a message once, by its `message.id`.
- A person's prompt is a `user` line whose content is text, with `origin` `human` where the host
  writes one. Tool results are `user` lines too; so are injected text (`isMeta`) and notifications.

## What to do

1. Find the session: the project's transcripts, newest first, or the one the person names.
2. Number the lines: `grep -n` over the file gives every finding its line. Every claim below is
   a `<transcript path>:<line>`.
3. Lay out the timeline, with the first line of each:
   - where a choice was settled: an assistant line that picks between approaches, a library, a trade-off, or a
     person's prompt that corrects or directs;
   - where the project's record was read: tool calls whose name ends in `governing_rules`, `search`,
     `read_record` or `bootstrap`;
   - where it was written to: tool calls whose name ends in `record_decision`, `capture_memory` or
     `record_observation`. In Claude Code the name carries a prefix, `mcp__plugin_mnema_mnema__` or
     `mcp__mnema__`; match on the end.
4. For each choice with no write after it, say which of these it was, with the lines: never
   weighed as a decision; weighed and not recorded; recorded somewhere else (the host's own memory,
   a file); recorded by a subagent, which hands decisions back instead of recording them.
5. Where the agent said why it did not, quote the sentence and match it against the Red Flags table
   of `recording-decisions`. A sentence that matches no row is a candidate for a new one, with this
   line as its evidence. A row is not added or rewritten without a result from before and after.

## What it does not do

It does not record the decisions it found; that is the job of the session that made them. It does not
copy a person's prompt into the record: quote the shortest sentence that supports a finding, and
leave the rest of the conversation where it is.
