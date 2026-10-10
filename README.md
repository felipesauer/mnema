<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/banner-dark.svg">
  <img src="docs/assets/banner-light.svg" alt="mnema: a signed, append-only record of the decisions behind AI coding agents' work" width="640">
</picture>

<h3>Your decisions, handed to your agents' sessions and held at the edits they govern — append-only and signed in the repository, and checkable by anyone.</h3>

<p>
<a href="https://github.com/felipesauer/mnema/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/felipesauer/mnema/ci.yml?branch=main&amp;style=flat-square&amp;label=CI&amp;color=997dbf"></a>
<a href="https://github.com/felipesauer/mnema/releases"><img alt="Release" src="https://img.shields.io/github/v/release/felipesauer/mnema?include_prereleases&amp;style=flat-square&amp;label=release&amp;color=997dbf"></a>
<a href="LICENSE"><img alt="License: Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-997dbf?style=flat-square"></a>
<img alt="Node 24.15.0 or a later 24, or 26.0.0 or later" src="https://img.shields.io/badge/node-%5E24.15.0%20%7C%7C%20%E2%89%A526.0.0-997dbf?style=flat-square">
</p>

<p>
mnema is a command line and an MCP server that keep the calls behind your AI coding agents' work —
decisions, the rules they become, and notes — as signed, append-only facts in the repository. A
session in Claude Code, Codex, GitHub Copilot CLI, Gemini CLI, OpenCode, VS Code or Cursor opens with
the ones in force, a rule can refuse or pause the write it governs where the host allows, and
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
<sub>Claude Code · Codex · Copilot CLI · Gemini CLI · OpenCode · VS Code · Cursor · any MCP client · GitHub Action · SDK · <code>mnema site</code>. The Action, the SDK and the VS Code extension run from a checkout; nothing is on npm yet.</sub>
</p>

<p align="center">
Tamper-evident, not tamper-proof: what is still in the record has not changed
since it was signed, and a stranger can check that without your keys and without
installing this.
</p>

<p align="center">
<a href="#quick-start">Quick start</a> · <a href="#how-it-works">How it works</a> · <a href="#hosts">Hosts</a> · <a href="#features">Features</a> · <a href="#watch-it">Watch it</a> · <a href="#what-it-proves--and-what-it-does-not">What it proves</a> · <a href="#docs">Docs</a>
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

More in [`docs/how-it-works.md`](docs/how-it-works.md); what a session is handed, word for word, is in
[`docs/agent-hosts.md`](docs/agent-hosts.md), and how far each host goes is under [Hosts](#hosts).

## Hosts

mnema works with any agent host that has an MCP client, and how much more a host gets depends on
what its hooks allow, one rung at a time: (a) the MCP server and rules in a file, (b) the opening
of a session, (c) a refusal before a write, (d) a pause for a person.

<!-- The host summary below is generated from packages/code/src/host-names.ts: edit the table there. -->

| | Host | Rung | What it gets | Install |
| :---: | :--- | :---: | :--- | :--- |
| <picture><source media="(prefers-color-scheme: dark)" srcset="https://cdn.jsdelivr.net/npm/@lobehub/icons-static-png@1.97.1/dark/claudecode-color.png"><img src="https://cdn.jsdelivr.net/npm/@lobehub/icons-static-png@1.97.1/light/claudecode-color.png" width="24" height="24" alt="Claude Code"></picture> | **Claude Code**<br><sub>Anthropic · terminal and editors</sub> | **(d)** | MCP server · rules file · opening · refusal · pause | [Plugin](docs/install.md#claude-code) |
| <img src="https://cdn.jsdelivr.net/gh/devicons/devicon@v2.17.0/icons/vscode/vscode-original.svg" width="24" height="24" alt="VS Code"> | **VS Code**<br><sub>Microsoft · the agent of the editor</sub> | **(d)** | MCP server · rules file · opening · refusal · pause | [Plugin](docs/install.md#vs-code-and-cursor) |
| <picture><source media="(prefers-color-scheme: dark)" srcset="https://cdn.jsdelivr.net/npm/@lobehub/icons-static-png@1.97.1/dark/cursor.png"><img src="https://cdn.jsdelivr.net/npm/@lobehub/icons-static-png@1.97.1/light/cursor.png" width="24" height="24" alt="Cursor CLI"></picture> | **Cursor CLI**<br><sub>Cursor · command line</sub> | **(c)** | MCP server · rules file · opening · refusal | [Plugin](docs/install.md#vs-code-and-cursor) |
| <picture><source media="(prefers-color-scheme: dark)" srcset="https://cdn.jsdelivr.net/npm/@lobehub/icons-static-png@1.97.1/dark/codex-color.png"><img src="https://cdn.jsdelivr.net/npm/@lobehub/icons-static-png@1.97.1/light/codex-color.png" width="24" height="24" alt="Codex"></picture> | **Codex**<br><sub>OpenAI · command line</sub> | **(c)** | MCP server · opening · refusal<br><sub>rules file: documented, not measured</sub> | [Plugin](docs/install.md#codex) |
| <picture><source media="(prefers-color-scheme: dark)" srcset="https://cdn.jsdelivr.net/npm/@lobehub/icons-static-png@1.97.1/dark/githubcopilot.png"><img src="https://cdn.jsdelivr.net/npm/@lobehub/icons-static-png@1.97.1/light/githubcopilot.png" width="24" height="24" alt="Copilot CLI"></picture> | **Copilot CLI**<br><sub>GitHub · command line</sub> | **(d)** | MCP server · opening · refusal · pause<br><sub>rules file: documented, not measured</sub> | [Plugin](docs/install.md#github-copilot-cli) |
| <picture><source media="(prefers-color-scheme: dark)" srcset="https://cdn.jsdelivr.net/npm/@lobehub/icons-static-png@1.97.1/dark/opencode.png"><img src="https://cdn.jsdelivr.net/npm/@lobehub/icons-static-png@1.97.1/light/opencode.png" width="24" height="24" alt="OpenCode"></picture> | **OpenCode**<br><sub>Anomaly · command line</sub> | **(c)** | MCP server · opening · refusal<br><sub>rules file: documented, not measured</sub> | [Plugin](docs/install.md#opencode) |
| <picture><source media="(prefers-color-scheme: dark)" srcset="https://cdn.jsdelivr.net/npm/@lobehub/icons-static-png@1.97.1/dark/geminicli-color.png"><img src="https://cdn.jsdelivr.net/npm/@lobehub/icons-static-png@1.97.1/light/geminicli-color.png" width="24" height="24" alt="Gemini CLI"></picture> | **Gemini CLI**<br><sub>Google · command line</sub> | **(c)** | MCP server · opening · refusal<br><sub>rules file: documented, not measured</sub> | [Plugin](docs/install.md#gemini-cli) |
| <picture><source media="(prefers-color-scheme: dark)" srcset="https://cdn.jsdelivr.net/npm/@lobehub/icons-static-png@1.97.1/dark/cursor.png"><img src="https://cdn.jsdelivr.net/npm/@lobehub/icons-static-png@1.97.1/light/cursor.png" width="24" height="24" alt="Cursor"></picture> | **Cursor**<br><sub>Cursor · editor</sub> | **(a)** | MCP server · rules file<br><sub>documented, not measured</sub> | [MCP server](docs/install.md#any-other-host-with-an-mcp-client) |
| <picture><source media="(prefers-color-scheme: dark)" srcset="https://cdn.jsdelivr.net/npm/@lobehub/icons-static-png@1.97.1/dark/antigravity-color.png"><img src="https://cdn.jsdelivr.net/npm/@lobehub/icons-static-png@1.97.1/light/antigravity-color.png" width="24" height="24" alt="Antigravity CLI"></picture> | **Antigravity CLI**<br><sub>Google · command line (`agy`)</sub> | **(a)** | MCP server · rules file<br><sub>documented, not measured</sub> | [MCP server](docs/install.md#any-other-host-with-an-mcp-client) |
| <img src="https://raw.githubusercontent.com/Factory-AI/factory/c6ea47082007a32a8a76bb99da42e387565f119a/docs/favicon.svg" width="24" height="24" alt="Factory Droid"> | **Factory Droid**<br><sub>Factory · command line</sub> | **(a)** | MCP server · rules file<br><sub>documented, not measured</sub> | [MCP server](docs/install.md#any-other-host-with-an-mcp-client) |
| <picture><source media="(prefers-color-scheme: dark)" srcset="https://cdn.jsdelivr.net/npm/@lobehub/icons-static-png@1.97.1/dark/qwen-color.png"><img src="https://cdn.jsdelivr.net/npm/@lobehub/icons-static-png@1.97.1/light/qwen-color.png" width="24" height="24" alt="Qwen Code"></picture> | **Qwen Code**<br><sub>Qwen · command line</sub> | **(a)** | MCP server · rules file<br><sub>documented, not measured</sub> | [MCP server](docs/install.md#any-other-host-with-an-mcp-client) |
| <picture><source media="(prefers-color-scheme: dark)" srcset="https://cdn.jsdelivr.net/npm/@lobehub/icons-static-png@1.97.1/dark/goose.png"><img src="https://cdn.jsdelivr.net/npm/@lobehub/icons-static-png@1.97.1/light/goose.png" width="24" height="24" alt="Goose"></picture> | **Goose**<br><sub>Agentic AI Foundation · desktop and command line</sub> | **(a)** | MCP server · rules file<br><sub>documented, not measured</sub> | [MCP server](docs/install.md#any-other-host-with-an-mcp-client) |
| <picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/continuedev/continue/5522c6f44ca0ac3528b37244818fbfa39b5af470/extensions/intellij/src/main/resources/META-INF/pluginIcon_dark.svg"><img src="https://raw.githubusercontent.com/continuedev/continue/5522c6f44ca0ac3528b37244818fbfa39b5af470/extensions/intellij/src/main/resources/META-INF/pluginIcon.svg" width="24" height="24" alt="Continue CLI"></picture> | **Continue CLI**<br><sub>Continue · command line (`cn`)</sub> | **(a)** | MCP server · rules file<br><sub>documented, not measured</sub> | [MCP server](docs/install.md#any-other-host-with-an-mcp-client) |
| <picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/warpdotdev/warp/325d4d4701b41feb272487e89a6cf02bfba9f194/app/assets/bundled/svg/warp-logo-light.svg"><img src="https://raw.githubusercontent.com/warpdotdev/warp/325d4d4701b41feb272487e89a6cf02bfba9f194/app/assets/bundled/svg/warp-logo-dark.svg" width="24" height="24" alt="Warp"></picture> | **Warp**<br><sub>Warp · terminal</sub> | **(a)** | MCP server · rules file<br><sub>documented, not measured</sub> | [MCP server](docs/install.md#any-other-host-with-an-mcp-client) |

<!-- End of the generated host summary. -->

Each cell of the full table, how each one is known — held by a test, read once on a real host, or
documented and not measured — and the notes on each host are in
[How each claim is held](docs/evidence.md#each-hosts-rung). The plugins of Codex, Copilot CLI,
OpenCode and Gemini CLI need a `mnema` built from `main`: the pre-release does not know them yet
([why](docs/install.md#which-mnema-the-newer-plugins-need)).

## Features

| Feature | What it does |
|---|---|
| **Opens every session** | With the plugin, the decisions in force, the adopted patterns and the notes near the work. [What a session is handed](docs/agent-hosts.md) |
| **Rules at each edit** | In Claude Code, the rules for a file land beside the write. [What a session is handed](docs/agent-hosts.md) |
| **Refuses a write** | `refuses-a-write` stops an agent's write there, on every host from rung (c) up. [Features](docs/features.md) |
| **Asks for a person** | `asks-for-a-person` holds the write until someone decides, on the hosts of rung (d): Claude Code, VS Code and Copilot CLI. [Features](docs/features.md) |
| **Supersede, never edit** | A change of mind is a new decision. The old one leaves the opening and stays in the record. [How it works](docs/how-it-works.md) |
| **Take a note back** | `mnema retract` appends a signed retraction, and nothing is erased. [Features](docs/features.md) |
| **Every write signed** | The command line and the MCP server sign each write before they return. [How it works](docs/how-it-works.md) |
| **`mnema verify`** | No key, no network. It names the level it reached, not yes or no. [What it proves](docs/what-it-proves.md) |
| **A second reader** | A dependency-free Python verifier, written from the format's spec alone. [Verify without installing](docs/verify-without-installing.md) |
| **A page that verifies itself** | `mnema site` writes one HTML file, and the reader's browser checks it. [The page](docs/site.md) |
| **A pull-request check** | The Action comments what a PR does to the record and fails when it is not signed. [Packages](docs/packages.md) |
| **The git log, read against it** | `trailer`, `commits`, `why` and `aging` tie commits to decisions. [Features](docs/features.md) |
| **Stacks** | `mnema stack add` installs a set of skills and agents where the hosts that read them look, from a plan shown whole, and records the adoption as a signed fact. [Stacks](packages/stacks/README.md) |

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
- **What does not hold.** Nothing proves that nothing was removed: a hash chain shows what changed, never what is gone, and the history a git remote keeps is what covers omission. A record forged whole under a fresh key verifies clean, a key is not proven to be the person a name says, and the agent named on a fact is the name its client announced. A refusal of a write covers a host's editing tools, not its shell: `sed -i` on a protected file goes round it.
- **What a green `verify` means.** That nothing *verifiable* is broken, not that the record is honest, and the gate protects the shape of a change, not who may make it.

The whole table, claim by claim, is in [`docs/what-it-proves.md`](docs/what-it-proves.md); how each
claim about the agent hosts is held, and which are not held yet, is in [`docs/evidence.md`](docs/evidence.md).

## Docs

[Install](docs/install.md) · [Your first record](docs/first-record.md) · [How it works](docs/how-it-works.md) ·
[What a session is handed](docs/agent-hosts.md) · [Features](docs/features.md) · [What it proves](docs/what-it-proves.md) ·
[Verify without installing](docs/verify-without-installing.md) · [The page that verifies itself](docs/site.md) ·
[How each claim is held](docs/evidence.md) · [Where it fits](docs/where-it-fits.md) · [Packages](docs/packages.md) ·
[Build from source](docs/build-from-source.md) · [Contributing](CONTRIBUTING.md)

## License

Apache-2.0. See [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).
