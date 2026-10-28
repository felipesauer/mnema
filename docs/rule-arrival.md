# Where a rule arrives

A rule that lives in a file, or in the record, does something only if the host puts its text in
front of the model. This page says, for each host the repository starts without an account and
without a model, whether it does, in which place the rule is kept, and at which moment of a
session. Nothing here says that the model reads the rule or follows it: a request shows what was
put in front of the model, never what it made of it.

## What was measured

One rule carries a **sentinel**, a word that nothing the host or the product sends contains
(`quillfeather-7731`), and the measurement is whether the sentinel is in a request the host sends
to its model. The host is the real binary, unmodified, in a network namespace that holds only
loopback, against a stand-in for its model that answers what the case scripts. The same cases run
for the version the workflow pins on every pull request and for the newest one every week; the
version is in each run's "Host measured" summary, and a host that changes what it does turns that
host's job red.

**Where the rule is kept** (the rows):

- **No rule anywhere**, the control. It must be absent at every moment of every host, or what the
  instrument sees does not come from the rule.
- **In `AGENTS.md`.**
- **In the host's own instructions file**: `.claude/rules/` for Claude Code, a
  `.github/instructions/*.instructions.md` that applies to every file for Copilot CLI,
  `GEMINI.md` for Gemini CLI, `QWEN.md` for Qwen Code. Codex and OpenCode read `AGENTS.md` as
  their own, so for them this row is the one above.
- **Behind an import**: a file the instructions file names with `@`, where the rule is in the
  named file (`CLAUDE.md`, `GEMINI.md` or `QWEN.md` where the host has one, otherwise `AGENTS.md`).
- **Behind a mention**: the same file says in prose where the rules are, and the rule is only in
  the file it names. The case also requires that the sentence of the mention reached the model, so
  that "not arrived" is not a file the host never read.
- **In the mnema record**: a decision in force that governs a path, with the plugin or server of
  mnema configured the way the host contract already does.

**The moments** (the columns):

- **Start**: the first request of the work. For OpenCode that is the first one that offers a tool,
  since it asks the model for a title before.
- **Late**: a session of three calls to the shell, one per turn, and the request that carries the
  most results the host sent before it asked for a summary or, where it asked for none, its last.
  Supposed by nobody: a host sends its conversation again with each request, and this reads it.
- **After a compaction**: the stand-in tells the host, in the usage of the turn that answers the
  third call, that the window is full (and, where the host decides by a limit of its own that it
  lets a person set, Claude Code, Codex and OpenCode, the limit is set small); the host asks for
  a summary of the conversation, and the stand-in answers with a text of its own **that does not
  hold the rule**. What the next request carries of the rule is what the host or the product put
  back; the case proves that request is the compacted conversation by what it carries of the
  summary and of the results. A `gemini -p` run has one turn of the person and its compression
  finds nothing to compress before a second one, so for Gemini CLI the case takes a second run that
  resumes the session (`--resume`): the host restores the conversation, compacts it, and what the
  request after the summary carries includes what the resumed session's own start put in front of
  the model again. That reading says nothing about a compaction in a session that was never resumed
  ([the case](../packages/code/tests/host-contract/the-rule-arrives.gemini.test.ts)).
- **At an edit**: a write that is permitted and that a rule only governs. The rule arrives if it
  is in the result of the write, or beside it. A refusal is another thing, held by the cases that
  open and refuse in each host (`*-opens-and-refuses.*.test.ts`), and a rule kept in a file has no
  channel at a write.

The four words in a cell: **arrived**, **not arrived** (a reading was made and found nothing),
**not applicable** and **not measured**, each of the last two with its reason in the note under the
table. A reading that was made under a condition (Gemini CLI's after a compaction, in a resumed
session) carries a note too.

## The table

<!-- BEGIN the table: generated from packages/code/tests/host-contract/support/the-arrival-table.ts, and held by the-arrival-page-is-the-table.test.ts. Change the table there and run `pnpm vitest run packages/code/tests/the-arrival-page-is-the-table.test.ts -u`. -->

### Claude Code

| Where the rule is kept | start | late | after a compaction | at an edit |
|---|---|---|---|---|
| no rule anywhere (the control) | not arrived | not arrived | not arrived | not applicable (note 1) |
| the rule in `AGENTS.md` | arrived | arrived | arrived | not applicable (note 1) |
| the rule in the host's own instructions file | arrived | arrived | arrived | not applicable (note 1) |
| the rule in a file the instructions file imports with `@` | arrived | arrived | arrived | not applicable (note 1) |
| the rule in a file the instructions file only mentions | not arrived (the mention did) | not arrived | not arrived | not applicable (note 1) |
| the rule in the mnema record, addressed at a path | arrived | arrived | arrived | arrived |

1. Not applicable: a file is read when the session opens and has no channel at a write; the late column says whether it is still in front of the model

### Codex

| Where the rule is kept | start | late | after a compaction | at an edit |
|---|---|---|---|---|
| no rule anywhere (the control) | not arrived | not arrived | not arrived | not applicable (note 1) |
| the rule in `AGENTS.md` | arrived | arrived | arrived | not applicable (note 1) |
| the rule in the host's own instructions file | not applicable (note 2) | not applicable (note 2) | not applicable (note 2) | not applicable (note 2) |
| the rule in a file the instructions file imports with `@` | not arrived | not arrived | not arrived | not applicable (note 1) |
| the rule in a file the instructions file only mentions | not arrived (the mention did) | not arrived | not arrived | not applicable (note 1) |
| the rule in the mnema record, addressed at a path | arrived | arrived | arrived | not arrived |

1. Not applicable: a file is read when the session opens and has no channel at a write; the late column says whether it is still in front of the model
2. Not applicable: the instructions file Codex reads is `AGENTS.md`, the place above

### OpenCode

| Where the rule is kept | start | late | after a compaction | at an edit |
|---|---|---|---|---|
| no rule anywhere (the control) | not arrived | not arrived | not arrived | not applicable (note 1) |
| the rule in `AGENTS.md` | arrived | arrived | arrived | not applicable (note 1) |
| the rule in the host's own instructions file | not applicable (note 2) | not applicable (note 2) | not applicable (note 2) | not applicable (note 2) |
| the rule in a file the instructions file imports with `@` | not arrived | not arrived | not arrived | not applicable (note 1) |
| the rule in a file the instructions file only mentions | not arrived (the mention did) | not arrived | not arrived | not applicable (note 1) |
| the rule in the mnema record, addressed at a path | arrived | arrived | arrived | not arrived |

1. Not applicable: a file is read when the session opens and has no channel at a write; the late column says whether it is still in front of the model
2. Not applicable: the instructions file OpenCode reads is `AGENTS.md`, the place above

### GitHub Copilot CLI

| Where the rule is kept | start | late | after a compaction | at an edit |
|---|---|---|---|---|
| no rule anywhere (the control) | not arrived | not arrived | not measured (note 1) | not applicable (note 2) |
| the rule in `AGENTS.md` | arrived | arrived | not measured (note 1) | not applicable (note 2) |
| the rule in the host's own instructions file | arrived | arrived | not measured (note 1) | not applicable (note 2) |
| the rule in a file the instructions file imports with `@` | arrived | arrived | not measured (note 1) | not applicable (note 2) |
| the rule in a file the instructions file only mentions | not arrived (the mention did) | not arrived | not measured (note 1) | not applicable (note 2) |
| the rule in the mnema record, addressed at a path | arrived | arrived | not measured (note 1) | not arrived |

1. Not measured: with `copilot -p` the host asks for its summary at the end of the run and the run ends; a second run that resumed the session sent the whole conversation again, the results and not the summary, so no request of a compacted conversation was seen
2. Not applicable: a file is read when the session opens and has no channel at a write; the late column says whether it is still in front of the model

### Gemini CLI

| Where the rule is kept | start | late | after a compaction | at an edit |
|---|---|---|---|---|
| no rule anywhere (the control) | not arrived | not arrived | not arrived (note 1) | not applicable (note 2) |
| the rule in `AGENTS.md` | not arrived | not arrived | not arrived (note 1) | not applicable (note 2) |
| the rule in the host's own instructions file | arrived | arrived | arrived (note 1) | not applicable (note 2) |
| the rule in a file the instructions file imports with `@` | arrived | arrived | arrived (note 1) | not applicable (note 2) |
| the rule in a file the instructions file only mentions | not arrived (the mention did) | not arrived | not arrived (note 1) | not applicable (note 2) |
| the rule in the mnema record, addressed at a path | arrived | arrived | arrived (note 1) | not arrived |

1. Resumed: read in a second run that resumes the session (`--resume`), which starts the session again: it says nothing about a compaction in a session that was never resumed
2. Not applicable: a file is read when the session opens and has no channel at a write; the late column says whether it is still in front of the model

### Qwen Code

| Where the rule is kept | start | late | after a compaction | at an edit |
|---|---|---|---|---|
| no rule anywhere (the control) | not arrived | not arrived | not arrived | not applicable (note 1) |
| the rule in `AGENTS.md` | arrived | arrived | arrived | not applicable (note 1) |
| the rule in the host's own instructions file | arrived | arrived | arrived | not applicable (note 1) |
| the rule in a file the instructions file imports with `@` | arrived | arrived | arrived | not applicable (note 1) |
| the rule in a file the instructions file only mentions | not arrived (the mention did) | not arrived | not arrived | not applicable (note 1) |
| the rule in the mnema record, addressed at a path | arrived | arrived | arrived | not arrived |

1. Not applicable: a file is read when the session opens and has no channel at a write; the late column says whether it is still in front of the model

<!-- END the table -->

## What each host did

<!-- BEGIN the prose: generated from the table above by renderTheProse in the-arrival-table.ts, and held by the-arrival-page-is-the-table.test.ts. What a person writes per host is only the mechanism, in THE_MECHANISM there, and it may not say whether a rule arrived. -->

- **Claude Code.** The rule in `AGENTS.md`, in the host's own instructions file and behind an `@` import arrived at the start, late and after a compaction. The rule in a file that is only mentioned did not arrive at the start, late and after a compaction (the sentence that mentions the file did, at the start). The rule in the mnema record arrived at the start, late, after a compaction and at an edit. The files are read into the block the host opens its first message with; the record is put there by the plugin's `SessionStart` hook, which runs again after a compaction, and by a hook that runs beside the result of a write.
- **Codex.** The rule in `AGENTS.md` arrived at the start, late and after a compaction. The rule behind an `@` import did not arrive at the start, late and after a compaction. The rule in a file that is only mentioned did not arrive at the start, late and after a compaction (the sentence that mentions the file did, at the start). The rule in the mnema record arrived at the start, late and after a compaction; did not arrive at an edit. An `@` import is not expanded by the host.
- **OpenCode.** The rule in `AGENTS.md` arrived at the start, late and after a compaction. The rule behind an `@` import did not arrive at the start, late and after a compaction. The rule in a file that is only mentioned did not arrive at the start, late and after a compaction (the sentence that mentions the file did, at the start). The rule in the mnema record arrived at the start, late and after a compaction; did not arrive at an edit. An `@` import is not expanded by the host.
- **GitHub Copilot CLI.** The rule in `AGENTS.md`, in the host's own instructions file and behind an `@` import arrived at the start and late; was not measured after a compaction. The rule in a file that is only mentioned did not arrive at the start and late (the sentence that mentions the file did, at the start); was not measured after a compaction. The rule in the mnema record arrived at the start and late; did not arrive at an edit; was not measured after a compaction.
- **Gemini CLI.** The rule in `AGENTS.md` did not arrive at the start, late and after a compaction. The rule in the host's own instructions file and behind an `@` import arrived at the start, late and after a compaction. The rule in a file that is only mentioned did not arrive at the start, late and after a compaction (the sentence that mentions the file did, at the start). The rule in the mnema record arrived at the start, late and after a compaction; did not arrive at an edit. `AGENTS.md` is not among the files it reads with the default settings (its `context.fileName` can list it). The cells after a compaction are read in a second run that resumes the session (`--resume`), which starts the session again.
- **Qwen Code.** The rule in `AGENTS.md`, in the host's own instructions file and behind an `@` import arrived at the start, late and after a compaction. The rule in a file that is only mentioned did not arrive at the start, late and after a compaction (the sentence that mentions the file did, at the start). The rule in the mnema record arrived at the start, late and after a compaction; did not arrive at an edit.

<!-- END the prose -->

## How it is held

The table is `the-arrival-table.ts` of the host contract, and this page shows it as it is. Each
host has a case file that starts the host, reads the requests, and requires each cell above that
is a reading to be what the host did:
[Claude Code](../packages/code/tests/host-contract/the-rule-arrives.test.ts),
[Codex](../packages/code/tests/host-contract/the-rule-arrives.codex.test.ts),
[OpenCode](../packages/code/tests/host-contract/the-rule-arrives.opencode.test.ts),
[Copilot CLI](../packages/code/tests/host-contract/the-rule-arrives.copilot.test.ts),
[Gemini CLI](../packages/code/tests/host-contract/the-rule-arrives.gemini.test.ts) and
[Qwen Code](../packages/code/tests/host-contract/the-rule-arrives.qwen.test.ts). A test of the
main suite holds this page to the table
([`the-arrival-page-is-the-table.test.ts`](../packages/code/tests/the-arrival-page-is-the-table.test.ts)),
and holds the control to never arriving.

## What is not held here

- That the model reads, weighs or follows the rule. That takes a real model, and is another
  measurement.
- A host that is not here: VS Code's agent runs only under an editor and Cursor needs an account,
  so neither is in this table ([How each claim is held](evidence.md)).
- Another place a rule can live that this does not take: a rule a person types into the session,
  a user-level instructions file, a skill. Each of these is another row.
- A conversation compacted by a host in a way the stand-in does not provoke: a window filled by
  real content, a command the person types.
