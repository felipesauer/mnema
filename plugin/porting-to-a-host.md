# Taking mnema to a host that is not here yet

Three hosts run mnema today: Claude Code, VS Code's agent and Cursor's command-line agent. This page
is the order of work for a fourth. It points at the code and the measurements rather than copying
them, because both change faster than a page about them does.

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
- **How the host loads a plugin at all.** The plugin is written in Claude Code's format and the
  other two read that format; a host with its own format needs its own manifest, and the facts
  above are the part that does not change.

## 2. Then the hooks, one question at a time

Do not assume a host's hooks work like Claude Code's. Each of these was a fact about one host and a
guess about the other two until it was measured, and each is a row in
[`measurements/hooks-by-host/`](../measurements/hooks-by-host/README.md) with the host and version
it expires with:

- Does a hook run **before** a write, and on which tool names and payload fields?
- Which hook types does it run: `command` only, or also `mcp_tool`?
- Does it read the **matcher**, or run every hook on every tool?
- Where does a hook's text land for the model: beside the tool result, inside it, or elsewhere?
- Can a hook **ask a person**, can it **refuse**, and what does the model read afterwards?

Measure with the real host, a stand-in for the model and no network, as that page describes. Write
the new column into its table before writing any code that stands on it.

## 3. What the product already does with the answers

The session opening is two command hooks, [`session-start.mjs`](hooks/session-start.mjs) and
[`session-recall.mjs`](hooks/session-recall.mjs), which any host that runs a `SessionStart` command
and puts its text before the model can use unchanged. A host whose hooks are processes and which
runs a command before a write reuses the verb behind
[`edit-asks-a-person.mjs`](hooks/edit-asks-a-person.mjs) and
[`edit-refuses-a-write.mjs`](hooks/edit-refuses-a-write.mjs), the binary's before-a-write verb, told the host by name.
The host is a name in [`host-names.ts`](../packages/code/src/host-names.ts), and what the verb
reads from its payload and how it answers is
[`host-hook.ts`](../packages/code/src/host-hook.ts). Which rules a write meets is decided in one
place, whatever the door, so a new host cannot come to stop different writes than the others.

A host that cannot be told to ask must not be answered as if it had asked: a recorded asking for a
write nobody paused is the record reading backwards. That is why Cursor is answered a refusal and
nothing else.

For a host that reads rules from files with a glob and has no hook worth using, the `rules-file` verb
prints the file in that host's format ([`host-rules-file.ts`](../packages/code/src/host-rules-file.ts)).

## 4. What you leave behind

A table row in [the plugin page](README.md#in-vs-code-and-cursor) and one in the hooks measurement,
both naming the host version; a case that runs the real plugin and the built binary; and the
sentence for what the host does **not** do. A host that ignores `ask` is not a lesser port, it is a
port that says so.
