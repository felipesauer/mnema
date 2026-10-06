# What VS Code and Cursor hand to the model

A summary of what text from the mnema plugin reaches the model on two hosts: VS Code's Copilot Chat and Cursor's
command-line agent. Both were measured on 23 September 2026.

## VS Code

**Measured:** VS Code 1.137.0 with the Copilot Chat 0.65.0 built into it. The chat was set up through the anonymous
flow, offline, with no account and no network; a test model captured every request the host built.

- **`instructions`** (the server's own text, 1,755 characters) arrived whole in the system message, as an
  `<instruction>` block with no heading, in seven model families and the fallback. It was absent, with the server's
  tools in the request, in five families: `gpt-5-codex`, `gpt-5.1-codex`, `gpt-5.2-codex`, a MiniMax model and one
  more.
- **`brief` and `recall`** (the plugin's two opening texts) arrived whole in the user message, under "Additional
  instructions from hooks:", in every family tried, including the ones where `instructions` did not arrive.

## Cursor

**Measured:** Cursor's command-line agent 2026.09.18-9a7762b, on the free plan, with the `Auto` model (the only model
used), in 4 sessions, with the mnema build of commit `bf4bc077`. The prompt was read back from the chat the agent
keeps on the machine.

- **`brief`** (1,975 characters) and **`recall`** (761) arrived byte for byte, inside `<hooks_context>` in the first
  user message.
- **`instructions`** (1,755 characters) arrived as the namespace's own instructions in `<dynamic_tools>`: whole, except
  that the two-space indent of its seven continuation lines arrived as one space.
- Cursor lists the server's tool names up front; a tool's own description arrives only when the model looks that tool
  up. The model did so before calling a tool, in every session where it called one.

## What was not measured

VS Code's hosted models and its online path; Cursor's editor and its paid plans; any Cursor model but `Auto`; what the
model did with the text after it arrived. On Cursor, the last step (the stored prompt becoming the model call) is not
visible from the machine.

## Raw transcripts

The raw transcripts are not published because they carry the author's own skills and machine paths. The one prompt that
is published is the sanitized one at
[`results/2026-09-30/cursor-prompt-2026-09-23-session-1.sanitized.txt`](../hooks-by-host/results/2026-09-30/cursor-prompt-2026-09-23-session-1.sanitized.txt).
