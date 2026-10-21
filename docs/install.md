# Install

mnema is one command-line binary, `mnema`, and a plugin for each agent host that hands the
record to the host's sessions. Install the binary first, then the plugin for your host.

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

## Claude Code

For the Claude Code plugin (the opening context, the notes beside it and the per-edit
rules), add this repository as a marketplace and install from it:

```sh
claude plugin marketplace add felipesauer/mnema
claude plugin install mnema@mnema
```

Claude Code may end the install saying that `userConfig` options are not yet set. They are the
plugin's `mnema_path` option, which has the default `mnema` (the first one on your `PATH`), and its
`agent_key` option, which is empty (the server signs with your own key): the host lists an option as
unset until you give it a value, and nothing needs doing unless you want to run another binary or
sign as an agent (`/plugin configure mnema@mnema`). That VS Code and Cursor, which read this same manifest, pass the
option on to the server was not measured.

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
a response, and its skills are not installed. The agent still has every tool of the server,
and you still have every command. Do not install both: they declare the same server.

## VS Code and Cursor

In VS Code and Cursor, the server is the same `mnema mcp`, and the plugin is the same
one. VS Code's agent reads the Claude Code plugin format, and Cursor's command-line agent
picks up a plugin installed in Claude Code on the same machine; the per-host details (what
each one runs, the rules at each edit that are Claude Code's alone, and the pause for a person
that reaches VS Code as well) are in the [plugin's page](../plugin/README.md#in-vs-code-and-cursor).

VS Code's agent loads the plugin only from a folder listed in its `chat.pluginLocations` setting,
which VS Code marks as experimental. In order: install the plugin in Claude Code
(`claude plugin marketplace add felipesauer/mnema`, then `claude plugin install mnema@mnema`), run
`mnema doctor` and read its `vscode` line, and if it asks for it, run `mnema doctor --fix vscode`
(`--dry-run` shows the change first). That verb is the one thing `doctor` writes: it runs only when
you type it, copies your `settings.json` aside first, keeps its comments, and lists the plugin's
folder in the marketplace, whose path does not change when the plugin updates.

## Codex

In Codex, the plugin comes from the same marketplace, and Codex reads a manifest of its own
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

## OpenCode

In OpenCode, there is no marketplace to add: its hook is code, so the plugin is one
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
session's system prompt, and refuses a write (`write`, `edit` or `apply_patch`) where a rule
refuses it, handing the model the rule as the call's error, and every write while a line of the
record is one this mnema cannot read: in that project, or in every project of the machine when the
line is in the global tree ([the limit](features.md)). It pauses nothing, so a rule that only
asks is let through, and it does nothing where `mnema` is missing or is another program. Its
opening goes through a hook OpenCode marks experimental, so it is held on one version of OpenCode
(`.github/workflows/host-contract.yml` names it). `~/.config/opencode/plugins/` takes the same file
for every project. The module runs `mnema` as a process and waits for it: a call that does not answer
holds OpenCode's own process for up to 15 seconds (the opening asks twice, `brief` and `recall`, after
asking `mnema` who it is, so up to 45), and on Windows `mnema.cmd` may not be run at all, since Node
does not start a `.cmd` without a shell: the module is then silent, as where `mnema` is missing; this
last point was not run.

## GitHub Copilot CLI

In GitHub Copilot CLI, the plugin comes from the same marketplace, which the command line reads
as it is:

```bash
copilot plugin marketplace add felipesauer/mnema
copilot plugin install mnema@mnema
```

It opens each session with the document and the notes, refuses a write where a rule refuses it and,
where a person is at the terminal, pauses a write where a rule asks for one; it refuses every write
while a line of the record is one this mnema cannot read: in that project, or in every project of
the machine when the line is in the global tree ([the limit](features.md)). `mnema-server-only@mnema`
connects the server and runs no hook.

## Gemini CLI

In Gemini CLI, the hook is an extension, a folder the host copies into your home, and it is
installed from a checkout of this repository, where it is the folder `plugin/gemini`:

```bash
gemini extensions install /path/to/mnema/plugin/gemini
```

The host asks you to consent to the install, and reads the extension from the next session on. The
extension starts the first `mnema` on the `PATH` as its MCP server, adds the document and the notes
to the first turn of each session (the host escapes the angle brackets of that text), and refuses a
`write_file` or a `replace` where a rule refuses it, handing the model the rule as the call's error.
After an `ask_user` question is answered, it names the tool that records the choice (documented, not
measured). It pauses nothing, so a rule that only asks is let through, and it does nothing where `mnema` is
missing or is another program. Its three hooks run one script that runs `mnema` as a process and waits
for it, and the extension's hooks file gives each hook 15 seconds; on Windows `mnema.cmd` may not be
run at all, since Node does not start a `.cmd` without a shell: the script is then silent; that was
not run. A run without a person (`gemini -p`) in a folder the host does not trust does not start
unless it is told to trust it (`--skip-trust`).

## Any other host with an MCP client

The hosts in the first rung of [the table](evidence.md#each-hosts-rung) (Cursor's editor,
Antigravity's command line, Factory Droid, Qwen Code and Goose) get no plugin from this repository.
Their own documentation says they take an MCP server and read a rules file; that was read, not run
with this product. Any other client that takes an MCP server is in the same place, and nothing about it
was read. Declare the server the way the
host's documentation says, as the command `mnema` with the one argument `mcp`, run in the project's
root. The agent then has every tool of the server; nothing opens its sessions, refuses a write or
pauses one.

## Without a plugin

Without the plugin, `mnema rules-file --host claude`, `--host vscode` or `--host cursor` prints the committed rules
addressed at a file or a directory in that host's own rules format, and says which rules it left out and why.

## Checking an install

`mnema doctor` says, one line to a finding and with what to do about it, whether a `mnema` is
on the `PATH` and which one, whether the Claude Code plugin is installed and at what version,
whether the mnema MCP server is declared more than once, and whether a second `mnema` or an npm
package of that name is installed; whether VS Code's `settings.json` tells its agent where the
plugin is; which projects of `~/.claude.json` still declare the server, including ones whose
directory no longer exists (`claude mcp remove` does not reach those, and `doctor` says what to
delete); and, for each agent key this machine holds, in which of the project's committed tree, its private
tree and the machine's global one the record enrols it, retired it or does not name it and, on a machine that holds an
agent key already, which agents the files this plugin generates for each host ask for that no key is held under,
whether `MNEMA_AGENT_KEY` in the environment of the `doctor` itself names one this machine does not hold, and whether
your own key is still unprotected while an agent key exists. Asked alone it writes nothing and does not ask the registry.
