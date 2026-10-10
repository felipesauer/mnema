# Install

**Nothing is on npm yet**, so `npm i -g @mnema/code` answers 404 until the first
publication. Until then, install the pre-release `v0.1.0-beta`: `@mnema/code` depends on
the other three packages, so the four tarballs go in one command.

```sh
npm i -g \
  https://github.com/felipesauer/mnema/releases/download/v0.1.0-beta/mnema-chain-0.1.0-beta.tgz \
  https://github.com/felipesauer/mnema/releases/download/v0.1.0-beta/mnema-core-0.1.0-beta.tgz \
  https://github.com/felipesauer/mnema/releases/download/v0.1.0-beta/mnema-context-0.1.0-beta.tgz \
  https://github.com/felipesauer/mnema/releases/download/v0.1.0-beta/mnema-code-0.1.0-beta.tgz
```

The release carries a `SHA256SUMS` beside them. Once the packages are published, this is
the install:

```sh
npm i -g @mnema/code
# or, if your global binaries live under pnpm:
pnpm add -g @mnema/code
```

Either puts the `mnema` binary on your `PATH`. Requires Node 24.15.0 or a later 24, or 26.0.0 or later; the package
is ESM-only. `npm view @mnema/code version` says whether the publication has happened: a
404 means it has not. To run it from a clone instead, see
[Building it from source](build-from-source.md).

**If `npm i -g` fails with a permissions error** (Node installed by the system, so npm's global
prefix is `/usr` and writing there needs `sudo`), install under your own home instead, with the
same arguments after the flag, and put its `bin` on the `PATH`:

```sh
npm i -g --prefix ~/.local @mnema/code   # or the four tarballs above
export PATH="$HOME/.local/bin:$PATH"     # add this line to your shell's startup file
```

`mnema --version` says whether the shell finds it.

For the Claude Code plugin — the opening context, the notes beside it and the per-edit
rules — add this repository as a marketplace and install from it:

```sh
claude plugin marketplace add felipesauer/mnema
claude plugin install mnema@mnema
```

Claude Code may end the install with `1 userConfig option not yet set`. That is the plugin's
`mnema_path` option, which has the default `mnema` (the first one on your `PATH`): the host
lists an option as unset until you give it a value, and nothing needs doing unless you want to
run another binary (`/plugin configure mnema@mnema`).

The plugin connects the MCP server too, so registering the server yourself as well is
redundant: a session would be offered every tool twice, under two prefixes.

**To have only the server and the command line, with no hook**, install the marketplace's
other plugin instead of that one:

```sh
claude plugin install mnema-server-only@mnema
```

It connects the same `mnema mcp` and runs no hook, so what the plugin's hooks hand over is
not handed over: the record is not put into the session as it opens, no rule comes beside an
edit, no pause for a person is asked at one, and no count or correction is taken at the end of
a response — and its skills are not installed. The agent still has every tool of the server,
and you still have every command. Do not install both: they declare the same server.

**In VS Code and Cursor**, the server is the same `mnema mcp`, and the plugin is the same
one. VS Code's agent reads the Claude Code plugin format, and Cursor's command-line agent
picks up a plugin installed in Claude Code on the same machine; the per-host details — what
each one runs, the rules at each edit that are Claude Code's alone, and the pause for a person
that reaches VS Code as well — are in the [plugin's page](../plugin/README.md#in-vs-code-and-cursor).

VS Code's agent loads the plugin only from a folder listed in its `chat.pluginLocations` setting,
which VS Code marks as experimental. In order: install the plugin in Claude Code
(`claude plugin marketplace add felipesauer/mnema`, then `claude plugin install mnema@mnema`), run
`mnema doctor` and read its `vscode` line, and if it asks for it, run `mnema doctor --fix vscode`
(`--dry-run` shows the change first). That verb is the one thing `doctor` writes: it runs only when
you type it, copies your `settings.json` aside first, keeps its comments, and lists the plugin's
folder in the marketplace, whose path does not change when the plugin updates.
**In Codex**, the plugin comes from the same marketplace, and Codex reads a manifest of its own
in it (`.codex-plugin/plugin.json`):

```bash
codex plugin marketplace add felipesauer/mnema
codex plugin add mnema@mnema
```

It starts the first `mnema` on the `PATH` as its MCP server, opens each session with the
document and the notes cut to Codex's own ceiling, and refuses a patch where a rule refuses the
write. Codex does not pause a write for a person, so a rule that only asks is let through. Codex
runs a plugin's hooks only once you have marked them trusted in its own review of hooks; until
then the plugin gives the server alone. `mnema-server-only@mnema` connects the server and runs no
hook.

**In OpenCode**, there is no marketplace to add: its hook is code, so the plugin is one
JavaScript module, copied into the project, and the server is declared in the project's
`opencode.json`:

```bash
mkdir -p .opencode/plugins
curl -fsSL https://raw.githubusercontent.com/felipesauer/mnema/main/plugin/opencode/mnema.js \
  -o .opencode/plugins/mnema.js
```

```json
{ "mcp": { "mnema": { "type": "local", "command": ["mnema", "mcp"] } } }
```

The module runs the first `mnema` on the `PATH`. It adds the document and the notes to each
session's system prompt, and refuses a write — `write`, `edit` or `apply_patch` — where a rule
refuses it, handing the model the rule as the call's error. It pauses nothing, so a rule that only
asks is let through, and it does nothing where `mnema` is missing or is another program. Its
opening goes through a hook OpenCode marks experimental, so it is held on one version of OpenCode
(`.github/workflows/host-contract.yml` names it). `~/.config/opencode/plugins/` takes the same file
for every project.

Without the plugin, `mnema rules-file --host claude`, `--host vscode` or `--host cursor` prints the committed rules
addressed at a file or a directory in that host's own rules format, and says which rules it left out and why.

`mnema doctor` says, one line to a finding and with what to do about it, whether a `mnema` is
on the `PATH` and which one, whether the Claude Code plugin is installed and at what version,
whether the mnema MCP server is declared more than once, and whether a second `mnema` or an npm
package of that name is installed; whether VS Code's `settings.json` tells its agent where the
plugin is; and which projects of `~/.claude.json` still declare the server, including ones whose
directory no longer exists (`claude mcp remove` does not reach those, and `doctor` says what to
delete). Asked alone it writes nothing and does not ask the registry.
