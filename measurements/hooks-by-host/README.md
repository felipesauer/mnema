# hooks by host

**What each host this product ships a plugin for lets a hook do before a file is written.**
Claude Code, VS Code's agent and Cursor's command-line agent all read this repository's plugin,
and all three run hooks. Whether a hook runs *before* a write, whether it can put text in front
of the model, ask a person, or refuse, whether it is a process or a call into the MCP server,
and where its text lands, were facts about one host and guesses about the other two. This is
the measurement of all three, on the versions installed on 30 Sep 2026, and it is what the
plugin's page and the pause for a person in VS Code stand on.

## 1 · No model, no account, no network — and the host is real

A hook fires on a tool call, and only a model emits one. So in each host the model — or the
server that stands for it — was replaced, and nothing else was:

- **Claude Code 2.1.281** (`/usr/bin/claude`; the second install on the same machine, 2.1.280
  under a Node version manager, was not measured): the real binary against a stand-in for the
  model API on loopback, which answers the request offering `Write` with one `tool_use`. The
  request the host sends after the hook is the evidence of what reached the model.
- **VS Code 1.137.0 with Copilot Chat 0.65.0** (built in): a disposable window, fresh profile,
  the chat enabled by its anonymous local setup, and a test extension that registers a language
  model — it answers the first request offering the tool with one tool call and records every
  request the agent sends. The request after the tool is the evidence; the host's own log says
  what it did with the reply.
- **Cursor's command-line agent 2026.09.18-9a7762b**: the installed agent pointed at a stand-in
  for Cursor's backend. The stand-in drives the agent's session stream the way the backend does:
  it asks for the request context, then tells the agent to write one file — and it is the agent,
  on this machine, that runs its hooks before that write and sends back the result. What the
  real backend then does with a hook's text is on Cursor's servers and was not measured.

Every host ran with an emptied environment, a sandbox home, and loopback as its only network.
Every hook in the cases below is one program that records what it was handed and prints a fixed
reply, so the subject of each cell is the host's reading of a reply; the end-to-end cases run
the plugin of this repository and the built binary instead.

## 2 · The table

| | Claude Code 2.1.281 | VS Code 1.137 + Copilot Chat 0.65 | Cursor CLI 2026.09.18 |
|---|---|---|---|
| **Hook events** (the host's own list) | `PreToolUse`, `PermissionRequest`, `PostToolUse`, `SessionStart`, `UserPromptSubmit`, `Stop`, and more | `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PreCompact`, `SubagentStart`, `SubagentStop`, `Stop`, `ErrorOccurred` | `preToolUse`, `postToolUse`, `postToolUseFailure`, `beforeShellExecution`, `beforeMCPExecution`, `beforeReadFile`, `afterFileEdit`, `sessionStart`, `sessionEnd`, `beforeSubmitPrompt`, `stop`, and more; a Claude Code plugin's `PreToolUse` maps to `preToolUse` |
| **Runs before a write** | `PreToolUse` on `Write` — measured | `PreToolUse` on `create_file` — measured | `preToolUse` on its `Write` — measured, from its own hook file and from a Claude Code plugin alike |
| **Hook types it runs** | `command` and `mcp_tool` — measured | `command` only: an `mcp_tool` hook is dropped without a word — measured | `command` only: an `mcp_tool` hook is not run — measured |
| **Reads the matcher** | yes — a matcher of VS Code's tool names never ran | **no** — a matcher that names no tool still ran, on every tool | yes — a matcher of VS Code's tool names never ran |
| **What a hook is handed** | `tool_name` `Write`, `tool_input.file_path` | `tool_name` `create_file` (and five other write tools), `tool_input.filePath` | `tool_name` `Write`, `tool_input.file_path` |
| **Text for the model** | `additionalContext`, **after** the tool result, in the same message — measured, both types | `additionalContext`, **inside** the tool result, as `<PreToolUse-context>` — measured | `additional_context` (or Claude's nested field), sent to the backend **with** the write result — measured on the client; where the backend puts it, not |
| **Ask a person** | **yes**: `ask` stops the write; with nobody to ask it comes back to the model as an error carrying the reason — measured, both types | **yes**: `ask` holds the write for a person (*"requires confirmation (preToolUse hook returned 'ask')"*) and the file stays unwritten — measured | **no**: `ask` is accepted by the host's schema and **ignored** — the file was written, from both routes |
| **Refuse** | `deny`: the write refused, the reason to the model as an error — measured | `deny`: *"Tool execution denied: …"*, with the hook's text beside it — measured | `deny`: the write refused, *"… Agent note: Do not suggest workarounds to the blocked tool."* — measured |
| **What one firing costs with the mnema binary** | an `mcp_tool` call on the open connection, 1.24 ms ([`channel-cost/`](../channel-cost/), 19 Aug; not measured again) | 2.7 ms on a tool that does not write — the filter, with no process started; 213 ms on a write, 229 ms on one that asks (§4) | nothing is wired: a command would pay the binary's 184 ms and whatever the agent's own shell costs, not measured |

[`results/2026-09-30/claude-code.json`](results/2026-09-30/claude-code.json),
[`results/2026-09-30/vscode.json`](results/2026-09-30/vscode.json) and
[`results/2026-09-30/cursor-cli.json`](results/2026-09-30/cursor-cli.json) hold every case, with
the host's own words where it had any; sandbox paths are written `<sandbox>`, and of the
environment a hook saw only the names are kept.

## 3 · What the product built on it, and what it did not

- **The pause for a person reaches VS Code.** The plugin's second `PreToolUse` hook is a
  command under a matcher of VS Code's tool names: Claude Code and Cursor apply the matcher and
  never run it (measured with the real plugin in both: `before-a-write` called 0 times, and in
  Claude Code the `mcp_tool` gate asked as before, with one fact of each kind). VS Code runs it on
  every tool — a filter in the shell hands the payload on only for the six tools that write — and
  it runs `mnema before-a-write --host vscode`. Measured end to end: a write under a path a rule
  asks about waited for a person and the record gained one `channel.asked` and one
  `channel.served`; a write elsewhere went through with nothing recorded; a read never started
  the binary.
- **Not in Cursor's command-line agent.** It ignores `ask`, so there is nothing to answer it
  with, and recording that a person was asked when the file was written would be the fact
  reading backwards. Its `deny` works; refusing outright is a grade this product has not
  decided the meaning of, and it is not built.
- **The rules at each edit stay Claude Code's.** VS Code would carry a hook's text, inside the
  tool result; the product records that the push served once per session, and a process started
  per write has no session to remember it by.
- **A rule file is printed only where a glob is exact.** VS Code 1.137's agent does not match an
  `applyTo` itself: it lists each `.github/instructions` file and its pattern to the model and
  leaves reading it to the model — measured with five placements, the matching one included, and
  the file's text reached the model in none of them. Cursor matches `globs` on its servers.
  Neither is a matcher this product can check a directory's glob against, so `mnema rules-file`
  carries file addresses only.

## 4 · What a firing costs

[`results/2026-09-30/cost.json`](results/2026-09-30/cost.json): each arm spawned the way a host
spawns a command hook — `/bin/sh -c "<command>"` in a sandbox project, the host's payload on
stdin — timed from spawn to exit, twenty rounds with the order rotated every round. Load 0.85
on 16 cores; the two identical `node -e ''` controls came out at 18.4 and 18.6 ms, which is the
file's own test that the machine did not drift under one arm.

| arm | p50 | p90 |
|---|---|---|
| the shell alone (`true`) | 1.8 ms | 1.9 ms |
| an empty node | 18.4 ms | 19.3 ms |
| `mnema --version` — the floor of the command line | 155.1 ms | 161.8 ms |
| **the plugin's command, on a read** — what VS Code pays on every tool that does not write | **2.7 ms** | 2.9 ms |
| **the plugin's command, on a write no rule asks about** | **213.0 ms** | 217.9 ms |
| **the plugin's command, on a write a rule asks about** — it records two facts | **229.2 ms** | 234.5 ms |
| `mnema before-a-write` alone, on the quiet write | 183.6 ms | 186.2 ms |
| `mnema before-a-write` alone, on the asking write | 200.5 ms | 210.9 ms |

The host's own log agrees in shape: VS Code reported 13 ms for the command on a read, and 326
to 388 ms on a write, measured under the load of two other test suites on the same machine.

**The floor of the command line does not decide whether this is usable, so it was not
touched.** VS Code runs the command on every tool call, and the filter keeps a call that does
not write at under 3 ms. A write pays about a fifth of a second — the median session this
product has counted edits 34 files — against model turns measured in seconds. The floor carries
a debt of its own, attributed and not paid (`string-width` is 25 ms of it); paying it would take
about an eighth off each write, and nothing here depends on it.

## 5 · What expires, and what was not measured

Every cell is a fact about the version named at its column's head and expires with it — a
host that starts reading the matcher, honouring `ask`, or matching `applyTo` itself changes a
row. Not measured: what a person sees in VS Code's confirmation, and what happens after they
allow or refuse; `ask` in Cursor's agent run interactively rather than with `-p` (the code that
runs a `preToolUse` hook before a tool handles `deny` and has no branch for `ask`, which is a
reading, not a measurement); Cursor's editor; where Cursor's real backend places a hook's text;
Windows, where the filter in front of VS Code's command is a POSIX shell construct; VS Code's
own `.github/hooks` file format, which this product does not use.
