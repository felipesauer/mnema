# Hosts

The binary comes first ([Install](install.md)); this page is the plugin, or the way in, for each host.

## Claude Code

For the Claude Code plugin (the opening context, the notes beside it and the per-edit
rules), add this repository as a marketplace and install from it:

```sh
claude plugin marketplace add felipesauer/mnema
claude plugin install mnema@mnema
```

Claude Code may end the install saying that `userConfig` options are not yet set. They are the
plugin's `mnema_path` option, which has the default `mnema` (the first one on your `PATH`), and its
`agent_key` option, which is empty (the server signs with the key your environment's `MNEMA_AGENT_KEY` names, else with your own): the host lists an option as
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

The [extension](../packages/vscode/README.md) that shows the rules over the open file and the decisions
waiting for a judgment is on the Visual Studio Marketplace and on Open VSX as `mnema.mnema`: `code --install-extension mnema.mnema`. It runs the
`mnema` command, so `@mnema/code` stays a prerequisite. If you installed the 0.1.2 file by hand
(`felipesauer.mnema`), uninstall it first: it is a different extension id.


In VS Code and Cursor, the server is the same `mnema mcp`, and the plugin is the same
one. VS Code's agent reads the Claude Code plugin format, and Cursor's command-line agent
picks up a plugin installed in Claude Code on the same machine; the per-host details (what
each one runs, the rules at each edit (which Claude Code, Codex, Copilot CLI, Gemini CLI, Qwen Code and OpenCode get, and these two do not yet), and the pause for a person
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
asking `mnema` who it is, so up to 45). On Windows it starts npm's `mnema.cmd` through a shell, because
Node does not start a `.cmd` without one; OpenCode's own module was not run on Windows, and the plugin's
command-hook scripts were ([what is run on each system](platforms.md)).

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
for it, and the extension's hooks file gives each hook 15 seconds; on Windows the script starts npm's
`mnema.cmd` through a shell, because Node does not start a `.cmd` without one, and that script was not run
on Windows. A run without a person (`gemini -p`) in a folder the host does not trust does not start
unless it is told to trust it (`--skip-trust`).

## Qwen Code

Qwen Code installs the plugin of this repository itself: it converts the Claude Code plugin into an
extension of its own and copies it into your home. From a checkout of this repository:

```bash
qwen extensions install /path/to/mnema/plugin
```

The host asks you to consent to the install, and reads the extension from the next session on. The
extension starts `mnema mcp` as its MCP server (the host lists the server's
tools by name and hands a schema only when the model asks for one), adds the document and the notes
to the system instruction of the session (the host escapes the angle brackets of that text), and
refuses a `write_file` or an `edit` where a rule refuses it, handing the model the rule as the call's
error. The command that refuses runs only where `QWEN_PROJECT_DIR` is set, which the host sets for
every hook. It pauses nothing, so a rule that only asks is let through, and it does nothing where
`mnema` is missing. A program of that name that is not this product cannot answer, and a write at a
path a rule that refuses it addresses is refused.
Held by a test that starts the real Qwen Code 0.26.1 against a stand-in for its model
([`qwen-opens-and-refuses.qwen.test.ts`](../packages/code/tests/host-contract/qwen-opens-and-refuses.qwen.test.ts)).
Not run: an interactive session, `notebook_edit`, a file a shell command writes, and what the plugin's
other hooks do under it.

## Any other host with an MCP client

The hosts in the first rung of [the table](evidence.md#each-hosts-rung) (Cursor's editor,
Antigravity's command line, Factory Droid and Goose) get no plugin from this repository.
Their own documentation says they take an MCP server and read a rules file; that was read, not run
with this product. Any other client that takes an MCP server is in the same place, and nothing about it
was read. Declare the server the way the
host's documentation says, as the command `mnema` with the one argument `mcp`, run in the project's
root. The agent then has every tool of the server; nothing opens its sessions, refuses a write or
pauses one.

## Without a plugin

Without the plugin, `mnema rules-file --host claude`, `--host vscode` or `--host cursor` prints the committed rules
addressed at a file or a directory in that host's own rules format, and says which rules it left out and why.
