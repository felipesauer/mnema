# @mnema/sdk

[![CI](https://img.shields.io/github/actions/workflow/status/felipesauer/mnema/ci.yml?branch=main&style=flat-square&label=CI&color=997dbf)](https://github.com/felipesauer/mnema/actions/workflows/ci.yml) [![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-997dbf?style=flat-square)](../../LICENSE) ![Node 22.22.2 or a later 22, or 24.15.0 or later](https://img.shields.io/badge/node-%5E22.22.2%20%7C%7C%20%3E%3D24.15.0-997dbf?style=flat-square) ![Not published: run from a checkout](https://img.shields.io/badge/npm-not%20published-997dbf?style=flat-square)

A library door to the [mnema](https://github.com/felipesauer/mnema) record, for a program that
builds its own agent (the Claude Agent SDK, LangGraph and the like) and does not run inside a host
that speaks MCP. It reads and writes the same record the command line and the MCP server do, by
calling the same functions the command line calls.

It is not published (`private: true`). It is used from a checkout of this repository, after
`pnpm build`, and it depends on the `@mnema/code` that sits beside it.

## What it gives you

`openRecord({ cwd, agent })` opens the record of the project `cwd` is in. `agent` is the name every
write is attributed to, the way `--which` is on the command line. Each method is one verb:

| Method | The verb it is |
|---|---|
| `recordDecision({ title, rationale, alternatives?, scope? })` | `decision record` |
| `acceptDecision({ id, note })`, `rejectDecision({ id, note })` | `decision move`, with `accept` and `reject` |
| `addNote({ content, scope? })` | `memory` |
| `brief()` | `mnema brief`: the document, as a string |
| `recall()` | `mnema recall`: the notes a session would be handed |
| `rulesFor(path)` | `mnema rules <path>`: which recorded rules govern the path |
| `verify({ require?, global? })` | `mnema verify`: the verdict, against the least you accept |

A refusal comes back as a value with the code the command line prints (`ok: false`, and a
`reason`, with a `code` and a `message` when the gate refused); nothing is thrown for one.

`mnemaHooks({ cwd, agent? })` returns what `query()` takes as `options.hooks`, for two events:

- **`SessionStart`** hands the session the document `mnema brief --hook` prints, as
  `additionalContext`. Where there is no project, the channel is switched off or the record does
  not read, it answers `{}`.
- **`PreToolUse`**, on `Write`, `Edit` and `NotebookEdit`, asks what the `before-a-write` verb asks:
  `deny` citing the rule where a rule of the record refuses a write at the path, `ask` where one
  asks for a person, `{}` otherwise. Each refusal or asking is recorded as a fact before the answer
  is given.

The shape of the callbacks and of what they return is the Agent SDK's
([hooks](https://code.claude.com/docs/en/agent-sdk/hooks)); this package has no dependency on it.

## How it is built

There is no rule in this package. Each method calls the function its verb's command calls, with
what that command's wiring passes it, and the three doors are held to one another by a test: the
same input through the command line, the MCP server and this package leaves the same events in the
record (the same kinds and payloads, apart from the time, the signature, the run an MCP connection
pins and the ids) and gets the same verdict, with the same code on a refusal. A method, an MCP
tool or a verb that writes, and is on one door and not the others without a reason written down,
turns that test red.

## What it proves — and what it does not

- It proves what the command line proves and nothing more: what it writes is signed with the key of
  the machine that runs it, and `verify` is `mnema verify`'s verdict. It does not add a verifier and
  does not widen what `verify` says.
- It does not decide anything: whether a decision may be accepted, whether a note is accepted, and
  whether a write is refused are the gate's and the record's. An `agent` is only a name on the
  facts; it is not proof of who runs the program, and `agent-accepts` can be switched off for it
  like for any agent.
- It is not the whole command line. It has no method for tasks, patterns, links, retractions,
  handoffs, switches or keys: those stay with the command line and the MCP server.
- The `PreToolUse` hook is the gate alone. It does not hand the rules that only govern a path
  beside the write, which the plugin's Claude Code door does, and it does not run for a write the
  agent makes through a tool other than `Write`, `Edit` or `NotebookEdit` (a `Bash` redirection, a
  patch tool of your own). A rule that asks for a person holds a write only where the program
  answers the Agent SDK's permission flow for `ask`.
- The hooks never block the session for a failure of their own: a project that is not there, a
  channel that is switched off and a record that cannot take the fact are all `{}`. A write that
  was meant to be refused and whose refusal could not be recorded is not refused.
- It reads the record at and above `cwd` and, as the command line does, the private and the global
  tree of the machine's `HOME`. It never calls a model and never touches the network.
- The surface is not stable: it is private, and a change to it needs no notice.

## License

Apache-2.0. See the [LICENSE](../../LICENSE) and [NOTICE](./NOTICE).
