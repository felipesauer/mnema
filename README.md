<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/banner-dark.svg">
  <img src="docs/assets/banner-light.svg" alt="mnema, a chain of signed blocks" width="640">
</picture>

<h3>Your decisions, handed to your agents' sessions and held at the edits they govern — append-only and signed in the repository, and checkable by anyone.</h3>

<p>
<a href="https://github.com/felipesauer/mnema/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/felipesauer/mnema/ci.yml?branch=main&amp;style=flat-square&amp;label=CI&amp;color=997dbf"></a>
<a href="https://github.com/felipesauer/mnema/releases"><img alt="Release" src="https://img.shields.io/github/v/release/felipesauer/mnema?include_prereleases&amp;style=flat-square&amp;label=release&amp;color=997dbf"></a>
<a href="LICENSE"><img alt="License: Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-997dbf?style=flat-square"></a>
<img alt="Node 24.15.0 or a later 24, or 26.0.0 or later" src="https://img.shields.io/badge/node-%5E24.15.0%20%7C%7C%20%E2%89%A526.0.0-997dbf?style=flat-square">
</p>

<p>
mnema keeps the calls behind your agents' work as signed, append-only facts in the repository. A
session opens with the ones in force, a rule can refuse or pause the write it governs, and
<code>mnema verify</code> checks the record with no key and no network.
</p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/how-mnema-fits-dark.svg">
  <img src="docs/assets/how-mnema-fits-light.svg" alt="How mnema fits: an agent session opens with the decision in force; a write under the path a rule refuses is denied; a write elsewhere lands; a decision the agent records is signed into the chain in the repository; mnema verify checks the chain" width="100%">
</picture>

</div>

<table>
<tr>
<th align="center">Remember</th>
<th align="center">Enforce</th>
<th align="center">Prove</th>
</tr>
<tr>
<td align="center" width="33%">With the plugin, each agent session opens with the decisions in force, by name and id.</td>
<td align="center" width="33%">A rule addressed at a path can refuse an agent's write there, or hold it for a person where the host allows.</td>
<td align="center" width="33%">Every write is signed and hash-chained; anyone can verify it, even in a browser.</td>
</tr>
</table>

<p align="center">
<sub>Claude Code · VS Code · Cursor CLI · GitHub Action · SDK · <code>mnema site</code>. The Action, the SDK and the VS Code extension run from a checkout; nothing is on npm yet.</sub>
</p>

<p align="center">
Tamper-evident, not tamper-proof: what is still in the record has not changed
since it was signed, and a stranger can check that without your keys and without
installing this.
</p>

<p align="center">
<a href="#quick-start">Quick start</a> · <a href="#how-it-works">How it works</a> · <a href="#features">Features</a> · <a href="#watch-it">Watch it</a> · <a href="#what-it-proves--and-what-it-does-not">What it proves</a> · <a href="#docs">Docs</a>
</p>

## Quick start

```sh
# install: npm i -g the four release tarballs; the exact line is in docs/install.md
claude plugin marketplace add felipesauer/mnema   # the plugin hands each session the record
claude plugin install mnema@mnema
cd your-repository && mnema init
mnema decision record "Keep money as integer cents" "Float sums drift; cents are exact."
mnema verify
```

The whole install, the other hosts and the first record, line by line, are in
[`docs/install.md`](docs/install.md) and [`docs/first-record.md`](docs/first-record.md).

## How it works

<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/how-it-works-dark.svg">
  <img src="docs/assets/how-it-works-light.svg" alt="Record, rule, hand over, verify — over a signed, append-only record committed with the code" width="880">
</picture>

</div>

1. **Record.** An agent over MCP, or you at the command line, writes a decision with its reasoning and the options turned down.
2. **Rule.** A person accepts it, and `mnema link` addresses it at a path. The rule can govern that path, ask for a person there, or refuse a write.
3. **Hand over.** With the plugin, each session opens with what is in force, and each edit meets the rules for its file.
4. **Verify.** Every fact is signed and hash-chained. `mnema verify`, a second reader in Python, or the page `mnema site` writes checks it.

More in [`docs/how-it-works.md`](docs/how-it-works.md); what each host does and does not reach is in
[`docs/agent-hosts.md`](docs/agent-hosts.md).

## Hosts

What each agent host does with mnema, one rung at a time: (a) the MCP server and rules in a file,
(b) the opening of a session, (c) a refusal before a write, (d) a pause for a person.

<!-- The rung table below is generated from packages/code/src/host-names.ts: edit the table there. -->

| Host | (a) The MCP server | (a) Rules in a file | (b) The opening of a session | (c) A refusal before a write | (d) A pause for a person | Rung |
| --- | --- | --- | --- | --- | --- | --- |
| Claude Code | yes, [held by a test](packages/code/tests/host-contract/the-rules-arrive-beside-the-write.test.ts) | yes, [held by a test](packages/code/tests/a-rules-file-carries-only-what-becomes-a-glob-exactly.test.ts) | yes, [held by a test](packages/code/tests/host-contract/the-session-opens-with-the-record.test.ts) | yes, [held by a test](packages/code/tests/host-contract/a-refusal-and-a-pause-hold-the-write.test.ts) | yes, [held by a test](packages/code/tests/host-contract/a-refusal-and-a-pause-hold-the-write.test.ts) | (d) |
| VS Code's agent | yes, read on VS Code 1.137 with Copilot Chat 0.65, 23 September 2026 | yes, [held by a test](packages/code/tests/a-rules-file-carries-only-what-becomes-a-glob-exactly.test.ts) | yes, read on VS Code 1.137 with Copilot Chat 0.65, 23 September 2026 | yes, [held by a test](packages/code/tests/host-contract/an-editor-holds-or-refuses-the-write.vscode.test.ts) | yes, [held by a test](packages/code/tests/host-contract/an-editor-holds-or-refuses-the-write.vscode.test.ts) | (d) |
| Cursor's command-line agent | yes, read on Cursor agent 2026.09.18, 23 September 2026 | yes, [held by a test](packages/code/tests/a-rules-file-carries-only-what-becomes-a-glob-exactly.test.ts) | yes, read on Cursor agent 2026.09.18, 23 September 2026 | yes, read on Cursor agent 2026.09.18, 2 October 2026 | no, read on Cursor agent 2026.09.18, 30 September 2026 | (c) |
| Codex | yes, [held by a test](packages/code/tests/host-contract/codex-opens-and-refuses.codex.test.ts) | documented, not measured ([read 8 October 2026](https://github.com/openai/codex/blob/979011409de0a60b52f179721948e65531d26144/codex-rs/core/src/agents_md.rs)) | yes, [held by a test](packages/code/tests/host-contract/codex-opens-and-refuses.codex.test.ts) | yes, [held by a test](packages/code/tests/host-contract/codex-opens-and-refuses.codex.test.ts) | no, [held by a test](packages/code/tests/host-contract/codex-opens-and-refuses.codex.test.ts) | (c), with (a) documented, not measured |
| GitHub Copilot CLI | yes, [held by a test](packages/code/tests/host-contract/copilot-opens-and-refuses.copilot.test.ts) | documented, not measured ([read 9 October 2026](https://github.com/github/docs/blob/9f651797567230e844373870fce8b14427ad47ad/content/copilot/reference/copilot-cli-reference/cli-command-reference.md)) | yes, [held by a test](packages/code/tests/host-contract/copilot-opens-and-refuses.copilot.test.ts) | yes, [held by a test](packages/code/tests/host-contract/copilot-opens-and-refuses.copilot.test.ts) | yes, [held by a test](packages/code/tests/host-contract/copilot-opens-and-refuses.copilot.test.ts) | (d), with (a) documented, not measured |
| Cursor's editor | documented, not measured ([read 10 October 2026](https://cursor.com/docs/context/mcp)) | documented, not measured ([read 10 October 2026](https://cursor.com/docs/context/rules)) | not ported | not ported | not ported | (a), documented, not measured |
| Factory Droid | documented, not measured ([read 8 October 2026](https://github.com/Factory-AI/factory/blob/c6ea470/docs/cli/configuration/mcp.mdx)) | documented, not measured ([read 8 October 2026](https://github.com/Factory-AI/factory/blob/c6ea470/docs/cli/configuration/agents-md.mdx)) | not ported | not ported | not ported | (a), documented, not measured |
| Qwen Code | documented, not measured ([read 8 October 2026](https://github.com/QwenLM/qwen-code/blob/cbbb0a5/docs/users/features/mcp.md)) | documented, not measured ([read 8 October 2026](https://github.com/QwenLM/qwen-code/blob/cbbb0a5/docs/users/features/memory.md)) | not ported | not ported | not ported | (a), documented, not measured |
| Goose | documented, not measured ([read 8 October 2026](https://github.com/aaif-goose/goose/blob/a4189ec/README.md)) | documented, not measured ([read 8 October 2026](https://github.com/aaif-goose/goose/blob/a4189ec/crates/goose/src/hints/load_hints.rs)) | not ported | not ported | not ported | (a), documented, not measured |
| Continue's command line (`cn`) | documented, not measured ([read 8 October 2026](https://github.com/continuedev/continue/blob/5522c6f/extensions/cli/src/services/MCPService.ts)) | documented, not measured ([read 8 October 2026](https://github.com/continuedev/continue/blob/5522c6f/core/config/markdown/loadMarkdownRules.ts)) | not ported | not ported | not ported | (a), documented, not measured |
| Warp's agent | documented, not measured ([read 8 October 2026](https://github.com/warpdotdev/warp/blob/325d4d4/app/src/ai/agent_sdk/driver/mcp_startup.rs)) | documented, not measured ([read 8 October 2026](https://github.com/warpdotdev/warp/blob/325d4d4/app/src/ai/agent_tips.rs)) | not ported | not ported | not ported | (a), documented, not measured |

**Claude Code.** When a subagent stops: yes, [held by a test](packages/code/tests/host-contract/a-subagent-is-sent-back-for-its-handback.test.ts).

**Codex.** The refusal fails open, as on every host: a gate that cannot answer — no `mnema` on the PATH (held by its test), an error, or a hook past its 15 seconds (read in [`pre_tool_use.rs`](https://github.com/openai/codex/blob/979011409de0a60b52f179721948e65531d26144/codex-rs/hooks/src/events/pre_tool_use.rs#L205-L288)) — lets the patch through. The opening is cut to Codex’s own ceiling, 2,500 tokens of 4 UTF-8 bytes ([`output_spill.rs`](https://github.com/openai/codex/blob/979011409de0a60b52f179721948e65531d26144/codex-rs/hooks/src/output_spill.rs#L12)), at a whole rule, held by the same test. When a subagent stops: documented, not measured ([read 9 October 2026](https://github.com/openai/codex/blob/979011409de0a60b52f179721948e65531d26144/codex-rs/hooks/src/events/stop.rs#L178-L206)).

**GitHub Copilot CLI.** Its hooks are read under the PascalCase event names, which hand the payload in Claude Code’s tool names (`Write`, `Edit`) and snake_case fields, with the path under `path`. A command hook that exits non-zero denies the call there (read in [the hooks reference](https://github.com/github/docs/blob/9f651797567230e844373870fce8b14427ad47ad/content/copilot/reference/hooks-reference.md)), so the plugin's ends in `exit 0` whatever happened — no `mnema` on the PATH is held by its test; a hook past its 15 seconds is let through by the host (read, not measured). The opening is the same text Claude Code gets, cut at 10,000 units, far under the 10 MiB the host accumulates (read, not measured). Run without a person (`copilot -p`), a hook’s `ask` is a denial (held by its test); with one, the host asks (held by its test). The model is any the host is pointed at, with no GitHub account (`COPILOT_OFFLINE`), under the license at [`LICENSE.md`](https://github.com/github/copilot-cli/blob/a7ae5b0ce17beddfa5930812bb064138fd3a1cb5/LICENSE.md). When a subagent stops: documented, not measured ([read 9 October 2026](https://github.com/github/docs/blob/9f651797567230e844373870fce8b14427ad47ad/content/copilot/reference/hooks-reference.md#subagentstop--subagentstop)).

**Cursor's editor.** Only its documentation was read, on 10 October 2026: the agent of the editor runs `preToolUse` and `sessionStart` hooks, a `preToolUse` that answers `deny` blocks the action, `ask` is accepted there and not enforced, and a `sessionStart` hook can add context to the session. That documentation says the hooks in Claude Code’s settings files are loaded, and says nothing of the hooks of a plugin installed in Claude Code, which the command-line agent was read to load. Whether the editor runs this plugin’s hook, sets `CURSOR_VERSION` for it and hands it the payload the command-line agent does was not read, so nothing above the first rung is promised for it. The script that reads it is `plugin/captures/cursor-ide-script.md`.

Each cell says how it is known: **held by a test** of this repository; **read** once against the
real host, on the version and the day it names, and held by no file yet; or **documented, not
measured**: the host's own documentation or code says the host does it, at the commit or on the
page the link names, and nothing was run. **Not ported**: the plugin hands that host nothing for
it. For the first three hosts, the rules file is the one `mnema rules-file --host` prints in the
host's format, and the test holds what it prints, not how the host matches its globs; for the
others, it is `AGENTS.md`, which the host's documentation says it reads. A host reaches a rung
when every rung before it is a yes; Aider was read too, and is not here, because it has no MCP
client.

<!-- End of the generated rung table. -->

## Features

| Feature | What it does |
|---|---|
| **Opens every session** | With the plugin, the decisions in force, the adopted patterns and the notes near the work. [Agent hosts](docs/agent-hosts.md) |
| **Rules at each edit** | In Claude Code, the rules for a file land beside the write. [Agent hosts](docs/agent-hosts.md) |
| **Refuses a write** | `refuses-a-write` stops an agent's write there, in Claude Code, VS Code and Cursor CLI. [Features](docs/features.md) |
| **Asks for a person** | `asks-for-a-person` holds the write until someone decides, in Claude Code and VS Code. [Features](docs/features.md) |
| **Supersede, never edit** | A change of mind is a new decision. The old one leaves the opening and stays in the record. [How it works](docs/how-it-works.md) |
| **Take a note back** | `mnema retract` appends a signed retraction, and nothing is erased. [Features](docs/features.md) |
| **Every write signed** | The command line and the MCP server sign each write before they return. [How it works](docs/how-it-works.md) |
| **`mnema verify`** | No key, no network. It names the level it reached, not yes or no. [What it proves](docs/what-it-proves.md) |
| **A second reader** | A dependency-free Python verifier, written from the format's spec alone. [Verify without installing](docs/verify-without-installing.md) |
| **A page that verifies itself** | `mnema site` writes one HTML file, and the reader's browser checks it. [The page](docs/site.md) |
| **A pull-request check** | The Action comments what a PR does to the record and fails when it is not signed. [Packages](docs/packages.md) |
| **The git log, read against it** | `trailer`, `commits`, `why` and `aging` tie commits to decisions. [Features](docs/features.md) |

## Watch it

<table>
<tr>
<td width="50%" valign="top"><img src="recordings/first-record.gif" alt="mnema init, a decision recorded and accepted, the decisions the next session is handed, and verify"><br><sub>The first record: the command line in an empty repository, from <code>init</code> to <code>verify</code>. Recorded from the built binary by <a href="recordings/first-record.sh"><code>recordings/first-record.sh</code></a>.</sub></td>
<td width="50%" valign="top"><img src="recordings/console.gif" alt="mnema at a shell, the first door, and the console answering reads"><br><sub>At a terminal, <code>mnema</code> alone asks what you want to do here, and its first door opens the console: a session that reads the record and refuses to write. It needs a window at least 80 columns wide and 42 rows tall. Driven through a pseudo-terminal by <a href="recordings/console.json"><code>recordings/console.json</code></a>.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><img src="recordings/a-write-refused.gif" alt="An agent's write refused by a rule addressed at its path"><br><sub>A write refused: the rule addressed at the path stops an agent's edit there. Recorded from the built binary by <a href="recordings/a-write-refused.sh"><code>recordings/a-write-refused.sh</code></a>.</sub></td>
<td width="50%" valign="top"><img src="recordings/a-decision-superseded.gif" alt="A decision superseded: it leaves what the next session is handed, and stays in the record"><br><sub>A decision superseded: a later call takes its place, the old one leaves what the next session is handed and stays in the record. Recorded from the built binary by <a href="recordings/a-decision-superseded.sh"><code>recordings/a-decision-superseded.sh</code></a>.</sub></td>
</tr>
</table>

A case in the suite runs the scripts again against the built binary and fails when a recording no longer
shows what the binary draws, so none of them can go on showing an older product in silence
([`the-recordings-are-what-the-binary-draws.test.ts`](packages/code/tests/the-recordings-are-what-the-binary-draws.test.ts)).

## What it proves — and what it does not

`mnema verify` reads the events and the committed public keys of a project's trees — no private
key, no network — and prints each verdict verbatim, naming the level it reached.

- **What holds.** A changed or reordered event breaks the hash chain, and an edit made without the signing key fails the signed checkpoints.
- **What does not hold.** Nothing proves that nothing was removed: a hash chain shows what changed, never what is gone, and the history a git remote keeps is what covers omission. A record forged whole under a fresh key verifies clean, and a key is not proven to be the person a name says. A refusal of a write covers the editing tools of Claude Code, the VS Code agent (Copilot) and Cursor, and not their shell: `sed -i` on a protected file goes round it.
- **What a green `verify` means.** That nothing *verifiable* is broken, not that the record is honest, and the gate protects the shape of a change, not who may make it.

The whole table, claim by claim, is in [`docs/what-it-proves.md`](docs/what-it-proves.md); how each
claim about the agent hosts is held, and which are not held yet, is in [`docs/evidence.md`](docs/evidence.md).

## Docs

[Install](docs/install.md) · [Your first record](docs/first-record.md) · [How it works](docs/how-it-works.md) ·
[Agent hosts](docs/agent-hosts.md) · [Features](docs/features.md) · [What it proves](docs/what-it-proves.md) ·
[Verify without installing](docs/verify-without-installing.md) · [The page that verifies itself](docs/site.md) ·
[How each claim is held](docs/evidence.md) · [Where it fits](docs/where-it-fits.md) · [Packages](docs/packages.md) ·
[Build from source](docs/build-from-source.md) · [Contributing](CONTRIBUTING.md)

## License

Apache-2.0. See [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).
