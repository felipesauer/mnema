<h1 align="center">@mnema/code</h1>

<p align="center">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/felipesauer/mnema/main/docs/assets/the-family-dark.svg">
  <img src="https://raw.githubusercontent.com/felipesauer/mnema/main/docs/assets/the-family-light.svg" alt="The mnema family: @mnema/code, the command line and the MCP server over one record, with the SDK, a VS Code extension, an agent in CI, the GitHub Action, mnema site and Stacks around it" width="880">
</picture>
</p>

<p align="center">
<a href="https://github.com/felipesauer/mnema/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/felipesauer/mnema/ci.yml?branch=main&amp;style=flat-square&amp;label=CI&amp;color=997dbf"></a>
<a href="https://www.npmjs.com/package/@mnema/code"><img alt="npm: @mnema/code" src="https://img.shields.io/npm/v/@mnema/code?style=flat-square&amp;label=npm&amp;color=997dbf"></a>
<a href="https://github.com/felipesauer/mnema/blob/main/LICENSE"><img alt="License: Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-997dbf?style=flat-square"></a>
<img alt="Node 24.15.0 or a later 24, or 26.0.0 or later" src="https://img.shields.io/badge/node-%5E24.15.0%20%7C%7C%20%3E%3D26.0.0-997dbf?style=flat-square">
</p>

Your decisions, handed to your agents' sessions and held at the edits they
govern: append-only and signed in the repository, and checkable by anyone.

Tamper-evident, not tamper-proof: what is still in the record has not changed
since it was signed, and a stranger can check that without your keys and
without installing this.

This is the package you install: the `mnema` command line and the MCP server of
[mnema](https://github.com/felipesauer/mnema), two surfaces over one record. The agent writes
through MCP while it works, and the plugin in [`plugin/`](https://github.com/felipesauer/mnema/tree/main/plugin) hands the record to a
session as it opens; you read, audit and verify from the terminal. It holds no domain logic of
its own: the workflow rules and the proof live in `@mnema/core` and `@mnema/chain`.

## What it gives you

- **A record of decisions in the repository** that agents and people write to, each fact signed
  and appended, in a committed tree the team shares, a private one for this machine and a global
  one.
- **A command line** to record, read, move work through its gates and verify, and **an MCP server**
  over stdio for the agent to do the same: both ask the same gate. At a terminal,
  `mnema decision review` goes through the decisions awaiting a judgement one by one (accept, reject, skip or quit),
  with no id to copy, and signs each verdict with your own key.
- **`mnema init`**, which founds the record and leaves in `.mnema/` a `README.md` that says what the
  folder is and an `.editorconfig` that unsets what an outer one could impose on its bytes; where the
  repository has a `.prettierignore` or declares prettier, it adds the line `.mnema/` to it and
  says so. It writes the mnema instructions (when to call the mnema tools, and what never goes in the
  record) into `AGENTS.md`, into a `CLAUDE.md` or `GEMINI.md` that exists, and into a rule file of its
  own for Claude Code, Copilot and Cursor, and names each file. Run again in a project founded before,
  it adds only what that project lacks beside the record; `mnema instructions`, with `--check` or `--remove`,
  writes, checks or removes the instructions.
  `mnema doctor` points at a missing README, `.prettierignore` line or instructions block, names a pre-commit hook,
  Biome, dprint or lint-staged configuration that would rewrite the record, and edits none of
  those files.
- **Tasks that carry their words.** The `--description` of `task create` and the `--brief` of `task handoff` (and the
  same two arguments of the `create_task` and `record_handoff` tools) record up to 64 KiB of text beside the task,
  as a note about it; `mnema show <task>` serves the description, the last handoff with its brief and the notes,
  and the opening read says who has each task in flight and what happened last. A handoff that names no tree
  is recorded where its task lives. The format does not change.
- **`mnema verify`**, which reads the record with no key and no network and prints the level it
  reached. A record a formatter rewrote is refused, and one line beside the refusal names the
  files, when reading them back in canonical form proves that is all that happened. An agent key
  one tree of the project retired is retired in the others it reads: what the key signed there
  after the retirement is refused, and not counted as attested.
- **A brief and a plugin** that hand the decisions in force to an agent's session, and the rules
  addressed at a file beside a write to it (in Claude Code, Codex, Copilot CLI, Gemini CLI, Qwen Code and OpenCode). In Claude Code the plugin also hands the brief to a
  subagent as it starts, and, after a question the agent asked the person is answered, names the
  tool that records the choice. After a write there, a note of Claude Code's own memory for this
  project is copied into this machine's private tree, once per content (never the index
  `MEMORY.md`, never a note about the person, never the public tree; on until
  `mnema switch off host-memory-mirror`), and a file that holds decisions the record cites nowhere gets one line
  naming the command that imports it, which records nothing. When the
  `mnema` on the `PATH` is older than the plugin, the opening of the session says so and gives the
  command that fixes it; `mnema doctor` says it in either direction.
- **A record inherited from another repository** (`mnema inherit set`), pinned at one commit and read
  only when it verifies there: its rules in force reach the paths they address, in `mnema rules`,
  `mnema why`, `governing_rules` and the gate before a write, each naming its origin and commit.
- **`mnema usage --tools`**, which counts how many times each MCP tool was called, from a file this
  machine keeps in its home and never in the repository; `mnema switch off tool-call-count`
  stops it.
- **A session journal**, which the `Stop` hook keeps on this machine, outside the record: ids and counts of what a
  session did with it (never its words), so the next `Stop` reads only what the host wrote since and the run the MCP
  server closes ends with an outcome that the `resume` and `status` readings print, and the notes the next session
  opens with say where this one stopped; a conversation that was compacted is handed back what entered the record while its session
  ran. `mnema switch off session-journal`, `last-session` and `after-a-compaction` stop them.
- **A task for the work a session hands to other agents**, in the Claude Code plugin: the first dispatch of a session records
  one private task, each dispatch a private handoff on it (its short description and the path of a brief file, never the
  prompt), and the end of the session closes it; `mnema switch off agent-mirror` stops it.
  [Every switch](https://github.com/felipesauer/mnema/blob/main/docs/switches.md) says where it begins and what it carries.

[The reference](https://github.com/felipesauer/mnema/blob/main/docs/cli-reference.md) has every verb and tool, and what each one leaves
unproven.

## What it proves, and what it does not

The record is **tamper-evident, not tamper-proof**: it does not stop an edit, and `mnema verify`
shows when what is in the record has changed since it was signed, and a cut that leaves the last
checkpoint in place; by default it does not catch a cut off the end that takes the last checkpoint with it, or one tail deleted whole while another remains (a key left without a tail is noted, not failed). A record in which no tail holds anything any more exits 1, by name, at every `--require`; `--since <rev>` exits 1 when files the revision held are gone. It reads the events and public keys of the project's trees, with
no private key and no network, and prints each verdict verbatim.

- It does not say every event is signed: the verdict names the level it reached, and only
  `verified (T1/T2/T4)` means every event is covered.
- It does not catch someone holding the signing key who rewrites and signs again; a witness
  outside the machine (`mnema witness stamp`) dates the record, and the history a git remote keeps
  is what shows a cut.
- It does not prove nothing was deleted: a tail removed together with its key, while another
  remains, leaves nothing on disk to cross.
- It does not make the agent named on a fact the one that did the work, and it is not access
  control: anyone who can run the command line writes as this machine's identity.
- It does not count every use of a tool: `mnema usage --tools` counts only the calls this
  machine's MCP server answered, nothing of it is signed, and `verify` does not read it.

The whole table, claim by claim, is in [What it proves](https://github.com/felipesauer/mnema/blob/main/docs/what-it-proves.md), and the
long form of each row is in [the reference](https://github.com/felipesauer/mnema/blob/main/docs/cli-reference.md#what-it-proves-and-what-it-does-not).

## Install

```sh
npm i -g @mnema/code
```

Then `mnema doctor` says whether the `mnema` your shell runs is the one you meant. [Where the package came from](https://github.com/felipesauer/mnema/blob/main/docs/install.md#where-the-package-came-from) says how to check the published version against its npm provenance.

[The install page](https://github.com/felipesauer/mnema/blob/main/docs/install.md) has the steps for a Node installed by
the system. Requires Node 24.15.0 or a later 24, or 26.0.0 or later; the package is
ESM-only.

## Your first record

```sh
cd your-repository
mnema init
mnema decision record "Use SQLite for the projection cache" \
  "It is embedded, it is fast enough at our sizes, and it needs no service."
mnema verify
```

[Your first record](https://github.com/felipesauer/mnema/blob/main/docs/first-record.md) shows what each of them prints, line by line.

## Where to go next

[The reference](https://github.com/felipesauer/mnema/blob/main/docs/cli-reference.md) · [Each host](https://github.com/felipesauer/mnema/blob/main/docs/agent-hosts.md) ·
[How it works](https://github.com/felipesauer/mnema/blob/main/docs/how-it-works.md) · [The plugin](https://github.com/felipesauer/mnema/blob/main/plugin/README.md) ·
[Where it fits](https://github.com/felipesauer/mnema/blob/main/docs/where-it-fits.md) · [Evidence](https://github.com/felipesauer/mnema/blob/main/docs/evidence.md)

## License

Apache-2.0. See `LICENSE` and `NOTICE`, which this package carries.
