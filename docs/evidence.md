# How each claim is held

Every claim the pages make about what the agent hosts do, and what the plugin hands them,
is held by one of three things: a file of this repository that fails when the claim stops
being true, a result that was read once and is kept here as history, or nothing yet. The
table says which, per claim, and the last column names the file — a test or a specification
that is in the tree today. Every file named on this page is checked to exist.

The words mean one thing each:

- **held by a test** — a case in the suite fails when the claim stops being true. That is the
  product's half: what `mnema` answers, records and prints.
- **historical** — a result read on one day, with one host or model and one number of runs. It
  is stated with those and with no link, because nothing in the tree reruns it.
- **not held yet** — nothing in the tree holds the claim. It is the host's behaviour, read
  once against a real host, and it expires with that host's version.

What the verifier proves, and what it does not, is on
[What it proves](what-it-proves.md), not here.

## Held by a file of this repository

| The claim | Held by | File |
|---|---|---|
| The rules addressed at the file about to be written are handed over beside the result of that write, and recorded as served | a test | [`the-rule-reaches-the-writing.test.ts`](../packages/code/tests/the-rule-reaches-the-writing.test.ts) |
| The opening document and the notes arrive in a session without anybody asking | a test | [`the-record-arrives-unasked.test.ts`](../packages/code/tests/the-record-arrives-unasked.test.ts) |
| Text pushed into a hook stops at a whole rule below 10,000 characters, and says how many it left out | a test | [`within-a-hook.test.ts`](../packages/code/src/presentation/within-a-hook.test.ts) |
| A rule of the record that asks for a person asks only where it is linked, cites its id, and the reply can express no other decision | a test | [`the-record-asks-for-a-person.test.ts`](../packages/code/tests/the-record-asks-for-a-person.test.ts) |
| In VS Code's command door, the write waits for a person exactly where the MCP tool would ask | a test | [`a-host-that-runs-commands-asks-for-a-person.test.ts`](../packages/code/tests/a-host-that-runs-commands-asks-for-a-person.test.ts) |
| A rule that refuses a write answers `deny` and cites the rule at each of the three doors, and the refusal wins over a pause | a test | [`a-rule-that-refuses-a-write.test.ts`](../packages/code/tests/a-rule-that-refuses-a-write.test.ts) |
| The plugin's hooks file names only events and keys the host reads | a test | [`the-hooks-file-says-only-what-the-host-reads.test.ts`](../packages/code/tests/the-hooks-file-says-only-what-the-host-reads.test.ts) |
| The server-only plugin declares the server and runs no hook | a test | [`the-server-only-plugin-runs-no-hook.test.ts`](../packages/code/tests/the-server-only-plugin-runs-no-hook.test.ts) |
| The server goes by the directory a client starts it in when the client names no workspace | a test | [`a-client-that-names-no-workspace.test.ts`](../packages/code/tests/a-client-that-names-no-workspace.test.ts) |
| The rules-file verb writes an address as a glob only when it becomes that glob exactly, and names every rule it leaves out | a test | [`a-rules-file-carries-only-what-becomes-a-glob-exactly.test.ts`](../packages/code/tests/a-rules-file-carries-only-what-becomes-a-glob-exactly.test.ts) |
| The doctor verb says why VS Code's agent loads no plugin | a test | [`doctor-tells-vs-code-where-the-plugin-is.test.ts`](../packages/code/tests/doctor-tells-vs-code-where-the-plugin-is.test.ts) |
| The plugin's skills say what they carry | a test | [`every-skill-the-plugin-ships-is-what-it-says.test.ts`](../packages/code/tests/every-skill-the-plugin-ships-is-what-it-says.test.ts) |
| The numbers and tables the pages draw are read off the file they came from | a test | [`the-front-page-says-what-its-sources-say.test.ts`](../packages/code/tests/the-front-page-says-what-its-sources-say.test.ts) |
| Every file this page names exists | a test | [`the-evidence-page-cites-what-exists.test.ts`](../packages/code/tests/the-evidence-page-cites-what-exists.test.ts) |

## Historical

Results of the runs that gave the plugin its reason to exist. Nothing in this tree reruns them,
so they are stated as what they were: the day, the model, the number of runs.

- **The agent did not ask.** On 18 August 2026, in a round of 116 cells with Claude Haiku 4.5, the
  arm that had the mnema server available called none of its tools: `mcp_asked` was false in 20
  of 20 instrumented cells, and the arm scored what the arm with no record scored. A second round
  on 20 August, with the same model, had it false in 40 of 40.
- **Handing the decision over moved the agent.** On 21 August 2026, in 160 cells with Claude
  Haiku 4.5 — six tasks where the right move depends on a decision the code does not reveal, four
  runs of each in every arm, counting two negative controls and two development tasks that ran
  beside them — the rate at which the agent followed the team's decision, over the six tasks, was:

  | arm | what the agent had | followed the team's decision |
  |---|---|---|
  | `base` | no record, no memory, no decision file | **33.3%** |
  | `host` | the decision in the host's own automatic memory | **100.0%** |
  | `mnema-doc` | the decision in mnema's record, handed over as the session opened | **100.0%** |
  | `mnema+` | the same, and the rules for a file handed over at each edit | **100.0%** |

  Handing the decision over moved the agent from 33.3% to 100.0%, and the host's own memory
  moved it just as far — so the difference mnema makes is not a higher score. The rules at each
  edit added nothing measurable: in every cell they landed beside the result of the task's only
  write. What mnema changes is where the decision lives — in the repository, shared by the team,
  in the diff of the pull request, superseded rather than overwritten, and checkable by anyone.
  And what was measured is conformance to a recorded decision, not whether the decision was
  right. In that round `mcp_asked` was true in 2 of 80 cells that had a server to ask, both on
  one task that already conformed.
- **Where an agent puts a rule it does not have.** On 27 August 2026, in 16 cells of one arm, with
  no decision available, the agent in 2 of the 16 wrote nothing and ended its turn asking the
  person for the rule. That capture measured no arm, and it does not say why.

## Not held yet

The host's own behaviour. Each was read once against a real host, and each expires with the
version it was read on. No file of this repository reruns it, so each page that says it says the
host and the version beside it.

| The claim | Read on | Held by |
|---|---|---|
| The host calls the plugin's MCP tool at an edit, and the rules land beside that write's result, in time for the edits after it | Claude Code 2.1.228 and 2.1.281 | not held yet |
| A `PreToolUse` hook of type `mcp_tool` that answers `ask` stops the write until a person decides | Claude Code 2.1.228, 19 August 2026 | not held yet |
| VS Code's agent runs a plugin's `PreToolUse` command before `create_file`, ignores the hook's matcher, and holds the write when the reply asks | VS Code 1.137 with Copilot Chat 0.65, 30 September 2026, no model and no network | not held yet |
| Cursor's command-line agent runs the hook and ignores the pause; of its tools, only `Write` was read | Cursor agent 2026.09.18, 30 September 2026 | not held yet |
| Each host refuses the write on `deny` and hands the reason to the model | the three hosts above, `Write` only for Cursor | not held yet |
| Claude Code hands a command hook's text to the model whole at 10,000 characters, and as a path with a preview at 10,001 | Claude Code 2.1.281 | not held yet |
| A call on an open connection costs on the order of a millisecond where a command start costs on the order of a hundred | one machine | not held yet |
| In Cursor, the server is a namespace named `mnema` and its tools keep their own names | Cursor, 2026-09-23 session | not held yet |
| How VS Code spells the server's name to the model | not read | not held yet |
| VS Code puts a hook's reason in front of the person who decides; what the person sees in the confirmation | not read from the screen | not held yet |
| VS Code matches `applyTo` with a leading `**/`; Cursor matches `globs` on its servers; Claude Code's `paths` and whether its `**` reaches a name starting with a dot | not read | not held yet |
| Cursor's agent loads the plugin from the Claude Code installation on the same machine, and VS Code's agent from `chat.pluginLocations` | VS Code 1.137, Cursor agent 2026.09.18 | not held yet |
