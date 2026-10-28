# Install

mnema is one command-line binary, `mnema`, and a plugin for each agent host that hands the
record to the host's sessions. Install the binary first, then the plugin for your host.

<!-- not-on-the-site -->
These pages describe the next version, the `main` branch. What the version on npm does not have yet is
listed under Unreleased in the [Changelog](../CHANGELOG.md).
<!-- /not-on-the-site -->

## The binary

```sh
npm i -g @mnema/code
```

That puts the `mnema` binary on your `PATH`. It needs Node `^24.15.0 || >=26.0.0`; the package is ESM-only.
`mnema --version` says whether the shell finds it. If your global binaries live under pnpm,
`pnpm add -g @mnema/code` does the same.

**If `npm i -g @mnema/code` fails with a permissions error** (Node installed by the system, so npm's
global prefix is `/usr` and writing there needs `sudo`), install under your own home instead, and put
its `bin` on the `PATH`:

```sh
npm i -g --prefix ~/.local @mnema/code
export PATH="$HOME/.local/bin:$PATH"     # add this line to your shell's startup file
```

To update, run the same install again. To run the `main` branch instead of the published version,
see [Building it from source](build-from-source.md).

## Check it

```sh
mnema --version
mnema doctor
```

`doctor` says, one line to a finding and with what to do about it, whether the first `mnema` on
your `PATH` is the one you meant and whether the `node` it uses takes it. It writes nothing.
[Everything it checks](cli-reference.md#is-mnema-set-up-on-this-machine).

## Pin a version

```sh
npm i -g @mnema/code@0.1.3
```

To update, run the unpinned install again.

## Where the package came from

Each release of the five packages since 0.1.1 is published from this repository's release workflow,
with npm provenance (0.1.0 was published by hand and carries none). `npm audit signatures` reads the packages installed in a project, not a global
install (it fails with `EAUDITGLOBAL`), so check the version you installed in an empty folder:

```sh
mkdir mnema-check && cd mnema-check && npm init -y > /dev/null
npm i --ignore-scripts @mnema/code@0.1.3
npm audit signatures
```

It prints how many packages have verified registry signatures and how many have verified
attestations; `npm audit signatures --json --include-attestations` names each, and every
`@mnema/*` package carries an SLSA provenance attestation. The registry serves one tarball per
version, so this checks the same package a global install of that version fetches.

## Then the plugin for your host

One line for each host. The rung is how far the host takes the record, one rung at a time: (a) the MCP
server and rules in a file, (b) the opening of a session, (c) a refusal before a write, (d) a pause for a
person ([how each cell is known](evidence.md#each-hosts-rung)).

<!-- The host table below is generated from packages/code/src/host-names.ts: edit the table there. -->

| Host | Rung | Install | The rest |
| :--- | :---: | :--- | :--- |
| Claude Code | **(d)** | `claude plugin marketplace add felipesauer/mnema`, then `claude plugin install mnema@mnema` | [Details](hosts.md#claude-code) |
| VS Code | **(d)** | The Claude Code plugin, then `mnema doctor --fix vscode` | [Details](hosts.md#vs-code-and-cursor) |
| Cursor CLI | **(c)** | The Claude Code plugin, installed on the same machine | [Details](hosts.md#vs-code-and-cursor) |
| Codex | **(c)** | `codex plugin marketplace add felipesauer/mnema`, then `codex plugin add mnema@mnema` | [Details](hosts.md#codex) |
| Copilot CLI | **(d)** | `copilot plugin marketplace add felipesauer/mnema`, then `copilot plugin install mnema@mnema` | [Details](hosts.md#github-copilot-cli) |
| OpenCode | **(c)** | One file copied into `.opencode/plugins/`, and the server declared in `opencode.json` | [Details](hosts.md#opencode) |
| Gemini CLI | **(c)** | `gemini extensions install /path/to/mnema/plugin/gemini` | [Details](hosts.md#gemini-cli) |
| Qwen Code | **(c)** | `qwen extensions install /path/to/mnema/plugin` | [Details](hosts.md#qwen-code) |
| Cursor | **(a)** | The server: the command `mnema` with the argument `mcp` | [Details](hosts.md#any-other-host-with-an-mcp-client) |
| Antigravity CLI | **(a)** | The server: the command `mnema` with the argument `mcp` | [Details](hosts.md#any-other-host-with-an-mcp-client) |
| Factory Droid | **(a)** | The server: the command `mnema` with the argument `mcp` | [Details](hosts.md#any-other-host-with-an-mcp-client) |
| Goose | **(a)** | The server: the command `mnema` with the argument `mcp` | [Details](hosts.md#any-other-host-with-an-mcp-client) |

<!-- End of the generated host table. -->

What each host does with the plugin, and what was and was not run, is in [Hosts](hosts.md). What is run on
Windows and macOS is in [Windows and macOS](platforms.md).
