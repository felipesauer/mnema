# How each claim is held

Every claim the pages make about what the agent hosts do, what the plugin hands them, and what
the verifiers agree on with vectors other people wrote, is held by one of three things: a file of this repository that fails when the claim stops
being true, a result that was read once and is kept here as history, or nothing yet. The
table says which, per claim, and the last column names the file — a test or a specification
that is in the tree today. Every file named on this page is checked to exist.

The words mean one thing each:

- **held by a test** — a case in the suite fails when the claim stops being true. That is the
  product's half: what `mnema` answers, records and prints. For the hosts that run on a free
  runner with no model and no account, Claude Code and VS Code, it is the host's half too: the
  real host is started against a stand-in for its model, and the case reads what the host did.
  Those cases run on every pull request against one pinned release of the host, and every week
  against the newest ones, and a round that measured another release than the one it names is red.
- **historical** — a result read on one day, with one host or model and one number of runs. It
  is stated with those and with no link, because nothing in the tree reruns it.
- **not held yet** — nothing in the tree holds the claim. It is the host's behaviour, read
  once against a real host, and it expires with that host's version.

What the verifier proves, and what it does not, is on
[What it proves](what-it-proves.md), not here.

## Each host's rung

The same table the README carries, with the same words: what each host does with mnema, and how
each cell is known.

<!-- The rung table below is generated from packages/code/src/host-names.ts: edit the table there. -->

| Host | (a) The MCP server | (a) Rules in a file | (b) The opening of a session | (c) A refusal before a write | (d) A pause for a person | Rung |
| --- | --- | --- | --- | --- | --- | --- |
| Claude Code | yes, [held by a test](../packages/code/tests/host-contract/the-rules-arrive-beside-the-write.test.ts) | yes, [held by a test](../packages/code/tests/a-rules-file-carries-only-what-becomes-a-glob-exactly.test.ts) | yes, [held by a test](../packages/code/tests/host-contract/the-session-opens-with-the-record.test.ts) | yes, [held by a test](../packages/code/tests/host-contract/a-refusal-and-a-pause-hold-the-write.test.ts) | yes, [held by a test](../packages/code/tests/host-contract/a-refusal-and-a-pause-hold-the-write.test.ts) | (d) |
| VS Code's agent | yes, read on VS Code 1.137 with Copilot Chat 0.65, 23 September 2026 | yes, [held by a test](../packages/code/tests/a-rules-file-carries-only-what-becomes-a-glob-exactly.test.ts) | yes, read on VS Code 1.137 with Copilot Chat 0.65, 23 September 2026 | yes, [held by a test](../packages/code/tests/host-contract/an-editor-holds-or-refuses-the-write.vscode.test.ts) | yes, [held by a test](../packages/code/tests/host-contract/an-editor-holds-or-refuses-the-write.vscode.test.ts) | (d) |
| Cursor's command-line agent | yes, read on Cursor agent 2026.09.18, 23 September 2026 | yes, [held by a test](../packages/code/tests/a-rules-file-carries-only-what-becomes-a-glob-exactly.test.ts) | yes, read on Cursor agent 2026.09.18, 23 September 2026 | yes, read on Cursor agent 2026.09.18, 2 October 2026 | no, read on Cursor agent 2026.09.18, 30 September 2026 | (c) |
| Factory Droid | documented, not measured ([read 8 October 2026](https://github.com/Factory-AI/factory/blob/c6ea470/docs/cli/configuration/mcp.mdx)) | documented, not measured ([read 8 October 2026](https://github.com/Factory-AI/factory/blob/c6ea470/docs/cli/configuration/agents-md.mdx)) | not ported | not ported | not ported | (a), documented, not measured |
| Qwen Code | documented, not measured ([read 8 October 2026](https://github.com/QwenLM/qwen-code/blob/cbbb0a5/docs/users/features/mcp.md)) | documented, not measured ([read 8 October 2026](https://github.com/QwenLM/qwen-code/blob/cbbb0a5/docs/users/features/memory.md)) | not ported | not ported | not ported | (a), documented, not measured |
| Goose | documented, not measured ([read 8 October 2026](https://github.com/aaif-goose/goose/blob/a4189ec/README.md)) | documented, not measured ([read 8 October 2026](https://github.com/aaif-goose/goose/blob/a4189ec/crates/goose/src/hints/load_hints.rs)) | not ported | not ported | not ported | (a), documented, not measured |
| Continue's command line (`cn`) | documented, not measured ([read 8 October 2026](https://github.com/continuedev/continue/blob/5522c6f/extensions/cli/AGENTS.md)) | documented, not measured ([read 8 October 2026](https://github.com/continuedev/continue/blob/5522c6f/core/config/markdown/loadMarkdownRules.ts)) | not ported | not ported | not ported | (a), documented, not measured |
| Warp's agent | documented, not measured ([read 8 October 2026](https://github.com/warpdotdev/warp/blob/325d4d4/app/src/ai/agent_sdk/driver/mcp_startup.rs)) | documented, not measured ([read 8 October 2026](https://github.com/warpdotdev/warp/blob/325d4d4/app/src/ai/agent_tips.rs)) | not ported | not ported | not ported | (a), documented, not measured |

Each cell says how it is known: **held by a test** of this repository; **read** once against the
real host, on the version and the day it names, and held by no file yet; or **documented, not
measured**: the host's own documentation or code says the host does it, at the commit the link
names, and nothing was run. **Not ported**: the plugin hands that host nothing for it. For the
first three hosts, the rules file is the one `mnema rules-file --host` prints in the host's
format, and the test holds what it prints, not how the host matches its globs; for the others,
it is `AGENTS.md`, which the host's documentation says it reads. A host reaches a rung when every
rung before it is a yes; Aider was read too, and is not here, because it has no MCP client.

<!-- End of the generated rung table. -->

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
| The plugin's hook and its server declaration name the server alike, so renaming either half fails | a test | [`the-rule-reaches-the-writing.test.ts`](../packages/code/tests/the-rule-reaches-the-writing.test.ts) |
| The plugin's skills say what they carry | a test | [`every-skill-the-plugin-ships-is-what-it-says.test.ts`](../packages/code/tests/every-skill-the-plugin-ships-is-what-it-says.test.ts) |
| The numbers and tables the pages draw are read off the file they came from | a test | [`the-front-page-says-what-its-sources-say.test.ts`](../packages/code/tests/the-front-page-says-what-its-sources-say.test.ts) |
| Every file this page names exists | a test | [`the-evidence-page-cites-what-exists.test.ts`](../packages/code/tests/the-evidence-page-cites-what-exists.test.ts) |
| In Claude Code, the opening document arrives in the first request of a session, at session start, as the text `mnema brief --hook` prints, and without a decision that was superseded | a test | [`the-session-opens-with-the-record.test.ts`](../packages/code/tests/host-contract/the-session-opens-with-the-record.test.ts) |
| In Claude Code, the host calls the plugin's server at an edit under the name the plugin gave it, and the rules addressed at the path land beside that write's result, in the request that comes next | a test | [`the-rules-arrive-beside-the-write.test.ts`](../packages/code/tests/host-contract/the-rules-arrive-beside-the-write.test.ts) |
| In Claude Code, a `PreToolUse` hook of type `mcp_tool` that answers `deny` stops the write and the model reads the rule, and one that answers `ask` holds it: with nobody to ask, the call is refused and the model is told which rule asked | a test | [`a-refusal-and-a-pause-hold-the-write.test.ts`](../packages/code/tests/host-contract/a-refusal-and-a-pause-hold-the-write.test.ts) |
| In VS Code, the agent runs the plugin's `PreToolUse` command before `create_file`: on `deny` the file is not created and the model reads the rule, and on `ask` the agent stops on a confirmation and creates nothing | a test | [`an-editor-holds-or-refuses-the-write.vscode.test.ts`](../packages/code/tests/host-contract/an-editor-holds-or-refuses-the-write.vscode.test.ts) |
| VS Code's agent loads the plugin from a folder listed in its `chat.pluginLocations` setting, and runs the command its hooks file declares | a test | [`an-editor-holds-or-refuses-the-write.vscode.test.ts`](../packages/code/tests/host-contract/an-editor-holds-or-refuses-the-write.vscode.test.ts) |
| VS Code puts the text of a command hook that allows a call inside the result of that call, as `<PreToolUse-context>` | a test | [`an-editor-puts-a-hooks-text-in-the-result.vscode.test.ts`](../packages/code/tests/host-contract/an-editor-puts-a-hooks-text-in-the-result.vscode.test.ts) |
| Claude Code hands a command hook's text to the model whole at 10,000 UTF-16 code units, and as a path with a 2,000-unit preview at one more; the text the product hands over for a record too long for it stops below that, at a whole rule | a test | [`a-hook-hands-over-ten-thousand-units.test.ts`](../packages/code/tests/host-contract/a-hook-hands-over-ten-thousand-units.test.ts) |
| Claude Code keeps the first 2,048 characters of a server's instructions and cuts the rest, and the plugin's own instructions arrive whole | a test | [`a-servers-instructions-are-cut-at-2048.test.ts`](../packages/code/tests/host-contract/a-servers-instructions-are-cut-at-2048.test.ts) |
| A write through the shell goes round a rule that refuses it, and the case requires that it does: the limit is a declared one | a test | [`the-shell-goes-round.test.ts`](../packages/code/tests/host-contract/the-shell-goes-round.test.ts) |
| Without `mnema` on the PATH the plugin's hooks fail open in Claude Code: the session opens with nothing added and a write a rule would refuse goes through | a test | [`without-mnema-the-hooks-fail-open.test.ts`](../packages/code/tests/host-contract/without-mnema-the-hooks-fail-open.test.ts) |
| The host contract starts the hosts where only loopback exists, reads where Claude Code connected, and refuses a round that measured another binary than the one it names | a test | [`the-instrument-sees-what-leaves.test.ts`](../packages/code/tests/host-contract/the-instrument-sees-what-leaves.test.ts) |
| The three verifiers of a record — the product on each Node the CI runs, the Python second reader and the page's verifier — give the verdict their publishers give on every Ed25519 vector of Wycheproof, CCTV, ed25519-speccheck and RFC 8032 §7.1, under the strict rule of `FORMAT.md` §6 | a test | [`every-verifier-gives-one-ed25519-verdict.test.ts`](../packages/code/tests/every-verifier-gives-one-ed25519-verdict.test.ts) |
| Both readers of the format spell a number as RFC 8785's Appendix B does, and as the first 10,000 lines of cyberphone's `numgen.js` do, run unmodified and matched to the SHA-256 its author published | a test | [`outside-vectors.test.ts`](../packages/chain/src/chain/outside-vectors.test.ts) |
| Both readers refuse every JSONTestSuite `n_` file as a stored line, and decide every `i_` file alike; every file whose bytes are not UTF-8 both refuse for that, naming the same byte | a test | [`outside-vectors.test.ts`](../packages/chain/src/chain/outside-vectors.test.ts) |
| Each file of a record the readers decode — a segment line, a checkpoint, the tail proof, a committed key — is refused by the product and by the second reader, naming the same byte, when one byte in it is not UTF-8, and a torn final fragment, cut on any byte, is dropped by both | a test | [`every-reader-refuses-bytes-that-are-not-utf8.test.ts`](../packages/chain/src/chain/every-reader-refuses-bytes-that-are-not-utf8.test.ts) |
| The vectors above are the files their publishers published: each is copied with its license and commit, and its SHA-256 is checked | a test | [`outside-vectors.test.ts`](../packages/chain/src/chain/outside-vectors.test.ts) |
| The Action fails a pull request whose record was cut back to an earlier state that is honest in every byte, by holding it to the base with `verify --since` | a test | [`run.test.ts`](../packages/action/src/run.test.ts) |

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

Cursor's command-line agent needs an account, and an account is not a thing a free runner has, so
what is read of it is read by hand, from a script kept beside the plugin and a file that says the day,
the version and the checksum of what ran. [How a capture is made](../plugin/captures/README.md). A
capture is a dated reading and is never presented here as a test.

| The claim | Read on | Held by |
|---|---|---|
| In an interactive Claude Code session, a person is shown the rule that asked and decides, and the write waits for that decision | Claude Code 2.1.228, 19 August 2026 | not held yet |
| VS Code's agent ignores the matcher of a hook: the plugin's command ran before `create_file` whatever the matcher named | VS Code 1.137 with Copilot Chat 0.65, 30 September 2026, no model and no network | not held yet |
| Cursor's command-line agent runs the hook and ignores the pause; of its tools, only `Write` was read | Cursor agent 2026.09.18, 30 September 2026 | not held yet |
| Cursor's command-line agent refuses the write on `deny` and hands the reason to the model; of its tools, only `Write` was read | Cursor agent 2026.09.18, 2 October 2026 | not held yet |
| A call on an open connection costs on the order of a millisecond where a command start costs on the order of a hundred | one machine | not held yet |
| In Cursor, the server is a namespace named `mnema` and its tools keep their own names | Cursor, 2026-09-23 session | not held yet |
| The server's own instructions reach the model in the VS Code model families whose prompt carries them, and do not reach it in the Codex families, where the two opening texts are what arrives | VS Code 1.137 with Copilot Chat 0.65, 23 September 2026, offline with a test model | not held yet |
| In Cursor's command-line agent the server's tool names arrive up front and a tool's own description arrives only when the model looks that tool up | Cursor agent 2026.09.18, free plan, `Auto` model, 23 September 2026 | not held yet |
| On Cursor's free plan with the `Auto` model, the prompt carries the server's instructions whole, but for the indentation of their continuation lines, and both opening texts, and the model called the server's tools | Cursor agent 2026.09.18, free plan, `Auto` model, sessions of 23 September 2026 | not held yet |
| VS Code's agent and Cursor's command-line agent do not run a hook of type `mcp_tool`, and run command hooks | VS Code 1.137 with Copilot Chat 0.65 and Cursor agent 2026.09.18, 30 September 2026 | not held yet |
| How Claude Code hands the `userConfig` value to the hooks and the server was read from its documentation, not run; whether VS Code and Cursor offer the option | not read | not held yet |
| Claude Code and Cursor's command-line agent apply a hook's matcher: a matcher of VS Code's tool names never ran the plugin's VS Code hook in either | Claude Code 2.1.281 and Cursor agent 2026.09.18, 30 September 2026 | not held yet |
| Claude Code calls a hook's MCP server only under the name `plugin:<plugin>:<server>`; the manifest's own name and three other spellings were not called | Claude Code 2.1.228 | not held yet |
| How VS Code spells the server's name to the model | not read | not held yet |
| VS Code puts a hook's reason in front of the person who decides; what the person sees in the confirmation | not read from the screen | not held yet |
| VS Code matches `applyTo` with a leading `**/`; Cursor matches `globs` on its servers; Claude Code's `paths` and whether its `**` reaches a name starting with a dot | not read | not held yet |
| Cursor's agent loads the plugin from the Claude Code installation on the same machine | Cursor agent 2026.09.18 | not held yet |
