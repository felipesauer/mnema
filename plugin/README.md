# mnema: the plugin for agent hosts

The plugin is written for Claude Code, and the same folder carries what each of the other hosts reads
in its own form: VS Code's agent and Cursor's command-line agent read it as it is, Codex and GitHub
Copilot CLI read manifests and hooks files of their own here, and OpenCode and Gemini CLI get a
module and an extension from it. How far each host goes is [its rung](../docs/evidence.md#each-hosts-rung),
and how to install each is [the install page](../docs/install.md). This page describes Claude Code's
and says where the others part from it.

One installation, both surfaces. When a session opens, the project's **committed**
mnema record arrives in the agent's context without the agent asking for it, and beside it
the **notes** recorded for the project on this machine, the ones near the work first; at each edit, the rules of
the record **addressed at that file** arrive the same way, beside the result of that write,
in time for every edit after it and for a correction of that one; and while the session
runs, the mnema **MCP server** is connected, and says what its tools are for, so the
agent can read the rest and record its own work.

## Why it exists

The record was already there and the agent was not reaching for it. In a round
of 116 cells on 18 August 2026 (Claude Haiku 4.5), the arm that had the mnema server available never called a single
tool: `mcp_asked` was `false` in 20 of 20 instrumented cells, and it scored exactly
what the arm carrying no record at all scored. The arm that carried the same decision
in a file the host injects unasked conformed on every cell of the two tasks where the
bare arm conformed on none. That result is kept as history, with its day, model and
number of runs, in [how each claim is held](../docs/evidence.md).

So the finding was not *"the record does not help"*. It was *"the agent does not
ask"*, a different problem, with a different fix. This plugin is the fix: the same
document, delivered by the host instead of waited for.

## What it gives you

- **A `SessionStart` hook** that runs `mnema brief --hook` and hands the result to the
  session as opening context: the decisions in force and the patterns adopted in
  this project, each by name. Past 10,000 characters the host would replace the whole
  text with a file path it does not ask the model to open, so `--hook` stops at a whole
  rule inside that and ends by saying how many it left out and which read serves them.
  In Codex the ceiling is 2,500 of its tokens (4 UTF-8 bytes each), and the plugin's
  command for Codex asks for that cut (`--hook --host codex`). VS Code and Cursor are
  given the 10,000-character cut, and what each does past its own ceiling was not measured.
- **A second `SessionStart` hook** that runs `mnema recall --hook` and hands over the **notes**:
  the memories and observations recorded for the project, one line each, out of every
  tree this machine holds, the private one included: first the ones that share a word with
  what the session touches (the files changed in the working tree, the tasks in progress,
  the branch, the last three commits), then the newest. It is the
  half that makes a note worth writing: what an agent records here comes back to the next
  session without anybody asking. When another session wrote to the record in the last day and left a journal on
  this machine, a few lines above the notes say where it stopped (its goal, the decisions it recorded, what it left;
  `mnema switch off last-session` stops them). A project with nothing noted gets nothing from it. It is
  a hook of its own because the host caps what each hook adds at 10,000 characters, and
  two texts in one hook would share one cap.
- **A `PreToolUse` hook** on `Write|Edit|NotebookEdit` that hands over the rules
  **addressed at the file about to be written**, beside the result of that write, in time
  for every edit after it and for a correction of that one: the ones still in force, each
  with the address that matched and the id you would cite. It hands over **nothing** for a
  file no rule addresses, which is why the opening document says how many of this
  project's rules have an address, so a quiet edit means "none of them names this file"
  rather than "there is no mechanism". It is not a process: the host calls a tool on the
  MCP server this same plugin declares, which costs a call on an open connection instead
  of a command start. Measured on one machine (version 0.1.1, 21 October 2026, a sandbox, 50 runs
  each, without the real host): about 1 ms at the median per edit in Claude Code, and the
  server's own start, 270 to 350 ms, is paid once per session; Cursor and VS Code start a process
  per edit, about 200 ms at the median per edit where that process starts `mnema`. Where no tree
  holds a rule with an address, it no longer does (below), and it cost about 50 ms at the median in
  a second measurement (one machine under load, 21 October 2026, 50 runs). This hook has the same 10,000-character
  ceiling as the opening ones (read on Claude Code 2.1.281), so past it the rules stop at a whole one and the text
  says how many it left out and that `governing_rules` serves them all.
- **A second `PreToolUse` hook, for VS Code**, which pauses a write for a person where a rule
  of your record asks it to. VS Code's agent runs only command hooks, so this one is a process:
  it runs `mnema before-a-write --host vscode` on the write the host is about to make, and it
  answers with the same reason, and records the same facts, as the hook above does in Claude
  Code. It sits under a matcher of VS Code's own tool names, which Claude Code and Cursor apply
  and never match, so neither runs it; VS Code runs a plugin's command hook on every tool call
  whatever its matcher says, so a filter in the shell passes it only the tools that write, and a
  read costs a shell and nothing more.
- **A `Stop` hook**, `mnema tally`. When the session's own tool calls wrote a file in the last
  response, it prints one line saying how many files they wrote and how many
  decisions were recorded in this project since the session opened, counted off the transcript the
  host names and off the record. It is a count and not an instruction, it calls no model, and it
  records nothing. A subagent's calls are in a transcript of their own and are not counted, and the
  decisions are those of the project since the session's first line, so a second session of the same
  project in the same hours is counted too. The line is the reply's `systemMessage`; which host shows
  it, and to whom, was not measured. The same command keeps the session journal: a small file on this
  machine (outside the record, ids and counts and none of the session's words) that lets the next `Stop` read
  only the lines the host wrote since, and from which the MCP server gives a run its goal and closes it with an
  outcome (`mnema switch off session-journal` stops it; see
  [the reference](https://github.com/felipesauer/mnema/blob/main/docs/cli-reference.md#the-session-journal)).
- **A `SessionStart` hook that runs only after a compaction** (the `compact` matcher), `mnema recall
  --after-a-compaction`. It hands the conversation that continues one sentence, read from the session's journal: the
  decisions that entered the record since it opened (read from the record, by label and the state they have now), the notes copied, the questions answered with no decision after, the
  files its calls wrote; a count and the record's labels, none of the session's words. Nothing runs before a
  compaction, because the host discards what a hook says then. `mnema switch off after-a-compaction` stops it; see
  [the reference](https://github.com/felipesauer/mnema/blob/main/docs/cli-reference.md#after-a-compaction).
- **A `SubagentStart` hook**, `mnema brief --hook`. A subagent starts with a context of its own and
  does not see what the session was handed when it opened, so it is handed the same document: the
  decisions in force and the adopted patterns, by name, byte for byte what the opening hands over,
  under the event the host routes the reply by. It is the opening's channel and the opening's switch:
  `mnema switch off brief-document` stops both. Held against the real Claude Code binary by
  `a-subagent-starts-with-the-record.test.ts`; VS Code documents the event and reads this hooks file,
  and was not measured on it (`docs/evidence.md`, the presence map).
- **A `SubagentStop` hook**, `mnema handback`. A subagent hands the decisions it settled back in its
  final reply, and a reply that said only "done" lost them without a word. This asks the reply to end with
  one fenced block whose info string is `mnema-handback`, holding `{"decisions":[{"settled","why","turnedDown"}]}`,
  the list empty where it settled nothing, in the JSON Schema `mnema handback --schema` prints. A reply
  with no such block, or with one outside the schema, is sent back with the format as the reason (exit 2),
  once: the host's second stop of the same subagent is let through. It checks the shape and not whether the
  subagent settled something, calls no model and records nothing. Held against the real Claude Code binary
  by `a-subagent-is-sent-back-for-its-handback.test.ts`; the other hosts that read this hooks file were not
  measured on the event. `mnema switch off subagent-handback` stops it.
- **A `PostToolUse` hook after a question**, `mnema settled`. After the agent asked the person a
  question through `AskUserQuestion` and the answer came back, it hands the agent one sentence beside
  the answer: that a choice may have been settled there, and that `record_decision` records it with
  the options not taken as `alternatives`. It records nothing and reads which tool ran, never the
  answer. A shell in front of it starts no process for any other tool, because VS Code runs this
  file's hooks whatever their matcher says. Held against the real Claude Code binary by
  `a-settled-choice-reaches-the-model.test.ts`; the hooks files of Codex, Copilot CLI, Gemini CLI and
  OpenCode carry the same hook on their own question tools, documented and not measured. On until
  `mnema switch off choice-settled`.
- **A `Stop` hook that records corrections**, off until you switch it on (`mnema switch on
  user-corrections`). It runs `mnema corrections`, which reads the transcript the host names, its
  words, which no other part of this plugin reads, finds the prompts that open by correcting the
  agent (*no, …*, *stop …*, *do not …*, *that is wrong*, *use … instead*, in English and Portuguese)
  and the answers the person gave to a question of the agent (the option chosen in the host's question
  tool, or the prompt after a response that ended in a question mark, quoted with the question),
  and records each as a `proposed` decision in your machine's **private** tree, because what it
  quotes is a sentence typed into a conversation and not something written to be committed. Each
  proposal cites the session and the line, at most five are recorded at a `Stop`, and the same line
  is never recorded twice. A match is a pattern and not a judgement: that is why it is only
  proposed, and nothing is in force until a person accepts it. No model is called.
- **A `PostToolUse` hook after a write, in Claude Code**, that runs `mnema after-a-write`. A shell in
  front reads the path out of the payload and starts nothing for a path that can be neither of the two
  kinds below, so a common write costs that shell and no process (about 6 ms, measured on a loaded
  machine). **A note of Claude Code's own memory for this project** (`projects/<project>/memory/*.md`, `<project>`
  being the main working tree's path with every character but a letter or digit turned into `-`, as the host
  names it, so all worktrees of a repository share it; a note in another project's directory is not copied; under
  `$CLAUDE_CONFIG_DIR` or `~/.claude`, or the directory the `autoMemoryDirectory` setting names in your
  own settings or in the project's `.claude/settings.local.json`; the checked-in `.claude/settings.json`
  is ignored, as the host ignores it) is copied as a memory into your machine's **private** tree, with a
  marker naming the file and a hash of its content: once per content, and again when the note changes.
  It is on to begin with (`mnema switch off host-memory-mirror` stops it), the one part of this plugin that
  writes without anybody typing a verb and still begins on; it never copies the index
  `MEMORY.md` or a note of `type: user`, and never writes to the public tree. The agent is told the
  memory's id in one line beside the write, you in the `systemMessage`, and the count at `Stop` says how
  many notes were copied since the session opened. **A file that holds decisions** (under `docs/adr/`,
  `docs/decisions/` or an `adr/` directory; or a `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, a host's rules
  file, a plan, a handoff or a ledger whose new lines open as `Ruling:`, `Decision:` or a correction
  does) that the record cites nowhere gets one line beside the write naming the command that reads it
  (`mnema decision import <the directory or file>`, or `record_decision`), once per session and file, read off the transcript.
  Nothing is recorded for it. `mnema switch off decision-file-written` stops the line. **Known limits:** a
  project path longer than 200 characters is compared by its first 200, since the host cuts the name there
  and adds a hash this does not compute, so two such projects sharing those 200 are not told apart; and
  `*plan*.md` also matches a name like `explanation.md`, whose new lines still have to open as a decision does.
- **A hold on the first write of a session to a file a rule addresses**, off until you switch it
  on (`mnema switch on edit-first-write-gate`). With it on, the per-edit call into the server
  refuses that first write once, with the rules addressed at the file in the reason, so they
  arrive before the write rather than beside its result, and the same write, repeated, goes
  through. Another file under a rule is another first write; a file no rule addresses is never held;
  where a rule asks for a person, the person is asked and the write is not also refused. The server
  remembers the paths it held for as long as the connection lasts, so a session that reconnects is
  held once more. Each hold is recorded as a `channel.asked` citing the rule and the path, before
  the refusal is made, and the channel's service as one `channel.served` per run (mnema noting
  that it delivered the hook's answer, which is not a person's approval: an approval is the host's
  own prompt, and the record keeps no fact of it). It holds in
  Claude Code, which runs the call; VS Code's command door starts a process per write and has no
  session to remember a path by, so it does not hold. That the host refuses the write on `deny` and
  hands the reason to the model was read on each host ([how each claim is held](../docs/evidence.md)).
- **A `PostToolUse` hook after the `Agent` tool, and a `SessionEnd` hook, in Claude Code**, that run `mnema dispatched`: the work
  a session hands to other agents is kept in your machine's **private** tree as one task for the session (opened at its first
  dispatch, in progress) with a handoff on it for each dispatch, from `orchestrator` to the subagent type, whose brief is the
  call's short description and the path of a file the prompt cites when one exists; at the end of the session the task is moved to
  done with the count. **The prompt is never recorded**, nothing goes to the public tree, and it prints nothing to the model. It
  is on to begin with (`mnema switch off agent-mirror` stops it), keeps the task in the session journal (so it needs
  `session-journal` on; `mnema switch` says it does nothing while that is off), reopens the task of a resumed session, and
  never holds a dispatch: a failure is a line on the second stream, and a dispatch that could not take the journal's lock records
  nothing and is counted. Measured on the payload the host hands the hook, and not against a model. The other hosts that read this hooks file
  were not measured on either event.
- **Three skills**, which the host offers a model when a skill's description matches what the
  session is doing. `recording-decisions` is for the moment a choice between approaches is
  settled, an option is turned down, or a person says how something is done here: look first
  (`governing_rules`, `search`), then `record_decision` with the reasoning and what was turned
  down, and a note for what the project's code does not show. `recording-rulings` is for a workflow
  that keeps its rulings in a ledger thrown away when the work ends: each ruling is also recorded,
  as a proposal, and the ledger stays as it is. `diagnosing-recording` is for the question *why
  did this session record nothing*: it reads the host's own transcripts of the session and cites
  the line each finding comes from. A skill is text the host may load, and nothing here makes it
  load or makes the agent follow it: whether a session recorded is read off the record, and the
  measurements the `recording-decisions` table rests on are in its `references/`. A subagent
  dispatched for a task is told not to record and to hand its decisions back in its reply.
- **A switch for each of them.** `mnema switch` says where each stands and what each
  carries ([the table of every switch](../docs/switches.md)); `mnema switch off edit-rules-push` stops the per-edit push, `mnema switch off
  brief-document` stops the opening document, and `mnema switch off recall-document` stops
  the notes. <!-- generated: the channels that begin off --> All are on to begin with but two: `edit-first-write-gate` and `user-corrections`, below, are off until you switch them on. <!-- end --> The switch is a
  **fact of your record** rather than a setting (signed, attributed, dated and scoped)
  because turning something off is legitimate and turning it off in silence is not: a reader
  of the record has to be able to tell *"no rule addressed that file"* from *"somebody had
  turned the push off that week"*. It defaults to the **committed** tree, so the team reads
  it and the next session's opening document says so; `--scope private` is the switch that
  means this machine, and then only `mnema switch` can report it.
- **The mnema MCP server**, declared here so installing the plugin is all it takes:
  the agent gets the reads (`read_record`, `skills`, `search`, the audits) and the
  writes (tasks, decisions, patterns, memories, observations, handoffs) it already
  had, without a second entry in a settings file, and the instructions the server sends
  in the handshake, which a session reads before it has chosen a tool: when a decision or
  a note is worth recording, and what comes back. **Registering the server yourself as
  well** (`claude mcp add`, or an `mcpServers` entry) is redundant: the agent is offered
  every tool twice, under two prefixes, fifty-four names for twenty-seven tools.

## What it does, and what it does not

The two opening hooks are **reads**. They append nothing to the record, open no run, and
start no session of their own. The per-edit hook records that it served, and a write it
held for a person: the rows *"It can hold up a write"* and *"Every charge is a fact of
your record"* below say how. Every claim below names the case that holds it, in
[`the-record-arrives-unasked.test.ts`](../packages/code/tests/the-record-arrives-unasked.test.ts)
for the opening context and
[`the-rule-reaches-the-writing.test.ts`](../packages/code/tests/the-rule-reaches-the-writing.test.ts)
for the per-edit one. One thing neither file can hold is that the HOST calls them at all:
that was read against the real binary instead (Claude Code 2.1.228 and 2.1.281), and is not held by a
file of this repository yet ([how each claim is held](../docs/evidence.md)).

| Claim | What actually holds |
|---|---|
| **It injects the project's record** | Only what is **committed**: the tree a clone of the repository gets. A decision or a pattern recorded `--scope private`, or in your machine's global tree, governs your work and **is not in this document**. That is not a gap to route around: the document is the one `mnema brief > MNEMA.md` writes into a tracked file, except that a hook's copy leaves out the paragraph on how to regenerate that file (the session is handed the text, and has no use for how to regenerate the file) and stops at a whole rule where the file does not (the `>` replaces the whole of the file it names), and a private rule that travelled there would be the defect. Someone will record one and wonder where it went: this is where it went. *(`carries the committed record by name`)* |
| **It injects the rules** | It injects **names**, not bodies. A decision arrives as its title and its citable `ADR-<n>` label; a pattern arrives as its name. The argument behind a decision, what it turned down, and the text of a pattern are a **second read**: the agent asks `read_record` or `skills` about the one item that bears on the task, through the MCP server this same plugin declares. A file read on every prompt pays for its length every time. *(`carries the committed record by name`)* |
| **It hands over the notes, from every tree** | The second opening hook hands over what `mnema recall --hook` prints, byte for byte: the memories and observations, the ones that share a word with what the session touches first and the newest after, in an order the text names in one line, one line each (a memory by the start of its content, an observation by its topic), out of the committed tree, this machine's own and your personal one. **It is the one text the plugin pushes that carries the private tree**, because it is this machine's own session reading it and nothing of it is a file to commit; the document beside it still carries the committed record alone. A line that holds a credential in a recognized format arrives as the fact that the note exists, never its text. Where nothing is noted, nothing is handed over. *(`hands this machine’s notes to its session, the private tree too, one line each`, `says nothing where nothing is noted`, `says nothing at all when the notes channel is switched OFF`)* |
| **It says the record's words** | Byte for byte what `mnema brief --hook` prints, with no preamble and no cut of the plugin's own (the one cut there is, past a hook's ceiling, is the verb's, and the text says it): a second place deciding what governs the work is a second place that can come to disagree with the record. It is **not** unframed, and this row used to say it was: the document opens by saying whose text it carries: the project's own people and agents wrote it, and that sentence is decided in one place for every channel that puts record text in front of a model, so a second channel cannot word it differently. "No framing" was true of what the *handler* adds and was read as a claim that the text reaches the model undeclared. *(`hands over exactly what the verb prints`, `carries the declaration of the channel it says it is`)* |
| **It says what the session did, as a count** | At `Stop`, one line with two numbers (files the session's own tool calls wrote, decisions recorded since it opened) and nothing about what to do. Held by [`a-session-says-what-it-wrote.test.ts`](../packages/code/tests/a-session-says-what-it-wrote.test.ts): the counts against transcripts built in the host's shape, the line's words, silence for every other case, and the plugin's command run end to end. Where the host shows a `systemMessage` is not held. |
| **It is silent when it has nothing to say** | Outside a mnema project (which is most projects on most machines) the hook produces **no output and no error**, and the session opens exactly as it would without the plugin. The same is true of every other failure: `mnema` missing from the `PATH`, a record that will not read (at the opening; the gate before a write refuses over it, two rows below). **It is not silent about a record that does not chain, and that row used to say it was.** When the verb succeeds and still has something to say about the record (a tail that stops chaining, so the proof that nothing was inserted has failed), it says it on stderr, and the handler now hands that over under the document, byte for byte. The muteness was measured against a project with **no record**, where the verb exits non-zero; over a sound record stderr is empty, so no session of a healthy project gains a word. **And when you switch the document off**, by the same mechanism and with no new branch in the handler: the verb refuses on stderr with a non-zero exit, and every non-zero outcome here is silence. **It is not silent about a `mnema` that is another program**: a program of that name first on the `PATH` used to be run in its place, and the session opened with no record and no word. The hooks now ask it `mnema --identify` first; one that does not answer as `@mnema/code` is not run, and the session is told so, once. *(`says nothing at all where there is no project`, `says nothing at all when the document channel is switched OFF`, `says that the record does not chain, when it does not`, `names a program of the same name to the session instead of running it`)* |
| **It can hold up a write, and only where your own record says so** | **THIS ROW SAID "It never blocks", AND THAT HAS STOPPED BEING TRUE.** Rewritten rather than deleted, because what changed is one specific thing and the rest of the row was the reason it was safe to. When a rule of **your** record is linked to a path with `rel: "asks-for-a-person"`, the hook answers `permissionDecision: "ask"` and the host holds the write until somebody decides, naming the rule's id in what comes back. The other things it can do are the next row, and the once-only hold on a first write, which is off until you switch `edit-first-write-gate` on (row below). `allow` and a rewritten tool input are **not representable** in the reply's type, so those two refusals are not promises in this table. There is no heuristic anywhere in it: no "sensitive file", no inference from a path. A rule that only `governs` a path still just informs. **Three things worth knowing before you record one:** the verb that records the link now tells you how much of the working tree that address covers, as a fraction of the files it counted, which is worth reading because one segment of depth can change it tenfold; asking overrides every permission mode, `--permission-mode bypassPermissions` included, so `mnema switch off edit-asks-a-person` is the only way out and it is a separate switch from the one that stops the rules arriving; and in a headless session there is nobody to ask, so the call is refused and the reason goes to the model as an error. *(`the reply asks for a person, and only when the record does`, `the reply cannot express any decision but asking`, `goes quiet when edit-asks-a-person is switched off`)* |
| **It can refuse a write, and only where your own record says so** | When a rule of **your** record is linked to a path with `rel: "refuses-a-write"`, the write does not happen and the agent reads the rule's id and where it opens. **A gate that has nothing to answer with lets the write through**: with no `mnema` on the `PATH` the hook says nothing, and the write goes ([the limit, on its page](../docs/features.md)). **A `mnema` that is there and cannot answer refuses it where a rule addresses the path**, in Cursor's agent, Codex, VS Code, Copilot CLI, Gemini CLI and OpenCode: it exits non-zero, does not answer in ten seconds, prints what no host reads, or no `node` on the hooks' PATH takes it, and a rule in force (not one only proposed, rejected or superseded) that refuses a write or asks for a person at that very path is in the record; the reason says which and what to do, and any other path goes through. **Cursor's command-line agent puts the Node it carries (24.5.0 on 2026.09.18) first on the PATH of a plugin's hooks**, below the floor `mnema` takes (`^24.15.0 || >=26.0.0`): the hooks then run `mnema` on the first `node` further along that PATH that takes it, and where there is none they refuse as above instead of letting the write go. A hook whose own `node` cannot start, or whose handler files are missing, is read by the host as nothing to say, and the write goes. `mnema doctor` says which node it sees. **A record the gate cannot read refuses every write**: where a line of the record is one this mnema's reader refuses, as a newer mnema's line is, each write is refused with the tree and the line named, nothing is recorded, and that lasts until mnema is updated or the line is restored; a line of the project's public or private tree closes that project, and a line of the machine's global tree closes every project on the machine; switching the refusal off is no way round it, because the switch reads the same record. **Where a rule refuses a path and another asks for a person at it, the refusal wins** and nobody is asked, and it outranks the once-only hold on a first write too (the refusal is returned before the hold is looked at, so that hold never spends its pass on a write a rule refuses). It is one decision, made in one place, and each host is answered in its own shape: in **Claude Code** through the same call into the server (`deny`, with the rules' text not handed over beside a write that does not happen); in **VS Code** through the command that already asks (`deny`); in **Cursor's agent** through a command of its own, which runs only where `$CURSOR_VERSION` is set and which **only refuses**: that agent ignores `ask`, so a write that only asks goes through there, in silence, with nothing recorded. Read in all three, with no model, on 2 Oct 2026: the file was not written, the reason reached the agent, and the fact was recorded. In Claude Code and VS Code that is held by [`a-refusal-and-a-pause-hold-the-write.test.ts`](../packages/code/tests/host-contract/a-refusal-and-a-pause-hold-the-write.test.ts) and [`an-editor-holds-or-refuses-the-write.vscode.test.ts`](../packages/code/tests/host-contract/an-editor-holds-or-refuses-the-write.vscode.test.ts), which start the real host against a stand-in for its model; in Cursor it was read by hand and is not held by a file of this repository yet. Of Cursor's tools only `Write` has been measured; the others it may use to change a file are not covered. A refusal leaves nobody a way through at the host: `mnema switch off edit-refuses-a-write` is the way out, it is a switch of its own, and it is recorded (not over a record the gate cannot read, above). *(`denies where a rule refuses, citing it, and records the refusal first`, `the refusal wins over an asking at the same path, and nobody is asked`, `a write that only asks is let through in silence, with nothing recorded`, `refuses even when the refusal cannot be recorded`)* |
| **Every charge is a fact of your record** | The asking is an event before it is a charge: one `channel.asked` per rule that asked (or one `channel.refused` per rule that refused; the first-write hold records its own `channel.asked`), citing the rule and the path, appended and signed **before** the reply is composed. The charge does not depend on the fact: a rule that refuses or asks does so even when the record cannot take the fact, after waiting up to 7 s for a busy record, and then the reason says the fact could not be recorded and the record does not show it. The push that only informs records one `channel.served` per session and per channel, which is what makes a quiet edit readable. That fact counts what is pushed **at an edit** and nothing else: the two opening texts are reads and are not counted, so a session with no `channel.served` says nothing about whether they arrived. Both travel with the repository by default. *(`the asking is a FACT, and the service is one too`)* |
| **The rules reach the file about to change** | Only the rules with an **address** (a path someone linked them to with `rel: "governs"`) and only the ones **still in force**. A superseded decision that addresses the file does not arrive; `governing_rules` still reports it, with its state, to whoever asks. A task or a memory given an address is not a rule and never arrives. What arrives is a name, an address and an **id**, never a body: the argument and the pattern text are a second read. *(`a rule with an address reaches the file about to be written`, `what does NOT reach the writing`)* |
| **Corrections are recorded as proposals, only if you switch it on** | `user-corrections` is off until a tree switches it on, and `mnema switch` says so. On, a `Stop` records each opening that corrects the agent as a `proposed` decision in the private tree, citing the session and the line, once. The reply carries a count and the ADR labels and none of the person's words. Held by [`a-correction-becomes-a-proposal.test.ts`](../packages/code/tests/a-correction-becomes-a-proposal.test.ts): a probe per opening and the look-alikes that are not, once-only, the cap of five, silence while off, and the plugin's command run end to end. Not held: that every correction is found, or that a match is one: it is a net, and a person rules. |
| **A note of the host's memory is copied, unless you switch it off** | `host-memory-mirror` is on until a tree switches it off. On, a write to Claude Code's memory directory copies the note into the private tree once per content; the index and a note about the person are never copied. A write to a file that holds decisions the record does not cite gets one line, once per session and file, and records nothing. Held by [`what-a-write-means-to-the-record.test.ts`](../packages/code/tests/what-a-write-means-to-the-record.test.ts): the directory under `$CLAUDE_CONFIG_DIR` and `autoMemoryDirectory`, the exclusions, once per content, private only, silence while off, a table of decision paths, and the hooks file's command run end to end. In the real Claude Code 2.1.281, against a stand-in for its model, [`a-note-of-the-hosts-memory-is-copied.test.ts`](../packages/code/tests/host-contract/a-note-of-the-hosts-memory-is-copied.test.ts) holds that the host runs the shell as written, the note is copied, and the line reaches the model inside the result of the write. Not held: any other host, and the line beside a decision file in a host. |
| **The first write can be held once, and only if you switch it on** | `edit-first-write-gate` is off until a tree switches it on, and `mnema switch` says so (*off until switched on: `mnema switch on edit-first-write-gate`*). On, the first write of a connection to a path a rule addresses is answered with `permissionDecision: "deny"` and the rules in the reason, and the same write repeated is not held. It is a fact first: one `channel.asked` per rule, appended before the refusal. Held by [`the-first-write-is-held-once.test.ts`](../packages/code/tests/the-first-write-is-held-once.test.ts) and `the reply cannot express any decision but asking`. Not held: that the host reads the refusal as it was read, in any host but Claude Code 2.1.281, VS Code 1.137 and Cursor's command-line agent 2026.09.18, where it was read. |
| **A quiet edit means "no rule names this file"** | And that meaning is bought where it costs once: the opening document says how many of this project's rules have an address, **and how many of them ask for a person**. Injecting "nothing governs this file" on every edit was the alternative, and it was refused with a number: the median session on the machine this was measured on edits 34 files, the p90 edits 121, and one edited 3,424, with every injection staying in the context for the rest of the session. **THE SENTENCE ABOVE IS NOW TRUE OF ONE CASE FEWER AGAIN.** A quiet edit has FOUR readings, not three: no rule names this file, the rules were switched off, the gate was switched off, or the hook did not run. The opening document distinguishes the first three: when either is switched off in the **committed** record it says so, naming who switched it and when, and it stops claiming that the rules arrive or that anything waits. **What this still does not buy, said plainly:** a switch recorded `--scope private` is invisible to that document (it carries the committed record, and a fact about one machine in a committed file would make `mnema brief \| diff - MNEMA.md` report a difference that is not the record's), and *"the hook did not run"* is not distinguishable from either. `mnema switch` is the reading that spans every tree, and it is where a private switch is ever spelled. |
| **It is a snapshot** | The opening context is: a decision accepted an hour into the session is not in what the `SessionStart` hook injected, and the live answer is one MCP call away. The per-edit hook is **not** a snapshot: it reads the record at the moment of the edit, so a rule accepted and addressed mid-session arrives at the next edit it applies to, beside the result of that write. |
| **It proves nothing on its own** | The proof is the record's: `mnema verify` is what rules on the chain, and the plugin neither strengthens nor weakens it. What arrives in the context is a **projection**: throw it away and the next session builds it again. |

## Install

The plugin runs the `mnema` binary, so that has to be on your `PATH` first:

```sh
npm i -g @mnema/code
# or, if your global binaries live under pnpm:
pnpm add -g @mnema/code
```

The [install page](../docs/install.md) has the steps for a Node installed by the system, and `npm view @mnema/code version`
says which version the registry serves.

Then add this repository as a marketplace and install from it:

```sh
claude plugin marketplace add felipesauer/mnema
claude plugin install mnema@mnema
```

The plugin connects the MCP server itself. If you had registered it yourself before, that
entry is now redundant: with both, a session is offered every tool twice, under two
prefixes.

Requires Node 24.15.0 or a later 24, or 26.0.0 or later. Nothing here reaches the network, and nothing here writes.

## Check that it worked

The hook hands over what the verb prints, so the verb is how you see it:

```sh
cd your-project
mnema brief --hook
```

What that command prints is what the agent is handed at the start of the next
session. If it refuses with `No mnema project here`, the hook stays quiet: run
`mnema init` if this project should have a record. If it answers that `mnema brief` does not
take `--hook`, the `mnema` on your PATH is older than this plugin: the hook asks it again
without the flag and hands over what `mnema brief` prints, whole, past the host's ceiling, a
file path the model is not asked to open. Updating `@mnema/code` brings the cut back. The notes handed over beside it are
what this prints, nothing at all, until something is noted:

```sh
mnema recall --hook
```

Before either verb, the hooks ask the `mnema` they found which program it is:

```sh
mnema --identify
```

`@mnema/code` answers with its package name and version. Another program of the same name
first on the `PATH` (the earlier `mnema` alpha is one) answers something else, and then the
plugin does not run it: the session opens told that the `mnema` on its `PATH` is not
`@mnema/code`, with what it answered, instead of opening with no record and no word about
why. The MCP server the plugin declares is started by the host, not by the hooks, so it still
runs that program; `which -a mnema` lists every `mnema` on the `PATH`, and the plugin runs the
first.

### A plugin and a `mnema` of different versions

The two are installed apart, so one can be updated without the other. A `mnema` **older** than
the plugin is the pair that breaks: the plugin may ask it for something it never learned. The
hook that hands over the document answers `mnema --identify` with its version and, when it is
older than the plugin's (the version in `.claude-plugin/plugin.json`), adds one line after the
document, or alone where that binary printed nothing, saying so and giving the command that
fixes it: `npm i -g @mnema/code@<the plugin's version>`. The hook still exits 0 and blocks
nothing, and the line is context for the session, not a message the host shows a person on its
own. A `mnema` **newer** than the plugin keeps every flag it took, so that pair works and nothing
is added. The hook before a write is not told: it never says anything the host would not read as
a reply. `mnema doctor` compares the version of the plugin Claude Code lists as installed with its
own and says which side to update, with the command; it only reads.

### Running a particular `mnema`

By default the plugin runs the first `mnema` on the `PATH`. To run another (one outside the
`PATH` the host starts with, or ahead of a namesake) give its absolute path to the plugin's
`mnema_path` option (Claude Code asks for it when the plugin is enabled, and lists it in
`/config`; leaving it as `mnema` keeps the `PATH`). Claude Code hands the value to the hooks as
`CLAUDE_PLUGIN_OPTION_MNEMA_PATH` and to the MCP server through a small launcher
(`server/launch.mjs`, run with `node`), which starts the binary and passes the arguments, the
standard streams and the exit code through. The option does not change what is checked: the hooks
still ask the program they run which one it is. Both plugins in this repository carry the option.
Only Claude Code's handling of `userConfig` was read from its documentation; whether VS Code and
Cursor offer the option was not measured, and where a host leaves the placeholder as it was, the
launcher runs the `PATH`'s `mnema`.

### Signing as an agent

The plugin's second option, `agent_key`, is empty: the server signs with the key the option names, else the one a `MNEMA_AGENT_KEY` in the environment names, else your own. Give it the
name of an agent key (`mnema key request --agent <name> --anchor <identity>`, then `mnema key enroll
--agent <the line>` where your own key is, which enrols it in the project's committed, private and
global trees) and the server signs with that key in each tree whose record enrols it, naming the agent
the record gives it on everything it records. The
manifest passes it as `MNEMA_PLUGIN_AGENT_KEY` and the launcher makes it the server's `MNEMA_AGENT_KEY` when it holds a name, so
a `MNEMA_AGENT_KEY` in the environment you started the host with stands while the option is empty, and a `mnema` from before
the option still gets the variable it knows. One manifest
is read by Claude Code, VS Code and Cursor, so no name is filled in for you; Codex, Copilot CLI and
Gemini CLI read a manifest of their own, which names the host (`codex`, `copilot`, `gemini`), and the
hook files of VS Code, Cursor, Codex, Copilot CLI, Gemini CLI and OpenCode pass the host's name to
`mnema before-a-write --agent-key`, asked again without it of a `mnema` that does not know it. Where
the record of a tree enrols no key under that name, the server says so on its error stream, once for
each such tree, and signs there with your own, and what it records is declared, not attested; where your
own key is protected and `MNEMA_KEY_PASSPHRASE` is not in the environment, or is not on this machine, that write is
refused and nothing is signed, and the server still opens and serves what it reads, and the refusal names the verb `key enroll --agent` (in the hook what is not done is
the recording of the fact: the reply to the host is unchanged and says why). That a host passes a manifest's `env` to the server
was measured on Claude Code, Codex, Copilot CLI and Gemini CLI ([the evidence page](../docs/evidence.md)), and not on VS Code
and Cursor; that those two hand the server the `agent_key` option was not measured either; `mnema doctor` says what a machine holds. What a
host's sandbox leaves of the key's folder to the model is in
[the sandbox section of the agent hosts page](../docs/agent-hosts.md#signing-as-an-agent-inside-a-sandbox).

For a host this plugin has no manifest for, add `--agent-key <name>` to the server's command in the host's
user configuration, not in a project's: a host's project configuration is what the model writes, so the
choice of key does not go there.

For the per-edit hook, ask about a path the way it does:

```sh
mnema rules src/billing/invoice.ts
```

The rules it reports as governing that path, minus any whose state is not in force, are
what a session is handed at each edit of that file, beside the result of that write.
Nothing there means nothing arrives, which the opening document's address count is there
to make readable.

And if you would rather it did not:

```sh
mnema switch                       # where each channel stands, and what each carries
mnema switch off edit-rules-push --reason "not while I am porting this"
```

That records a fact in your project's record (who switched it, when, and why if you said
why) and the next session's opening document says the push is off instead of implying it
had nothing to say. `mnema switch on edit-rules-push` puts it back.

For guidance on porting mnema to a host that is not yet supported, see [porting-to-a-host.md](porting-to-a-host.md): it covers the MCP server setup, host-specific hooks, and what the product already handles.

## In VS Code and Cursor

The plugin is written in Claude Code's format, and two other hosts read that format.
What each one runs of it:

| | Claude Code | VS Code's agent | Cursor's command-line agent |
|---|---|---|---|
| **The MCP server** | connected, in the project the session has open | connected, in the project the window has open | connected once you approve it, in the project of the directory Cursor starts it in: Cursor announces no workspace folders, so that directory is what the server goes by |
| **What the server says its tools are for** | reaches the session | reaches the model in the families whose prompt carries a server's instructions; in the ones whose prompt does not, the Codex models among them, the opening below is what arrives | reaches the model beside the names of the server's tools; each tool's own description arrives only when the model looks that tool up |
| **The opening: the document and the notes** | handed to every session | handed to every session, whatever model it runs | both hooks run, and their text reaches the model |
| **The rules at each edit** | handed over beside the result of that write, and recorded as served | not run: it is an `mcp_tool` hook, a type Claude Code runs and the other two do not, and no command hook of the plugin's carries them instead: VS Code would put a hook's text inside the result of the tool (measured), but the push records that it served once per session, and a process started for each write has no session to remember that by. VS Code gets the pause for a person, below, and not the rules | not run, for the same reason |
| **A write paused for a person, where a rule asks** | yes, through the same `mcp_tool` hook | **yes**, through the plugin's command hook: the write waits for a person, and the asking is recorded as it is in Claude Code | **no**: the agent runs the hook before its write and **ignores** `ask` (the file was written) while it honors `deny` |

**What a write costs there.** In VS Code and Cursor the gate is a process started for each write. Its handler first reads
the stored lines of the project's committed record, of its private tree on this machine and of the machine's global tree,
and where none of them holds a link under `governs`, `asks-for-a-person` or `refuses-a-write`, it answers what `mnema`
would answer there, nothing, without starting `mnema`. A tree it cannot list, or a line it cannot read the way `mnema` reads
it, starts `mnema` as before, so a record `mnema` cannot read still refuses every write. It keeps nothing between two writes:
a rule that arrives with a `git pull` is met at the next write.

**How each loads it.** VS Code's agent loads it from a folder listed in its
`chat.pluginLocations` setting, which is the route these rows were measured on. Without that
setting it loads nothing: no hook runs and the agent works as if mnema were not there. Cursor's
command-line agent loads it on its own from the Claude Code installation on the same
machine, with Cursor's import of third-party plugins on, which is how it ships.

**To have VS Code's agent load it,** in this order:

1. Install the plugin in Claude Code (`claude plugin marketplace add felipesauer/mnema`, then
   `claude plugin install mnema@mnema`). That leaves a copy of the plugin in the marketplace
   folder, `~/.claude/plugins/marketplaces/mnema/plugin`.
2. Run `mnema doctor` and read its `vscode` line: it says whether your `settings.json` has
   `chat.pluginLocations`, and whether it lists a mnema plugin that exists and is this version.
3. If it says to, run `mnema doctor --fix vscode`. It is the only thing `doctor` writes, it
   runs only when you type it, and `--dry-run` shows what it would change without writing.
   It copies `settings.json` to a file beside it first, keeps your comments and the rest of the
   file as it is, adds the marketplace folder above to `chat.pluginLocations` and removes an
   entry that points into a versioned folder of Claude Code's plugin cache, and a second run
   changes nothing. A file it cannot edit safely it refuses, and says why; then add the entry by
   hand.

That folder is the one listed because its path does not carry the plugin's version, so it is the
same after an update; a versioned cache path stops working at the next one. After a plugin
update, `claude plugin marketplace update mnema` brings that folder to the new version, and
`mnema doctor` says when it is behind. VS Code marks `chat.pluginLocations` as experimental
(*may be unstable, subject to change or removal*), so the setting itself may change. The path
was chosen from VS Code 1.137's own code, which resolves each listed folder as a directory and
recognises a Claude plugin by its `.claude-plugin/plugin.json`; it was not run against a live
window.

**Where the table stops.** It was measured with VS Code 1.137 and its Copilot Chat 0.65,
and with Cursor's command-line agent 2026.09.18, not Cursor's editor, which is in the host table at
the first rung, from its documentation alone, until somebody reads it with
[the script kept for that](captures/cursor-ide-script.md), and Antigravity's command line is there on
the same footing ([its script](captures/antigravity-cli-script.md)). The last row was
measured on 30 Sep 2026 against each host with no model and no network (a stand-in model in
VS Code, a stand-in backend for Cursor's agent) with the plugin of this repository and the
built binary; none of it is held by a file of this repository yet ([how each claim is held](../docs/evidence.md)).
A hook's text lands inside the result of the tool in VS Code; whether the hook's reason is put in
front of the person who decides, and what the confirmation shows, was not read from the screen. On Cursor's side it
was measured on the free plan with the `Auto` model, the only model used: the server's
instructions and both opening texts are in the prompt Cursor's servers assembled for the
model, read back from the chat the agent keeps on the machine
(a session of 23 September 2026), the instructions whole,
but for the indentation of their continuation lines, which arrives as a single space,
and the model called the server's tools. That the server there goes by the directory
Cursor starts it in is this product's rule and is held by a case of its own
([`a-client-that-names-no-workspace.test.ts`](../packages/code/tests/a-client-that-names-no-workspace.test.ts)).

## The server without the hooks

The marketplace carries a second plugin, `mnema-server-only` (`plugin-server-only/`), for whoever
wants the MCP server and the command line and nothing the hooks hand over: it declares the same
`mnema mcp` and runs no hook and installs no skill. With it, the record is not put into the session
as it opens, no rule comes beside an edit, no pause for a person or refusal of a write is asked or
made at one (a rule that says so is still in the record, and nothing at the host acts on it), and no
count or correction is taken at the end of a response. The agent keeps every tool of the server,
and you keep every command. Install one of the two and not both: they declare the same server, and a
session would be offered every tool twice.

```sh
claude plugin install mnema-server-only@mnema
```

## Layout

```
plugin/
├── .claude-plugin/plugin.json   Claude Code's manifest (VS Code's agent and Cursor read it too)
├── .codex-plugin/plugin.json    Codex's manifest, naming hooks/codex.json
├── .github/plugin/plugin.json   Copilot CLI's manifest, naming hooks/copilot.json
├── hooks/
│   ├── hooks.json               Claude Code's hooks, and VS Code's and Cursor's beside them:
│   │                            SessionStart, PreToolUse, PostToolUse, Stop,
│   │                            SubagentStart, SubagentStop
│   ├── hooks.ids.json           a stable id for each hook of hooks.json
│   ├── codex.json               Codex's hooks: SessionStart, PreToolUse, PostToolUse
│   ├── copilot.json             Copilot CLI's hooks: SessionStart, PreToolUse, PostToolUse
│   ├── hand-over.mjs            the rule the handlers follow: run a verb, or say nothing
│   ├── session-start.mjs        runs `mnema brief --hook`; silent when there is nothing to say
│   ├── session-recall.mjs       runs `mnema recall --hook`; silent when nothing is noted
│   ├── session-tally.mjs        the count at the end of a response, and the session's journal
│   ├── session-compacted.mjs    what entered the record in the session, after a compaction
│   ├── session-corrections.mjs  the corrections at the end of a response
│   ├── after-a-write.mjs        the copy of the host's memory, and the line beside a decision file
│   ├── agent-dispatched.mjs     runs `mnema dispatched` after the agent tool and at the end of a session
│   ├── edit-asks-a-person.mjs   the gate of the hosts that run commands and can pause a write
│   ├── edit-refuses-a-write.mjs the gate of the hosts that run commands and only refuse
│   ├── choice-settled.mjs       runs `mnema settled` after a question to the person is answered
│   ├── subagent-start.mjs       runs `mnema brief --hook` when a subagent starts
│   └── subagent-stop.mjs        runs `mnema handback` when a subagent stops
├── opencode/mnema.js            OpenCode's plugin module, copied into a project
├── gemini/                      Gemini CLI's extension: its manifest, context file, hooks file and script
├── skills/                      the three skills the plugin installs
├── server/launch.mjs            starts `mnema mcp` from the binary the plugin is set to
├── captures/                    the scripts that read a host by hand, where no job can
├── porting-to-a-host.md         how a new host is added
└── README.md
```

The hooks files, the manifests, the OpenCode module and the Gemini extension are generated from
the host table, `packages/code/src/host-names.ts`, and a test is red when one was edited by hand.

The handler is a wrapper rather than a bare `mnema brief` in `hooks.json` on purpose:
outside a project the verb refuses on stderr and exits 1, which is right for a command
a person typed and wrong for a hook that runs in every session on the machine. The
muteness belongs to the plugin; the verb stays as it is.

There are two handler files, one per text a session opens with, and the rule that decides
when they say nothing is written once, in `hand-over.mjs`. The `PreToolUse` hook has no
file at all, and that is its whole shape: it is
`type: "mcp_tool"`, so the host calls a tool on the server declared right there in
`plugin.json` instead of starting a process. The one fragile thing about it is the NAME:
a hook names that server `plugin:mnema:mnema`, which is how Claude Code 2.1.228 spells a
server a plugin declares, and a hook that named it `mnema` would never be called and would say
nothing about it. Read against that host (not held by a file of this repository yet), and the two files are checked against each other so
that renaming either half is a failing test rather than a plugin that looks installed and
does half of what it says.

**AND A THIRD HANDLER, FOR THE HOST THAT CANNOT MAKE THAT CALL.** This paragraph said the
`PreToolUse` hook has no file, and the one Claude Code runs still has none. VS Code's agent drops
an `mcp_tool` hook without a word and runs only commands, so the pause for a person reaches it
through `edit-asks-a-person.mjs`, which hands the host's payload to `mnema before-a-write --host
vscode` and hands its answer back, byte for byte. Which rules ask, and the reason the person
reads, are decided in the one place the `mcp_tool` hook's tool decides them, so the two hosts
cannot come to stop different writes.

## License

Apache-2.0, with the rest of [mnema](https://github.com/felipesauer/mnema).
