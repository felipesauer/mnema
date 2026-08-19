# mnema — the Claude Code plugin

One installation, both surfaces. When a session opens, the project's **committed**
mnema record arrives in the agent's context without the agent asking for it; when a file
is about to be written, the rules of the record **addressed at that file** arrive the same
way; and while the session runs, the mnema **MCP server** is connected so the agent can
read the rest and record its own work.

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
- **A `PreToolUse` hook** on `Write|Edit|NotebookEdit` that hands over the rules
  **addressed at the file about to be written**: the ones still in force, each with the
  address that matched and the id you would cite. It hands over **nothing** for a file no
  rule addresses — which is why the opening document says how many of this project's
  rules have an address, so a quiet edit means "none of them names this file" rather than
  "there is no mechanism". It is not a process: the host calls a tool on the MCP server
  this same plugin declares, which costs a call on an open connection instead of a
  command start (measured: 1.24 ms against 171.5 ms).
- **A switch for both of them.** `mnema switch` says where each stands and what each
  carries; `mnema switch off edit-rules-push` stops the per-edit push, `mnema switch off
  brief-document` stops the opening document. Neither is off to begin with. The switch is a
  **fact of your record** rather than a setting — signed, attributed, dated and scoped —
  because turning something off is legitimate and turning it off in silence is not: a reader
  of the record has to be able to tell *"no rule addressed that file"* from *"somebody had
  turned the push off that week"*. It defaults to the **committed** tree, so the team reads
  it and the next session's opening document says so; `--scope private` is the switch that
  means this machine, and then only `mnema switch` can report it.
- **The mnema MCP server**, declared here so installing the plugin is all it takes:
  the agent gets the reads (`read_record`, `skills`, `search`, the audits) and the
  writes (tasks, decisions, patterns, memories, observations, handoffs) it already
  had, without a second entry in a settings file.

## What it does — and what it does not

Both hooks are **reads**. They append nothing to the record, open no run, and start no
session of their own. Every claim below names the case that holds it, in
[`the-record-arrives-unasked.test.ts`](../packages/code/tests/the-record-arrives-unasked.test.ts)
for the opening context and
[`the-rule-reaches-the-writing.test.ts`](../packages/code/tests/the-rule-reaches-the-writing.test.ts)
for the per-edit one. One thing neither file can hold is that the HOST calls them at all —
that was measured against the real binary instead, and the capture is
[`measurements/mcp-tool-channel/`](../measurements/mcp-tool-channel/).

| Claim | What actually holds |
|---|---|
| **It injects the project's record** | Only what is **committed** — the tree a clone of the repository gets. A decision or a pattern recorded `--scope private`, or in your machine's global tree, governs your work and **is not in this document**. That is not a gap to route around: the document is the same one `mnema brief > AGENTS.md` writes into a tracked file, and a private rule that travelled there would be the defect. Someone will record one and wonder where it went — this is where it went. *(`carries the committed record by name`)* |
| **It injects the rules** | It injects **names**, not bodies. A decision arrives as its title and its citable `ADR-<n>` label; a pattern arrives as its name. The argument behind a decision, what it turned down, and the text of a pattern are a **second read** — the agent asks `read_record` or `skills` about the one item that bears on the task, through the MCP server this same plugin declares. A file read on every prompt pays for its length every time. *(`carries the committed record by name`)* |
| **It says the record's words** | Byte for byte what `mnema brief` prints, with no preamble and no cut of the plugin's own — a second place deciding what governs the work is a second place that can come to disagree with the record. It is **not** unframed, and this row used to say it was: the document opens by saying whose text it carries — the project's own people and agents, not instructions from mnema — and that sentence is decided in one place for every channel that puts record text in front of a model, so a second channel cannot word it differently. "No framing" was true of what the *handler* adds and was read as a claim that the text reaches the model undeclared. *(`hands over exactly what the verb prints`, `carries the declaration of the channel it says it is`)* |
| **It is silent when it has nothing to say** | Outside a mnema project — which is most projects on most machines — the hook produces **no output and no error**, and the session opens exactly as it would without the plugin. The same is true of every other failure: `mnema` missing from the `PATH`, a record that will not read. A hook is not a place to diagnose. **And when you switch the document off**, by the same mechanism and with no new branch in the handler: the verb refuses on stderr with a non-zero exit, and every non-zero outcome here is silence. *(`says nothing at all where there is no project`, `says nothing at all when the document channel is switched OFF`)* |
| **It never blocks** | It declares `PreToolUse` now — the one event of this host that *can* refuse — and refuses nothing. What its hook returns is context or an empty object: no `permissionDecision` in any of its four values, no rewritten tool input, no field that could deny a call or hold up a turn. The reply's own TYPE has nowhere to put one. **The row used to say the plugin declared no other event**, offered as the reason it could not block; that reason is gone and the property is the same one, now held by what the hook returns rather than by what it does not declare. **One half of that sentence has SHIPPED and the sentence is rewritten rather than deleted.** It read: *"anything mnema ever refuses would have to name the decision or the pattern from your own record that caused it, and be switchable off. None of that is in this plugin."* Switchable off is now true of both hooks — `mnema switch`, and the switching is recorded — and the other half stands: nothing here refuses anything, so there is nothing yet for a refusal to cite. *(`carries no field that could refuse, escalate or rewrite`, `runs mnema brief, and nothing else`, `goes quiet when edit-rules-push is switched off`)* |
| **The rules reach the file about to change** | Only the rules with an **address** — a path someone linked them to with `rel: "governs"` — and only the ones **still in force**. A superseded decision that addresses the file does not arrive; `governing_rules` still reports it, with its state, to whoever asks. A task or a memory given an address is not a rule and never arrives. What arrives is a name, an address and an **id**, never a body: the argument and the pattern text are a second read. *(`a rule with an address reaches the file about to be written`, `what does NOT reach the writing`)* |
| **A quiet edit means "no rule names this file"** | And that meaning is bought where it costs once: the opening document says how many of this project's rules have an address. Injecting "nothing governs this file" on every edit was the alternative, and it was refused with a number — the median session on the machine this was measured on edits 34 files, the p90 edits 121, and one edited 3,424, with every injection staying in the context for the rest of the session. **THE SENTENCE ABOVE IS NOW TRUE OF ONE CASE FEWER, and the difference is the point of the switch.** A quiet edit has THREE readings, not two: no rule names this file, the push was switched off, or the hook did not run. The opening document distinguishes the first two — when the push is switched off in the **committed** record it says so, naming who switched it and when, and it stops claiming that the rules arrive. **What this still does not buy, said plainly:** a switch recorded `--scope private` is invisible to that document (it carries the committed record, and a fact about one machine in a committed file would make `mnema brief \| diff - AGENTS.md` report a difference that is not the record's), and *"the hook did not run"* is not distinguishable from either. `mnema switch` is the reading that spans every tree, and it is where a private switch is ever spelled. |
| **It is a snapshot** | The opening context is: a decision accepted an hour into the session is not in what the `SessionStart` hook injected, and the live answer is one MCP call away. The per-edit hook is **not** a snapshot — it reads the record at the moment of the edit, so a rule accepted and addressed mid-session reaches the next edit it applies to. |
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

For the per-edit hook, ask about a path the way it does:

```sh
mnema rules src/billing/invoice.ts
```

The rules it reports as governing that path, minus any whose state is not in force, are
what a session is handed just before writing that file. Nothing there means nothing
arrives — which the opening document's address count is there to make readable.

And if you would rather it did not:

```sh
mnema switch                       # where each channel stands, and what each carries
mnema switch off edit-rules-push --reason "not while I am porting this"
```

That records a fact in your project's record — who switched it, when, and why if you said
why — and the next session's opening document says the push is off instead of implying it
had nothing to say. `mnema switch on edit-rules-push` puts it back.

## Layout

```
plugin/
├── .claude-plugin/
│   └── plugin.json          the manifest, and the MCP server declaration
├── hooks/
│   ├── hooks.json           two events: SessionStart, PreToolUse
│   └── session-start.mjs    runs `mnema brief`; silent when there is nothing to say
└── README.md
```

The handler is a wrapper rather than a bare `mnema brief` in `hooks.json` on purpose:
outside a project the verb refuses on stderr and exits 1, which is right for a command
a person typed and wrong for a hook that runs in every session on the machine. The
muteness belongs to the plugin; the verb stays as it is.

There is no second handler file, and that is the `PreToolUse` hook's whole shape: it is
`type: "mcp_tool"`, so the host calls a tool on the server declared right there in
`plugin.json` instead of starting a process. The one fragile thing about it is the NAME —
a hook names that server `plugin:mnema:mnema`, which is how this host spells a server a
plugin declares, and a hook that named it `mnema` would never be called and would say
nothing about it. Measured four ways, and the two files are checked against each other so
that renaming either half is a failing test rather than a plugin that looks installed and
does half of what it says.

## License

MIT, with the rest of [mnema](https://github.com/felipesauer/mnema).
