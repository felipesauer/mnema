# Taking mnema to a host that is not here yet

Which hosts run mnema, and how far, is [the rung table](../docs/evidence.md#each-hosts-rung): one row
per host, one cell per rung, each saying how it is known. It is generated from the host table in
[`host-names.ts`](../packages/code/src/host-names.ts), and so are the plugin's hooks file and its
manifests. This page is the order of work for a new host. It points at the code and the
measurements rather than copying them, because both change faster than a page about them does.

## 1. Start with the MCP server

Every host gets the same server, the binary's MCP verb, over stdio. It is what an agent writes the record
through, and the plugin declares it in [`.claude-plugin/plugin.json`](.claude-plugin/plugin.json).
Point the new host at that command and check three things, each of which differs between the hosts
already here ([the table](README.md#in-vs-code-and-cursor)):

- **Which project the server serves.** A host that announces its workspace folders is served that
  project; one that announces none falls back to the directory it starts the server in
  ([`a-client-that-names-no-workspace.test.ts`](../packages/code/tests/a-client-that-names-no-workspace.test.ts)).
- **Whether the server's instructions reach the model.** Not every model family's prompt carries
  them. Where they do not, the opening document (step 2) is what arrives.
- **How the host loads a plugin at all.** The plugin is written in Claude Code's format and VS Code
  and Cursor read that format; a host with its own format needs its own manifest, and the facts
  above are the part that does not change. Codex is the first such host: it reads
  `.codex-plugin/plugin.json` first, and that manifest names a hooks file only Codex reads, because
  Codex would otherwise run the other hosts' gates too (it matches `apply_patch` by `Write` and
  `Edit`). Both files are generated from the host table, like the rest. A host whose hook is
  code, not a command (OpenCode), reads no manifest or hooks file of this plugin at all: it loads
  a JavaScript module from its own folder, so the generator writes one self-contained module
  (`plugin/opencode/mnema.js`) that runs `mnema` as a process, and the person copies it. Gemini
  CLI reads its hooks from an extension, a folder it copies at install, with its hooks at
  `hooks/hooks.json` (the path of this plugin's own hooks file) so the extension is a folder of
  its own (`plugin/gemini/`), generated from the table and self-contained: its hooks run one script
  in it, since the handlers beside the plugin's hooks file would not be copied with it.

## 2. Then the hooks, one question at a time

Do not assume a host's hooks work like Claude Code's. Each of these was a fact about one host and a
guess about the other two until it was read against the real host, and each is a row of
[how each claim is held](../docs/evidence.md) with the host and version it expires with. A new
host adds its rows there, as "not held yet" until a file in the tree holds them:

- Does a hook run **before** a write, and on which tool names and payload fields?
- Which hook types does it run: `command` only, or also `mcp_tool`?
- Does it read the **matcher**, or run every hook on every tool?
- Where does a hook's text land for the model: beside the tool result, inside it, or elsewhere?
- Can a hook **ask a person**, can it **refuse**, and what does the model read afterwards?

Measure with the real host, a stand-in for the model and no network, as that page describes. The
answers are the host's row in `host-names.ts`: how a hook before a write reaches it, whether it
asks, the variable it sets if the other hosts would run its hook too, and a cell per rung with how
that cell is known. Write the row before any code that stands on it.

## 3. What the product already does with the answers

The session opening is two command hooks, [`session-start.mjs`](hooks/session-start.mjs) and
[`session-recall.mjs`](hooks/session-recall.mjs), which any host that runs a `SessionStart` command
and puts its text before the model can use unchanged. A host whose hooks are processes and which
runs a command before a write reuses the verb behind
[`edit-asks-a-person.mjs`](hooks/edit-asks-a-person.mjs) and
[`edit-refuses-a-write.mjs`](hooks/edit-refuses-a-write.mjs), the binary's before-a-write verb, told the host by name.
The host is a row of [`host-names.ts`](../packages/code/src/host-names.ts), and the hooks file
names it to the handler (`--host`), so adding the row and regenerating the files
([`the-host-files-are-generated.test.ts`](../packages/code/tests/the-host-files-are-generated.test.ts),
with `-u`) is the whole of the plugin's side. What the verb reads from its payload and how it
answers is [`host-hook.ts`](../packages/code/src/host-hook.ts). Which rules a write meets is decided in one
place, whatever the door, so a new host cannot come to stop different writes than the others.

A host whose command before a write can hand text to the model beside a write that goes through, and
whose payload carries the session's id, takes the rules of the record the same way: the row's
`pushes` cell says yes, and the verb adds them to the reply as context, once the service is
remembered for the session (`takeTheFirstServing`, in [`session-journal.ts`](../packages/code/src/session-journal.ts)),
because the fact that the push was live is declared once per run and a process per write has no run.
A host with no session id is handed nothing: the fact is what separates a push that arrived from a
plugin that was never installed. Codex, Qwen Code and OpenCode are the three that have it; a case of
[where a rule arrives](../docs/rule-arrival.md) is what turns the cell to yes.

A host whose command before a write has no field for text, but which has a hook that runs once the
tool is done and whose reply is appended to the tool's result, takes them from that one: the row says
`pushesAt: 'after'`, and its hook runs the verb `beside-a-write`
([`edit-rules-beside.mjs`](hooks/edit-rules-beside.mjs), or the host's own script), which composes the
same text and remembers the service the same way but never refuses, asks or records a charge, because
the write it follows was already charged. Copilot CLI and Gemini CLI are the two that have it. Its
reply is the host's own shape, written in `replyBeside` of `host-hook.ts`.

A host that cannot be told to ask must not be answered as if it had asked: a recorded asking for a
write nobody paused is the record reading backwards. That is why Cursor is answered a refusal and
nothing else.

For a host that reads rules from files with a glob and has no hook worth using, the `rules-file` verb
prints the file in that host's format ([`host-rules-file.ts`](../packages/code/src/host-rules-file.ts)).

## 4. What you leave behind

The host's row, which puts it in the rung table: a cell the documentation says and nothing ran is
"documented, not measured", and one a real host showed names the version and the day until a case
of this tree holds it. Then a column in [the plugin page](README.md#in-vs-code-and-cursor) and the
host's rows in the hooks measurement, both naming the host version; a case that runs the real
plugin and the built binary; and the sentence for what the host does **not** do. A host that ignores `ask` is not a lesser port, it is a
port that says so.
