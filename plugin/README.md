# mnema — the Claude Code plugin

One installation, both surfaces. When a session opens, the project's **committed**
mnema record arrives in the agent's context without the agent asking for it; while the
session runs, the mnema **MCP server** is connected so the agent can read the rest and
record its own work.

## Why it exists

The record was already there and the agent was not reaching for it. Over a measured
round of 116 cells, the arm that had the mnema server available never called a single
tool — `mcp_asked` was `false` in 20 of 20 instrumented cells — and it scored exactly
what the arm carrying no record at all scored. The arm that carried the same decision
in a file the host injects unasked conformed on every cell of the two tasks where the
bare arm conformed on none.

So the finding was not *"the record does not help"*. It was *"the agent does not
ask"* — a different problem, with a different fix. This plugin is the fix: the same
document, delivered by the host instead of waited for.

## What it gives you

- **A `SessionStart` hook** that runs `mnema brief` and hands the result to the
  session as opening context — the decisions in force and the patterns adopted in
  this project, each by name.
- **The mnema MCP server**, declared here so installing the plugin is all it takes:
  the agent gets the reads (`read_record`, `skills`, `search`, the audits) and the
  writes (tasks, decisions, patterns, memories, observations, handoffs) it already
  had, without a second entry in a settings file.

## What it does — and what it does not

The hook is a **read**. It appends nothing to the record, opens no run, and starts no
session of its own. Every claim below names the case that holds it, all of them in
[`packages/code/tests/the-record-arrives-unasked.test.ts`](../packages/code/tests/the-record-arrives-unasked.test.ts).

| Claim | What actually holds |
|---|---|
| **It injects the project's record** | Only what is **committed** — the tree a clone of the repository gets. A decision or a pattern recorded `--scope private`, or in your machine's global tree, governs your work and **is not in this document**. That is not a gap to route around: the document is the same one `mnema brief > AGENTS.md` writes into a tracked file, and a private rule that travelled there would be the defect. Someone will record one and wonder where it went — this is where it went. *(`carries the committed record by name`)* |
| **It injects the rules** | It injects **names**, not bodies. A decision arrives as its title and its citable `ADR-<n>` label; a pattern arrives as its name. The argument behind a decision, what it turned down, and the text of a pattern are a **second read** — the agent asks `read_record` or `skills` about the one item that bears on the task, through the MCP server this same plugin declares. A file read on every prompt pays for its length every time. *(`carries the committed record by name`)* |
| **It says the record's words** | Byte for byte what `mnema brief` prints, with no preamble and no cut of the plugin's own — a second place deciding **what governs the work** is a second place that can come to disagree with the record. There is no framing either, and that half is a **fact about this version rather than a rule**: the foundation's G6 says text mnema pushes to a *model* should say what the text **is**, which is provenance and not a second opinion about what governs. Today this channel carries the names `brief` already labels; the day it carries rule bodies is the day framing belongs in it. *(`hands over exactly what the verb prints`)* |
| **It is silent when it has nothing to say** | Outside a mnema project — which is most projects on most machines — the hook produces **no output and no error**, and the session opens exactly as it would without the plugin. The same is true of every other failure: `mnema` missing from the `PATH`, a record that will not read. A hook is not a place to diagnose. *(`says nothing at all where there is no project`)* |
| **It never blocks** | `SessionStart` cannot refuse anything, and this plugin declares **no other event** — nothing installed here can deny a tool call or hold up a turn. That is what this version **is**, and it is no longer a promise about every version. The sentence that stood here said `PreToolUse` *"is deliberately unused, and will stay unused: mnema observes, it does not command"*; it was withdrawn on 18 Aug 2026, when a measured round scored the arm carrying the record at **0/8** on the two tasks that discriminate — what the arm carrying **no record at all** scored — against **8/8** for an arm that injected the same knowledge unasked. mnema's foundation now says it governs the work with proof. **Intended shape, not shipped behaviour:** anything mnema ever refuses would have to name the decision or the pattern **from your own record** that caused it, and be switchable off. None of that is in this plugin, and this table is where it would have to appear — an event this file does not declare cannot run. *(`runs mnema brief, and nothing else`)* |
| **It is a snapshot** | Taken when the session opens. A decision accepted an hour into the session is not in the context the hook injected; the live answer is one MCP call away. |
| **It proves nothing on its own** | The proof is the record's — `mnema verify` is what rules on the chain, and the plugin neither strengthens nor weakens it. What arrives in the context is a **projection**: throw it away and the next session builds it again. |

## Install

The plugin runs the `mnema` binary, so install that first:

```sh
pnpm add -g @mnema/code
```

Then add this repository as a marketplace and install from it:

```sh
claude plugin marketplace add felipesauer/mnema
claude plugin install mnema@mnema
```

Requires Node ≥ 20. Nothing here reaches the network, and nothing here writes.

## Check that it worked

The hook hands over what the verb prints, so the verb is how you see it:

```sh
cd your-project
mnema brief
```

What that command prints is what the agent is handed at the start of the next
session. If it refuses with `No mnema project here`, the hook stays quiet — run
`mnema init` if this project should have a record.

## Layout

```
plugin/
├── .claude-plugin/
│   └── plugin.json          the manifest, and the MCP server declaration
├── hooks/
│   ├── hooks.json           one event: SessionStart
│   └── session-start.mjs    runs `mnema brief`; silent when there is nothing to say
└── README.md
```

The handler is a wrapper rather than a bare `mnema brief` in `hooks.json` on purpose:
outside a project the verb refuses on stderr and exits 1, which is right for a command
a person typed and wrong for a hook that runs in every session on the machine. The
muteness belongs to the plugin; the verb stays as it is.

## License

MIT, with the rest of [mnema](https://github.com/felipesauer/mnema).
