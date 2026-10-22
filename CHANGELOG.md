# Changelog

Notable changes to the packages in this repository are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The line before this one, the 0.x alpha published as `@felipesauer/mnema`, is deprecated on
npm and lives at [this commit](https://github.com/felipesauer/mnema/tree/ef736fc6b1f682a513f02f335ad5b7e2e338eca6),
with its own changelog.

## [Unreleased]

### Added

- **The work a session hands to other agents is kept as one private task.** In the Claude Code plugin, a `PostToolUse` hook on the
  `Agent` tool and a `SessionEnd` hook run a new verb, `mnema dispatched`: the first dispatch of a session records a private
  task, `Work handed over in this session` and the instant, in progress; each dispatch records a private handoff on it, from
  `orchestrator` to the subagent type, with the call's short description as the brief and the path of a file the prompt cites
  when that file exists; the end of the session moves the task to done with the count of handoffs. The prompt is never recorded
  and nothing goes to the public tree. The task's id is kept in the session journal (a new `handedOver` field), so a resumed
  session reopens its task, and the next session that dispatches closes the tasks left by a journal untouched for a day.
  `mnema switch off agent-mirror` stops it (a new channel, on by default; it also does nothing where `session-journal` is off),
  and a failure of the mirror never holds a dispatch. The mirror's task is not taken for the goal of the session.
- **A session journal, kept at `Stop`.** `mnema tally` now keeps, for a session whose hook names it (`session_id`), a small
  file at `<data directory>/sessions/<digest of the project>/<session id>.json`: a byte cursor into the transcript, so each
  `Stop` reads only the lines the host wrote since and not the whole conversation again, and, in ids and counts, what the
  session did with the record (decisions recorded since it opened and their state, notes of the host's memory copied, questions
  answered with no decision after, files holding decisions cited nowhere, files edited, tasks in progress, runs open, the goal
  and an outcome as a sentence of counts). Never a prompt, a message, a tool's output, a file's content, the environment or the
  answer a person chose. It is outside the record (no event, no signature, `verify` does not read it), disposable, pruned by age
  (30 days) and number (50 a project), and `mnema switch off session-journal` stops it (a new channel, on by default). The MCP
  server opens a run with the journal's goal when it knows one and closes it with the journal's outcome, reading
  `CLAUDE_CODE_SESSION_ID`; the `resume` and `status` readings now print a run's outcome, which they never did.
- **A task carries what it is, and a handoff what the next agent must read.** `mnema task create "<title>" --description "<text>"`
  and the `create_task` tool's `description`, and `mnema task handoff <task> <from> <to> --brief "<text>"` and `record_handoff`'s
  `brief`, take up to 64 KiB of text. The text is recorded in the same call as an observation about the task (topic
  `description`, topic `brief`), so the format is unchanged, and the reply names the observation's id. `read_record`
  and `show` of a task now serve the description, the last handoff (from, to, and its brief) and the notes about it,
  newest first, with the count a cut of eight left out. `bootstrap`, `status` and `next_actions` say, for each task in
  flight, who has it (the `to` of its last handoff, or who started it) and the last thing that happened to it, on one
  line; `bootstrap`'s answer grows by 62 bytes (25 tokens) on the fixture the budget golden measures. Nothing here is
  signed beyond what a note already is: the description and the brief are notes, not fields of the task.
- **`refs` and `audit_refs` say what is at a path.** For an id no tree authored, read as a path under the project, the
  answer says whether the file exists now and the SHA-256 of its bytes (a directory is named and not hashed, and a path
  outside the project is not read, whether it is spelled outside or reached through a directory link that leads out;
  a link that stays inside is followed). An id that is neither a record nor a file says both, in that order. It reads
  the working tree and writes nothing.
- **`search` finds a decision by its `ADR-<n>` label**, as `show` already did.

### Fixed

- **A handoff with no scope follows its task, and its brief with it.** It landed in the public tree even when the
  task was private, and a brief of up to 64 KiB went with it into what is committed. With no `--scope` (or `scope`),
  the `task handoff` command and `record_handoff` now record in the tree that holds the task, as a move does; when no tree
  holds the task (or, over MCP, several records do), the default tree is kept and the reply says so.
- **`next_actions` serves who has the task and what happened last.** The two facts were computed and the reply dropped
  them; they now follow the list of moves, one line each.
- **`show` and `read_record` count a task's notes the same way**, over every tree this machine holds: `show` read only
  the tree that holds the task and missed a private note about a public one.
- **A size refusal names the field the person passed** (`brief`, `description`), not the note's own `text`.
- **`link_knowledge` and the `link` command say a missing subject plainly for a relation that is not an address**: `No tree
  here holds <id>, so this link names nothing a reader can open. Check the id.` The wording about a rule and its
  address stays for the relations that are addresses.
- **`start` on a task in DRAFT says that `submit` comes first**, and any refused move names the one move from the
  current state that reaches a state where the action is legal, read off the transition table.
- **Linking a task to a path in the public tree no longer says "the rule it names".** It says "the task it names", and
  `link_knowledge` now prints, as the command line did, where the thing the link starts from lives when that tree does
  not travel (the result carried it and the server never printed it).

- **`bootstrap` names the channels that are off on this machine.** The reply carries one more line, of its own beside
  the JSON, when a channel is off for the project (the two that begin off, until a person switches them on, or any a
  person switched off): `Off on this machine: <names>. Only a person turns one on, with `mnema switch on <name>`.` It is
  read from the effective state of the project's trees, so a channel a person switched on is not in it, and with
  nothing off there is no line. It adds 33 tokens to the reply; the server's instructions, the tool's description and the
  block committed into the repository are unchanged.
- **`mnema` with nothing after it says where the project stands and what is off.** It prints a short summary on stdout
  and exits 0 (it printed the whole catalogue on stderr and failed; `mnema --help` still prints the catalogue, and at a
  terminal the name still asks what you want to do): what the product does in a sentence, whether a project is founded
  here and how many decisions await a judgement, the channels that are off on this machine with the command that turns
  one on, and three verbs to go on with. Where the record or the switches cannot be read it says so in one line, and says
  nothing of what it could not read. `mnema switch` ends each off line with the command that turns it on, and
  `mnema init` names the channels that begin off in two lines before its "Next" line.
- **A page for the switches, generated from the table the code reads.** `docs/switches.md` lists every channel `mnema switch`
  knows, where it begins (on, or off until a person switches it on) and the command that flips it. The listing
  `docs/cli-reference.md` shows for `mnema switch` and the sentence of `plugin/README.md` that names the channels beginning off
  are generated from the same table and compared with it by a test: the listing said 14 channels and showed 12.

- **`mnema init` writes the mnema instructions into the files agent hosts read, and `mnema instructions` writes,
  checks and removes them.** A short block says when to call the mnema tools (`bootstrap` at the opening,
  `governing_rules` before changing a file, `record_decision` when a choice is settled, `capture_memory` for what the
  code does not show), that a decision is born `proposed` and a person accepts it, that a subagent hands its decisions
  back, the shell command where the tools are not connected, and what never goes in the record; it applies only where
  the mnema tools are connected. It goes into `AGENTS.md` (created where there is none), into `CLAUDE.md`,
  `.claude/CLAUDE.md` and `GEMINI.md` where they exist, and into three files of its own:
  `.claude/rules/mnema-instructions.md`, `.github/instructions/mnema-instructions.instructions.md` (`applyTo: "**"`)
  and `.cursor/rules/mnema-instructions.mdc` (`alwaysApply: true`). Every copy is the same text, 1,524 characters,
  between `<!-- mnema:begin v1 … -->` and `<!-- mnema:end -->`, after what a file of yours holds. A block whose text
  mnema did not write is left as it is and said (exit 1), as is a symbolic link that leaves the project or leads
  nowhere and a file that cannot be read or written (said with why and the command to try again; `init` still
  founds the project and prints the rest); `--remove` takes the block out without gluing the line you wrote after it to
  the one above, says "as it was" only when that is true, and deletes a file the block was all of; line endings
  (CRLF) are kept, and markers inside a fenced code block are an example, not a block; the alpha's `<!-- MNEMA:START -->` block is not recognized and is never touched: the block is added beside it and `--remove` leaves it. `init` writes the
  instructions only when it founds a project, so a block you took out stays out; `mnema doctor` names each file that
  lacks this version's block. The Gemini CLI extension carries the same text as its context file (`contextFileName`).
- A write of the block into an instruction file is not taken for a decision written there, and `AGENTS.md`,
  `CLAUDE.md` and `GEMINI.md` are not counted as decision documents of a directory `mnema decision import` reads.

### Changed

- **Opening a session over a project with no stack is about 13 ms faster.** (Median of 15 runs, 211 ms to 198 ms, the same 1,789 bytes of document.) `mnema brief --hook` loaded the
  module that installs and inspects stacks on every run; it now loads it only where a tree has a stack receipts folder or
  a stack the record adopted, and prints the same document either way. `runBrief` in the library takes the reader of
  stacks with `outside: true` (`stacksReaderFor` hands it).
- **The local count of tool calls is written after the tool has answered.** The line used to be appended before the
  reply went out (about 21 microseconds an append, measured); it is now written in the next turn of the event loop, and
  any line still waiting is written first when the process exits, when the session closes on SIGTERM, SIGINT or the end
  of stdin, and when the count is read. A process killed by SIGKILL can still lose the lines that were waiting. Reading
  the count in the same process sees every call already answered.
- **The first read of a server that has several projects open is faster.** Every tree a cold server opens used to create the
  projection's tables, drop them as the first replay began and create them again; the tables are now made once per process
  (copied from a database image where the runtime offers `serialize`/`deserialize`, created in place where it does not) and a
  fresh database is not dropped before its first replay. The first `bootstrap` over ten projects measured 89 ms before and
  51 ms after (median of 15 cold starts, the same machine and load); the second call is unchanged. Nothing about the record,
  its format or what a read answers changed.
- **The MCP server starts from the projection the command line and the hooks already keep.** It opened every tree by
  replaying the whole record; for the two trees of the project it is in, it now opens `locks/projection.db` and takes
  only what was appended since, with the same checks every other reader uses (the stamp of the code, the size and
  modification time of sealed segments, the frontier of each tail), so a record changed behind the file by another
  process, a `git pull` or a checkout is read by the next call. The other projects of the workspace and the global tree
  stay in memory. The first `bootstrap` of a server over a record of 4,508 lines went from about 250 to about 40 ms
  (median of 21 cold starts, one project), and from 299 to 69 ms with nine other projects in the workspace; the second
  call is about 4 ms slower than before while the file's pages are first read, and the calls after it are equal. Because a tool that only reads now updates that file, `readOnlyHint` carries a second written
  exception beside the local count of calls: a cache derived from the project's own record, deletable (the next read builds
  it again), never a fact of the record, and the one thing it can miss is an edit in place, to the same size, of a line
  before the last of a live segment, which only `verify` sees. A live segment replaced by another branch's, even a longer one, is read again (the
  line a stored position ends on is read back and must be the entry it ended on), in the command line as in the server,
  and a file another process or version rewrote under a running server is taken again before the next answer. What the
  file does not see is an edit, in place and to the same size, to a line before the last one of a live segment
  (`mnema verify` is what rules on that).

### Fixed

- **`mnema check run --key` with a key that is not Ed25519 no longer calls it an agent's key.** The refusal says that
  a checker's key is an Ed25519 one, as it says for an agent's in the commands that enrol an agent.
- **`mnema doctor` reads the host's `.claude.json` where the host keeps it.** With `CLAUDE_CONFIG_DIR` set the file is
  `$CLAUDE_CONFIG_DIR/.claude.json`, and `doctor` read the one in your home directory, so it counted the wrong
  declarations of the mnema MCP server and listed the wrong projects.
- **The plugin's hooks no longer trust the first `node` of their PATH, and a gate that cannot decide a write refuses it where a rule addresses the path.**
  Cursor's command-line agent puts the Node it carries (24.5.0 on 2026.09.18) in front of the PATH of a plugin's hooks;
  `mnema` starts through `#!/usr/bin/env node`, died on its own floor at its first line, and the gate read that as nothing
  to say, so a write a rule refuses was made. Now the hooks ask the first `node` what it is and, below the floor, run
  `mnema` on the first one further along that PATH that takes it (the `node` beside `mnema` first), within three seconds
  and with a second for each `node` that hangs on its version. Where none does, or where `mnema` is there and exits
  non-zero, does not answer in ten seconds (six in Gemini CLI's script and OpenCode's plugin, which also ask again at the
  next write after one failed identification), or prints what no host reads, the write is refused with the reason and the
  fix, but only where a rule IN FORCE that refuses a write or asks for a person at it addresses that path (a rule only
  proposed, rejected or superseded does not count); any other path goes
  through, a project whose only links govern is never refused, and a rule taken back stops refusing. This holds in Cursor's
  agent, Codex, VS Code, Copilot CLI, and now in Gemini CLI's script and OpenCode's plugin too, and for a fault of a
  handler itself. With no `mnema` on the PATH, no project, or no rule that could meet the write, nothing changes. The
  handler that hands over the document tells the session that mnema could not run, with the reason. `mnema doctor` has a
  `node` topic: the first `node` on the PATH and whether it takes `mnema`, and the Node Cursor's agent carries where it is
  on the machine. A hook whose own `node` cannot start, or whose handler files are missing, is still read by the host as
  nothing to say, and Claude Code's call into the server is unchanged.

- **A checkpoint or an event in a tail that names another key than the one the tail belongs to is refused, by
  `mnema verify`, the Python verifier and the page.** A tail id begins with the fingerprint of its key, and only that
  key writes to it (`FORMAT.md` section 6, a new rule). Both readers checked a checkpoint under the key it names and bound
  its events to that key, and never asked whose tail they were in: a second key of the record, even one enrolled for
  the same person, could append its events to another key's tail and sign a checkpoint over them there, and the record
  verified. It is now refused as `tail-signer-mismatch` (not the tail proof's `signer-mismatch`), on a checkpoint and on
  every event of the tail, including those above the last checkpoint, in the same words in every reader. No record a
  mnema binary writes is touched: a writer names its tail and signs in it with one key. Records written by 0.1.0, 0.1.1 and
  0.1.2, with a person, an agent key, a checker, a second machine and a restored
  backup key, and this repository's own record, verify as before. A version from before this one still verifies a record
  that breaks the rule.
- **A `.pub` under `keys/` that holds no key is refused by name, by `mnema verify`, the Python verifier and the page, and
  the Python verifier no longer crashes on one.** A `README.pub` with text in it and a directory named `<fingerprint>.pub`
  stopped the Python verifier with a traceback, and a key file whose bytes are not UTF-8 was refused there; `mnema verify`
  read all three as a committed key with no tail, a note, and verified. Each is now refused under `FORMAT.md` section 6
  as a key file that *holds no Ed25519 public key*, with the reason (`it is not a file`, `not UTF-8 at byte N`, `no PEM
  public key in it`, `the PEM body is not base64`, `not an Ed25519 SubjectPublicKeyInfo`, and `it cannot be read` for a file with mode 000, which
  also stopped both readers with a traceback), in the same words in every
  reader, and is no longer counted as a key without a tail. Both readers read a key file by one written rule now, so a
  private key, or a key of another algorithm, is no key to either. No record a mnema binary writes is touched: records
  written by `main` and by this version, this repository's own record and the frozen fixtures verify as before.
- **A file under `keys/` whose name starts with `._` is skipped by both verifiers, as `.DS_Store` is.** It is the metadata
  macOS writes beside a file (AppleDouble), not a key, and refusing it made a record unverifiable for a copy that touched
  a Mac. Every other `*.pub` must still hold an Ed25519 key. `mnema doctor` names such a file so you can delete it.
- **`mnema verify` names every cause in a tail with a line it cannot read, as the Python verifier does.** It stopped at
  the first such line and said nothing more about that tail, so a second unreadable line, a checkpoint whose signature
  fails or a missing ownership proof beside it were left out of the verdict. Every unreadable line is named now, and
  so are the tail's ownership proof, the key its checkpoints and events name, and each checkpoint's own signature; across
  a missing event line neither reader walks the hash chain or folds a content root. The level stays `unreadable`.

## [0.1.2] - 2026-10-21

### Added

- **After a write in Claude Code, `mnema after-a-write` copies a note of the host's own memory into the private tree,
  and names the door of a file that holds decisions.** A `PostToolUse` hook on `Write|Edit` runs it behind a shell that
  reads the path out of the payload and starts nothing for any other path (about 6 ms per common write on a loaded
  machine). A note under this project's own memory directory in Claude Code (`projects/<project>/memory/*.md`, with `<project>` the
  main working tree's path as the host names it, so every worktree of a repository shares it, under `$CLAUDE_CONFIG_DIR` or
  `~/.claude`, or where `autoMemoryDirectory` points in your own settings or the project's `.claude/settings.local.json`)
  is recorded as a memory in this machine's private tree, with a marker naming the file and a hash of its content, once
  per content, under a new channel, `host-memory-mirror`, which starts ON (`mnema switch off host-memory-mirror` stops it):
  the one channel that writes without a verb and begins on, by a recorded decision. A note in
  another project's directory, the index `MEMORY.md` and a note of `type: user` are never copied, and nothing goes to the public tree. A file under
  `docs/adr/`, `docs/decisions/` or an `adr/` directory, or a `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, host rules file,
  plan, handoff or ledger whose new lines open as `Ruling:`, `Decision:` or a correction does, gets one line naming
  `mnema decision import <the directory or file>` or `record_decision` when the record cites it nowhere, once per session and file; it records
  nothing, and `mnema switch off decision-file-written` stops it. The line at `Stop` now also counts the notes copied
  since the session opened. `readHostMemory` in `@mnema/core` is the one reading of a memory file, for this and for
  `decision import --format claude-memory`. Two limits are known and left as they are: a project path longer than 200
  characters is compared by its first 200 (the host cuts the name there and adds a hash this does not compute), so two
  such projects that share those 200 are not told apart; and the name pattern `*plan*.md` also matches a name such as
  `explanation.md`, whose new lines still have to open as a decision does before any line is given.
- **The record carries an `.editorconfig`, and `mnema doctor` and the brief warn of the other tools that would rewrite it.** `.mnema/.editorconfig`
  sets `insert_final_newline`, `trim_trailing_whitespace`, `end_of_line`, `charset`, `indent_style` and `indent_size` to `unset`
  (no `root = true`, so nothing else of the folders above is cut); it is written where the README is (the founding, the `init`
  that completes a founded project, and the first signed write that grows a record with none), never over an existing file and
  never by a read or a refused write, and it is not part of the proof (`FORMAT.md` section 4). `mnema doctor` and the hook's brief
  also name a `.pre-commit-config.yaml` with a rewriting hook, a Biome, dprint or lint-staged configuration that does not leave
  `.mnema/` out, each with the line to add, and say when a file could not be read well enough to confirm; none of those files is
  edited. The `.prettierignore` is now written where prettier is declared: the project's own directory or the nearest one above it up to
  the git root, instead of the git root alone.
- **After a question the agent asked the person is answered, the agent is told which tool records the choice.** A new verb,
  `mnema settled`, answers a hook after the host's question tool ran with one sentence of fact beside the answer: that a
  question was answered, that `record_decision` records a choice it settled with the options not taken as `alternatives`,
  and that nothing was recorded from it. It records nothing and reads which tool ran, never the answer. The plugin declares it
  as a `PostToolUse` hook on `AskUserQuestion`, behind a shell that starts no process for any other tool (VS Code runs the
  plugin's hooks whatever their matcher says); the hooks files of Codex (`request_user_input`), Copilot CLI
  (`AskUserQuestion`), Gemini CLI (`ask_user`, `AfterTool`) and OpenCode (`question`, `tool.execute.after`) carry the same
  hook, documented and not measured. A new channel, `choice-settled`, is on until `mnema switch off choice-settled`. Held in
  Claude Code against the real binary, where the sentence arrives inside the question's result.
- **With `user-corrections` switched on, the answers the person gave to the agent's questions are proposals too.** At
  `Stop`, besides the openings that correct, `mnema corrections` records the option the person chose in the host's question
  tool (read from the result the host writes in the transcript, which the reader passed over before) and the prompt typed
  right after a response that ended in a question mark, each quoted with its question, as a `proposed` decision in this
  machine's private tree, titled `Answer: …`, with an email address in the title replaced by `<email>` as in the body. An
  answer that only assents or refuses ("yes", "ok", "go ahead", "pode") is not recorded. The channel is still off until
  somebody switches it on.
- **A subagent that begins is handed the brief of the session.** The plugin gains a `SubagentStart` hook that runs
  `mnema brief --hook` and hands the document to the subagent as it starts, byte for byte what the opening hands the session,
  under the event the host routes the reply by. It is the opening's channel and the opening's switch (`mnema switch off
  brief-document` stops both), and it is silent where there is no project. It is held against the real Claude Code binary; VS
  Code documents the event and reads the same hooks file, and was not measured on it.
- **`docs/evidence.md` carries a presence map.** For each host and each moment of the work (a choice settled with the person, the
  host's own memory, a plan or decision file, the opening, an edit, the end of a response, a subagent's start and stop) it says
  whether the host offers something the plugin could ride, and how that is known: held by a test, documented and not measured,
  no channel, or not read. It is generated from the host table, and a copy edited by hand is red.
- **A project founded before the README completes it on its first signed write.** The first write to a public record that has no
  `.mnema/README.md` (any verb, or any MCP tool) leaves the same page `mnema init` leaves and says so in one line, on stderr for a
  verb and in the tool's reply for the server. It is made only after the record grew: a read, a refused write and a write to a
  tree that does not travel leave the folder as it was, and a README that is already there is never replaced. Only the README is
  written this way, and only inside `.mnema/`: the `.prettierignore` is still edited by `mnema init` alone. The session brief
  (`mnema brief --hook`, never the file a person redirects it into) gains one line where `mnema doctor` would add the line `.mnema/` to the
  `.prettierignore` (the same function), saying the formatter can rewrite the signed record and that `mnema init` protects it.
- **`mnema decision review` goes through the decisions awaiting a judgement, one by one, at a terminal, with no id to copy.** It
  lists what is `proposed` in the order `mnema status` lists it, shows each one's ADR, title, reason and what it turned down,
  and asks: accept, reject, skip or quit. It asks for one note at the start (the default says the date and that it was reviewed
  with the verb), used for every verdict unless a note is written after the letter, and ends with how many were accepted,
  rejected and skipped. Each verdict is the move `decision move` makes, through the same gate, key and refusal codes; a refusal
  on one decision is said and the review goes on. It is a person's: it signs with your own key, refuses `--which`, and says
  when `MNEMA_AGENT_KEY` is set that it does not use it. Without a terminal it writes nothing, refuses with
  `DECISION_REVIEW_NEEDS_A_PERSON` and prints the `decision move accept <ids> --note` command that rules the same
  decisions; with nothing awaiting, it says so and exits 0.
- **A plugin and a `mnema` of different versions now say so.** A `mnema` older than the plugin is the pair that breaks: the
  plugin may ask it for something it never learned, and a refused hook was silence. The hook that opens a session now compares
  the version `mnema --identify` answers with the plugin's own and, when the binary is the older, adds one line after the
  document (or alone, where the binary printed nothing) saying the two do not match and giving the command that fixes it,
  `npm i -g @mnema/code@<the plugin's version>`. The hook still exits 0 and blocks nothing. `mnema doctor` says the same for
  the plugin Claude Code lists as installed, in the direction that applies: a binary older than the plugin gets the `npm`
  command, and a binary newer than the plugin (which works) gets `claude plugin update`. A binary newer than the plugin adds
  nothing to the session.
- **`mnema init` leaves a `README.md` in `.mnema/` and keeps prettier away from the record.** The page says what the folder is,
  that the record changes with the work and each change goes in the same commit as the work it describes, that nothing in it
  is edited or reformatted, that the private keys are not there, and how to verify it. It is not part of the proof: both readers
  ignore it, and `FORMAT.md` section 4 lists it beside `.gitignore`. Where the repository has a `.prettierignore` or declares
  prettier (a dependency, a `prettier` key in `package.json`, or a `.prettierrc*` at the root), `init` adds the line `.mnema/`
  to the `.prettierignore` at the root of the repository, creating it only when prettier is declared, and says so; a repository
  with no prettier is left as it is. The session brief gains one line saying that recording changes `.mnema/` and that the change
  goes in the same commit as the work. Run again in a project that is already founded, `init` adds what that project
  lacks of the README and the `.prettierignore` line, says what it added and touches nothing else of the record, and
  `mnema doctor` points at either when it is missing (it writes nothing; the fix it names is `mnema init`).
- **`mnema usage --tools` counts how many times each MCP tool was called, from a file this machine keeps.** For each call
  the server answers and counts it appends one line (the instant, the tool's name, whether the tool writes, and `ok` or the code of
  the refusal) to `<data directory>/tool-calls/<digest of the project>.jsonl`, in the home and never in the repository.
  Never an argument, a word an agent wrote or a record's id; no event, no signature, no change of format, and `verify`
  does not read it. The verb prints, per tool, the calls, the refusals and the first and last date, and says it counts
  only what the MCP server on this machine answered. A call refused while validating its arguments (they do not match the
  tool's input schema) never reaches the tool and is not counted. It is on until `mnema switch off tool-call-count`; on a machine
  with no key of its own yet nothing is kept and no directory is made.


### Changed

- **A write over MCP says the directory of the project it fell in, whether or not it named one.** `In the project at
  <path>.` followed only a write that carried a `project`. It now follows every write that landed in a project's tree
  (not the global one), a move by id (`task_transition`, `decision_transition`, `skill_transition`) and a retraction
  included: after a reload the workspace can hold another checkout of the same repository, and an id the clone also holds
  used to move there without a word.
- **The agent a fact names, and a relation, are asked what a recipe prints in their place.** `--which "<name>"` was
  recorded as the executor; `--rel src/a.ts` as the relation. Both are refused with `NOT_A_REFERENCE`, by the door
  every write passes (a `which` that is a marker; a relation that is a path: one that starts with `/`, `./` or `../`, or has a separator and a file extension, or names a file or directory that exists in the project; `and/or` and `v1.2` stay labels).
- **`resume`, `focus` and the resume inside `bootstrap` read the runs of every project of the workspace.** A session that
  wrote first in a project its client listed second was answered `lastRun: null` and no open run. While no identity signs
  for the session (a machine with no key, before the first write) the sentence about the connection now also says that
  `actor` is empty because of that.
- **`read_record` and `bootstrap` say when a record was moved twice out of one state by machines that had not seen each
  other.** `show` and the brief said it; the agent was served the last state alone. The sentence is the same
  function's, as a block beside the payload.
- **The server's instructions say to record here even what is also kept elsewhere.** The handshake text now asks that a decision or a note be recorded as the work happens and also when the same thing is already in a plan, a ledger, `CLAUDE.md` or the host's own memory, because this is the signed copy and the one later sessions read back. To stay under 2,048 characters (the text is now 2,013) it drops the sentence that the record outlasts the session, a parenthesis about the `mnid`, and shortens the last paragraph; the `recording-decisions` skill says the same in one sentence.

- **In VS Code and Cursor, a write no rule can meet no longer starts `mnema`.** The gate there is a process per write, and most
  of its cost was loading `mnema`, paid even in a project whose record addresses no path. The plugin's handler now reads the
  stored lines of the project's committed tree, of its private tree and of the machine's global tree itself, and where none
  holds a link under `governs`, `asks-for-a-person` or `refuses-a-write` it answers what `mnema` would answer there, nothing,
  without starting it. A canonical line holds that relation byte for byte, so the search cannot miss one. Every doubt starts
  `mnema` as before: a tree it cannot list, a line that is not UTF-8, not canonical, or not of a kind, a version and a shape
  the first published reader declared (the plugin carries a copy of those declarations, held to the reader's by a test), so a
  record `mnema` cannot read still refuses every write. Nothing is kept between two writes, so a rule that arrives by `git
  pull` is met at the next one. Measured on one Linux machine under load, 50 runs each, in a project with one accepted rule and
  no address: the handler went from about 330 ms (Cursor) and 290 ms (VS Code) at the median to about 50 ms; with a rule that
  refuses, it costs what it did. Claude Code's hook, a call into the server, is unchanged.
- **The links check after the merge reads `docs/` too, and `osv-scanner` runs weekly.** The job that asks the network for every address of the READMEs once a change is on `main` now also reads every Markdown page under `docs/`; it is still never a check on a pull request, and still opens one issue for the broken ones. `osv-scanner` now also runs on Mondays against the unchanged lockfile, so an advisory published against a dependency nobody touched shows up; a finding fails that run and shows in the Actions tab, and opens nothing else. `gitleaks` stays on pull requests and on `main`.
- **Two scanners now read the repository in CI, outside the required checks.** `gitleaks` reads the whole history for a committed credential and `osv-scanner` reads `pnpm-lock.yaml` for a dependency with a published advisory, on every pull request and on `main`. Both are release binaries pinned by version and SHA-256. The first reading found no credential: every match was a public test vector, a made-up fixture or a fingerprint, and `.gitleaks.toml` names each class and why. It found no advisory.

### Fixed

- **A title made only of spaces is refused, like one made only of punctuation.** `task create "   "` recorded a task
  named with blanks (and a decision, a skill, an observation topic): `NOT_A_TITLE`, in words that do not echo the spaces.
  The empty string stays refused as it was.
- **`retract` and the `retract_note` and `skills` tools take an `ADR-<n>` label like every other verb that takes an
  id.** The label became the decision's id, which `retract` then names as a decision; a label two trees both carry is
  refused with both ids (`AMBIGUOUS_LABEL`).
- **The release job that tags waits for npm to serve the five packages.** npm can take minutes to serve a version it has just
  accepted, and the single check right after the publish failed the 0.1.1 run. The job now asks every 30 seconds, up to
  20 times (about ten minutes), goes on as soon as all five answer, and otherwise fails saying how long it waited.
- **`mnema check run --key` refuses a key that is not Ed25519, as `key restore --agent` and `key request --agent --key` do.** A
  P-256 or an RSA key file was accepted and then failed further on; it is now refused up front with `UNREADABLE_KEY` and
  the same account of what is wrong with the key (an agent's key is an Ed25519 one), ending with the way to make a checker key, and nothing is recorded.
- **Both verifiers check a tail's proof of ownership under the key the tail id names, and nothing else.** The Python
  verifier looked the key up by the proof's own `signerFp`, so a `tailproof.json` that another key of the record signed
  over the tail's id was verified there and refused by `mnema verify`. `mnema verify` checked the signature under the
  tail's key without comparing that key with the proof's `signerFp`, so a proof the tail's key signed naming another key
  was accepted there and refused by the Python verifier. Both now refuse a proof whose `signerFp` is not the fingerprint
  the tail id begins with, as `signer-mismatch`. `mnema verify` also recomputes the fingerprint of the key file it checks
  a tail proof under, as it already did for a checkpoint's key: a tail with no checkpoint yet, whose key file held
  another key that signed the proof, verified there and was refused by the Python verifier. No record a mnema binary
  writes is touched: a tail's proof is signed at birth by the key its id is named for.
- **`mnema verify` and the page `mnema site` writes refuse a committed key file whose name is not its key, as the Python
  verifier does.** A `keys/<name>.pub` that no tail, checkpoint, enrolment or tail proof uses, and whose material does not
  hash to `<name>`, was read as a committed key with no tail, a note, and the record verified; the Python verifier refused
  it. Both now refuse it, in the same words: the file *is named for a fingerprint its own material does not hash to*
  (`FORMAT.md` section 6). A key nothing uses whose name is its fingerprint is still a note. No record a mnema binary writes
  is touched: every key file is written under the fingerprint of the key it holds, which records written by 0.1.1 and by
  this version, with a person, an agent key, a checker, a second machine and a restored and protected key, were checked for.


### Changed

- **What `verify` says of a file when it is given a base commit is a sentence.** A file the record held at the base commit and no longer
  holds, and a file that no longer begins with the bytes it held there, are said as `since <rev> (<commit>): <file> was
  in the record there and is not here` and `since <rev> (<commit>): <file> no longer begins with the bytes it held
  there`, without the `gone:` and `rewritten:` labels. The exit code and the JSON reading are unchanged.
- **The pages say what the rules hook costs per edit, host by host.** Measured on one machine (version 0.1.1, a sandbox,
  50 runs each, without the real host): about 1 ms at the median per edit in Claude Code, where the hook is a call on a
  server already running (the server's own start, 270 to 350 ms, is paid once per session), and about 200 ms at the
  median per edit in Cursor and VS Code, which start a process per edit even where no rule addresses the file. Before,
  the pages gave only the orders of magnitude.
- **The step that checks the manifest signature of Claude Code, and the steps that read a host's version, in the
  host-contract workflow no longer rely on a pipe.** A host that printed more than one line could fail the step on a
  broken pipe, and a signature check that reads its own output through a quiet `grep` could do the same.
- **The Python reader no longer carries type aliases it never checked, and its comments no longer say how many vectors
  carry a field.** The comments say how many were published when the finding was made (October 2026).

## [0.1.1] - 2026-10-20


### Changed

- **The install is `npm i -g @mnema/code`.** The README, the install page, the package pages, `mnema doctor` and the
  plugin's hand-over hook no longer say that nothing is on npm or that the install is from the source; the source build
  moved to `docs/build-from-source.md`, for whoever wants the `main` branch. The five published packages' pages carry a
  badge with the version npm serves, and one test holds the install line to the page.

## [0.1.0] - 2026-10-20

### Added

- **A `Release` workflow publishes the five packages after a person approves it, and only then tags.** It runs on a
  push to `main` and by hand (`mode: publish` or `tag-only`). When the root version is not the one npm serves, it runs
  the packed install on Node 24.15.0, 24 and 26, waits for the approval in the `npm` environment, and publishes the
  five tarballs in the order chain, core, context, stacks, code with `--provenance`, with no token and no secret (npm
  trusts the workflow through OIDC); a package already at the version is skipped. Only after the five are on npm does
  it create the tag and the release, whose notes are the CHANGELOG section. While `@mnema/code` is not on npm, a push
  publishes nothing and says the first publication is by hand; `tag-only` is for after it. `CONTRIBUTING.md` now
  describes the procedure for the first version (written with `release:prepare 0.1.0`) and for the next ones. A test
  reads the file and holds the triggers, the environment, the permissions, the absence of any secret, the order and the
  tag coming after the publish. The workflow has not run: nothing was ever published, and the trusted publisher is set
  on npmjs.com by a person.
- **`pnpm release:prepare [x.y.z] [--check]` writes a release's one number everywhere and cuts the CHANGELOG.** It writes
  the number into every tracked `package.json`, `plugin.json` and `gemini-extension.json` that declares a version (found
  by asking git, not from a list), into `packages/code/src/version.ts`, `packages/chain/src/version.ts` and the
  `--version` line of `cli.help.golden.txt`; turns `## [Unreleased]` into `## [x.y.z] - date` with an empty
  `## [Unreleased]` above it and a link to the release; and makes `recordings/console.cast` and its GIF again when the
  number moves (that step needs a build, `agg` and a pseudo-terminal). Without a number it proposes one from the
  Unreleased section (Added, Changed or Removed is a minor, anything else a patch), says why, and applies it; `--check`
  changes nothing and exits 1 if something would change. A test runs the script on a copy of the workspace's manifests,
  plus one at a path nobody listed, and fails if any is left behind.
- **A job after the merge asks the network for every image and link of the READMEs.** A new workflow runs on each push
  to `main` (and by hand): it reads the front page's README and each package's README, asks every absolute address
  (an image, a link, a `srcset`) up to three times, and, if one answers with an HTTP error, opens one issue under a
  fixed title or adds a comment to the one already open. An address with no answer at all is listed and never opens an
  issue, and a run where nothing answers is refused. It is not a pull request check, so a pull request still carries
  the same checks, and it does not look at anchors, which a server never sees. It has run only in its tests so far.
- **The front page's Features table is now "The mnema family".** The section shows the family's picture, then a short
  table: the product, what it is for, its status and a link. `@mnema/code` is the core; the Action, the SDK and the
  VS Code extension are the three packages around it, each not published and run from a clone; Stacks are commands of
  the mnema program; the agent in CI is a recipe on the Action's page, not a package; and the page that verifies itself
  is a command of `@mnema/code`. The script that draws the front page writes the picture's block, at the family's
  width, by an absolute address on `main` with no version, and a test holds the page to that block, the address, the
  width and the text alternative (now one constant, shared by the script and the test). What the old table said
  line by line is on `docs/features.md` and the pages it linked. The picture's own pixels, and how GitHub and npm
  render the `picture` element, are not held by a test.
- **A picture of the mnema family.** `docs/assets/the-family-{light,dark}.svg`, drawn by
  `.github/the-front-page/draw.mjs` in the front page's one accent and on its loop: `@mnema/code` in the middle (the
  wordmark, the record's chain of blocks, and its two surfaces, `mnema` and `MCP`), with the SDK, a VS Code extension,
  an agent in CI, the Action, the site page and Stacks around it. The head of each line says which way the record goes:
  into the middle for what writes, out to the card for what reads, both for what does both; Stacks are drawn apart,
  grey and dashed, and since the middle installs them and does not read them out, no ring leaves it for them and their
  card lights in its own grey. Every word on it is a line of the product, held by the same tests as a package's
  picture; the test of the one accent now reads a gradient by its stops. A table written in the test says which way
  the record goes on each line, and holds to it, from the drawing alone, the heads, the way each dot runs, the ring
  around the middle and Stacks' grey; another holds every shape, its stroke included, inside the frame at every place
  it moves to. On the light page the tabs are fainter inside and a landing block lights in the accent itself, so each
  keeps three to one against what is behind it; the lines inside a block stay under that, as shading of a block whose
  outline keeps it. The words "A page that verifies itself" are held to the front page's README: a rewrite of that
  section keeps them, or moves the picture's anchor with it. The README of `@mnema/code` opens with it, at the
  family's width, described as the picture describes itself; the front page shows it too, under "The mnema family".
- **Each published package opens its README with a picture of what it does.** `@mnema/chain`, `@mnema/core`,
  `@mnema/context` and `@mnema/stacks` each carry an animated picture, light and dark, in `assets/`, drawn by
  `.github/the-front-page/draw.mjs` in the family's paint and motion: the same glow behind the drawing, tinted cards
  edged in the accent, a dot that runs the way it points each arrow a record travels (the moves `@mnema/core`'s table
  only allows, in grey, and the struck line `@mnema/context` does not write back have none), the edge of a card
  pulsing as the dot lands, and a block lit as it lands on the chain. Each drawing sits on the middle of its frame,
  24 units or more in from each side, and what a card holds sits on the card's middle. `@mnema/code` opens with the
  picture of the family, which it stands in the middle of, and has no picture of its own. Every word on a picture is
  a literal of the package, held by a test to the file that says it. Each picture paints its own page, so the dark
  one still reads where a page shows it on white. Tables written in the test say where each arrow of each package
  runs from and points to, and whether a dot runs it, and hold the drawing to them; others hold, for every package
  and the family, every shape inside the frame, the drawing on the frame's middle, and every text in the size and
  weight of one role, and, for every package, the room at each side and the text of each card on its middle, at
  rest. No test holds how strongly a colour stands out against what is behind it. The README points at the file on
  the `main` branch of the repository its `package.json` names, by `raw.githubusercontent.com`, with no version in
  the address: the picture loads before anything is published and is not in the tarball. The script writes the block,
  and a test holds each README to exactly that block and holds that no image address carries a version. The price of
  that address: the page of an old version on npm shows today's picture from `main`, not the one that version was
  published with. The title, the picture and the badges are centred, each in an element npm keeps `align` on (an `h1`
  and two `p`, not a `div`); the script writes the title and the picture, and a test holds the three.
  The licence badge at the top of each of those pages points at the file on `main` by an absolute address, because npm
  leaves a relative one written in HTML as it is; a test holds that address and that no address in the badges is relative.
- **A glossary.** `docs/glossary.md` defines, in one sentence each and with a link to the page that holds the
  definition, the words the documentation uses in a sense of its own: record, tree (public, private and global),
  tail, checkpoint, run, rung, stack, agent key, census and witness. The README's list of pages links to it.

- **A page on what two machines see when they moved one decision apart.** `docs/convergence.md` runs the case
  (one machine rejects a decision, another that had not read it accepts it, and the tails meet) and shows what `show`,
  `brief` and `verify` print, then separates a divergence, which every reader applies and `show` says (and `brief`, of a
  rule it prints, one left in force), from a move the workflow does not allow, which no reader applies and `verify`
  names. Its example is run by a test, and the second machine's answers are held equal to the first's.

- **The format says what one version promises another, and a refusal of a line a newer mnema wrote names the
  version.** `FORMAT.md` §7.1, from the first version published to the npm registry: every version reads every record
  an earlier one wrote, under the contract its `kind` and `v` selected, the proof taken over the line as written; a
  line whose `kind` and `v` a version's table does not declare is refused and never skipped; and a rule of
  authenticity or legality is never loosened inside a `kind` and `v` that exist: a new permission, one between
  records included, is a new `kind` or `v`, and the envelope gains no field inside an existing one. The section also
  says what is not covered: the rules changed before the first publication (the workflows, the retraction by its
  author, `after` in the envelope), a rule tightened inside an existing `kind` and `v` after it, which an older binary
  reads under its own rule without refusing anything, and the order between tails. `verify`, and a read such as
  `status` that stops on such a line, now say *mnema \<version\> does not read "\<kind\>" at v\<n\>: it reads that
  kind up to v\<m\>* (or *no version of that kind*), and that a newer mnema reads the line if one wrote it; before,
  they said `unknown event kind`, or a version ahead of the known latest. The Python reader names the pair and what
  the table it read declares of the kind. A record this product's command line wrote is frozen in the repository, and
  both readers have to verify it with every move applied. A record read through the `inherit` verb that holds such a
  line is refused by `inherit set` and `inherit update`, and shown as not read in the brief, with the same sentence
  before `verify`'s summary.
- **The workflows a decision, a task, a skill and a run move through are part of the format, and no reader applies a
  move they do not allow.** `FORMAT.md` §6.7 and the `workflows` object of `event-schema.json` hold the tables the gate
  already wrote by, so the artifact's digest changes. A move is judged at its point in the merged order: a birth once, a
  row of its table with the proof the row requires, a supersede naming a decision the record holds, a run ended once,
  and a `from` that is the state the subject is in there or the one its writer saw (its own tail, and what it cites). A
  move written by hand with a valid key that breaks one of these (a rejected decision accepted, a state that does not
  exist) stays on the record and is applied by no reading: not by `show`, `status` or `brief`, not by the projection
  kept in the tree, and not by the reading of one subject a gate judges a move on. `verify` names it in its census
  (`illegal-move`, with the rule), informational: the verdict, the level and the exit are what they were. Two moves out
  of one state where the second writer had seen the first are not said as a divergence any more, and `show` and
  `brief` say that a divergence is moves on machines that had not seen each other. A record read differently from
  before: two moves out of one state on one tail (writes that raced before the tail had a lock, before 2 October), and
  a move by a machine that cited nothing, sorted by its clock before what it had read, or made out of a state its own
  tail had already seen the subject leave; each is now not applied, and named. A machine that cited nothing and whose
  tail holds nothing of the subject is held to a state the subject had been in, so two such machines moving one subject
  out of one state are still a divergence. A binary from before applies every move.
- **The Python reader beside the format judges the same moves, and names a retraction it does not apply.** It reads
  the tables from the `workflows` of `event-schema.json`, judges every move where the merged order puts it, and names a
  move they do not allow as a note with the same rule, at the same tail and `seq`, as `verify`'s census; a note or a
  link taken back by an identity that did not write it is named the same way (§6.4). Neither moves its verdict. A new
  case holds the two readers to the same list over one record per rule, two machines with and without citations, and
  drawn records on two tails; `mutate.py` gains the move as an input both readers accept, and its `verify … record`
  prints one more `ok` on a record that holds a move. When the first line of a tail does not read (a byte-order mark
  an editor put in front of the file) and no line that reads founds the identity of the tail's key, that line is the
  one place the founding can stand: the Python reader now says once, as not judged, how many events that key signed
  for its own anchor, instead of naming each as signed by a key not enrolled. Any other line that does not read is
  read as before: the folds (§6.2, §6.4, §6.7) read every line that does, so a cause they name can be a consequence of
  the refused line. `verify` leaves the whole tail out of those folds instead, so for such a record the two readers'
  lists of causes can differ; both refuse it. The Python reader also names CRLF in the checkpoints and the tail
  proof, with a case for each.
- **`mnema key restore --agent <name> <file>` puts an agent's key where a CI runner's agent signs with it, and the Action's page has the recipe.**
  A runner begins every job empty, so the key comes from a secret: the verb installs it in the agent's own folder
  under the data directory, and refuses before writing anything a key the project's committed record does not enrol as
  that agent under that name, one the record retired, one that is not Ed25519 or is protected by a passphrase, and a
  folder that already holds another key. It appends nothing to the record and writes nothing beside the person's key.
  `key restore` without `--agent` now names this verb when it refuses an agent's key, and `key request --agent` refuses
  a key given by file that is protected by a passphrase, and says, of one given by file, that it is not installed and
  where the verb that installs it is. The page `packages/action/README.md` replaces its recipe for an agent in CI: the
  old one said nothing of which key the agent writes with, and a runner without one minted a key on the first write and
  founded an identity of its own in the public record, which `verify` read as clean. The step it publishes is run from
  the page by a test, on a clone with an empty home.
- **Two kinds for a key that signs as a person's agent: `agent.enrolled` and `agent.retired`.** An agent key is a
  member of the identity that enrolled it, under a name; `FORMAT.md` §6.2 says the role, and both readers (the product
  and the Python second reader) refuse a fact the key signs for another identity, under a `which` other than its name,
  or of a kind that changes who may sign, and a fact it signs after a signature-covered retirement. The catalog has 34
  kinds and the published vectors are 38. `verify` counts, in its census, the facts an agent key signed (`attested`)
  and, behind `--verbose`, every other `which` (`declared`, the key that signed stated it); an agent key the record
  retired after it signed is named too (`retired-agent`, with and without the flag, as a retired checker is). The
  second reader says the same counts, and none of them moves the verdict, the level or the exit. A binary from before stops reading a record that holds either kind, as for any kind it does not know.
- **The verbs that make, enrol and retire an agent key, and a server and hooks that sign with one.**
  `mnema key request --agent <name> --anchor <id>` makes the key in the agent's own folder under the data directory
  (`agents/<name>/`, in the clear, never beside the person's key) and prints a line; `mnema key enroll --agent <line>`
  records it with the person's key in the committed tree and, where the key lives on this machine, in the project's
  private tree and the machine's global one (outside a project, the global tree alone; `mnema key enroll --agent <name>`
  takes the name for the line; one line per tree says what happened, and the verb exits 1 when a tree refuses what the
  others took), and says when that key is unencrypted, which leaves the separation to nothing; `mnema key revoke --agent
  <fingerprint> --reason <why>` retires it in every tree of this machine that enrolled it, and `key revoke` of an agent key names that
  verb. A key retired in a tree this machine reaches is retired for every tree it reaches: `mnema key request --agent <name> --anchor <id>` then puts the retired key
  in `agents/<name>/retired/` and makes the agent a new one under the same name. An agent key is not counted among an
  identity's own keys where the last one may not be retired. `mnema mcp --agent-key <name>`, `mnema before-a-write --host <host> --agent-key <name>` (each also
  read from `MNEMA_AGENT_KEY`) and the verbs of the command line that write sign with the key in each tree whose record enrols it under
  that name, and the `which` of what they record is the name the record of that tree gave the key, not what the client
  announced; in a tree that does not enrol it the person's key signs, as before, and the server says so for each such
  tree (and again when the session lands on a project; a name that is no agent's at all is said once, when it opens), and where the person's key is protected and `MNEMA_KEY_PASSPHRASE` is not in the environment, or is not on this machine, the write is
  refused (`AGENT_NOT_ENROLLED`), naming the verb `key enroll --agent`, and nothing is signed or minted (in the hook
  what is not done is the recording of the fact: the reply to the host is unchanged and says why). The advice to put the passphrase in the environment of an agent's host is gone from the refusal of a
  protected key and from `key protect`. The hook files and manifests the host table generates pass the host's name, and the plugin has
  an `agent_key` option, empty by default. `mnema show <id>` marks a decision an agent key recorded or ruled
  (`attested by its own key`), `mnema audit accountability` says `claude 40 (38 attested)` beside an author for an agent whose key signed some of its facts, and with `--json` it carries `attested` beside an agent's count where
  there is one (read from the index, as `show` reads everything; `mnema verify` is what judges it), and `mnema doctor` lists the agent keys of the machine against the project's record. The core now
  names `enrollAgent`, `retireAgent`, `enrollAgentFromRequest`, `retireAgentKey` and `requestAgentEnrollment` in
  `@mnema/core/write`, and the shape of an agent's name (`AGENT_NAME`, `agentNameRefusal`) in `@mnema/core`.
- **A write routed to another project that does not enrol the agent says the person signed it.** The reply of a write
  sent to a project of the workspace other than the session's own (the `project` argument, or a transition on an id
  only that project holds) carries one more line where the server was asked to sign as an agent, the project's tree
  does not enrol it, and the person's key signed: the agent the facts name is declared, not attested. Nothing is said
  without an agent, where the agent signs, in the global tree, or for a `project` that names the session's own
  project, which the opening of the session already spoke of.
- **A page on signing as an agent inside a sandbox.** [`docs/agent-hosts.md`](docs/agent-hosts.md) gives the three verbs of
  an agent key in order, says that under one operating-system user it separates nothing the model's own commands can read,
  and says, from the documentation of Claude Code, Codex and Gemini CLI, what each host's sandbox leaves readable (none
  denies the data directory by default), the four things Claude Code needs together, and the profile Codex and Gemini CLI
  ask for. The verbs were run, in a throwaway home directory; no host was started, and VS Code and Cursor are not covered.

- **What each host sends of the plugin's 27 tool definitions is measured, per host, in the host's job.** The
  first request that carries a list of tools is read off what each real host sends its stand-in model, in the
  non-interactive run the contract starts (`claude -p`, `copilot -p`, `opencode run`, `gemini -p`, `codex exec`);
  no interactive mode is measured. In it Claude Code, the Copilot CLI, OpenCode and Gemini CLI carry the whole
  definition of all 27 (49,903, 50,029, 50,956 and 56,729 bytes; 11,384, 11,524, 11,498 and 12,715 tokens in o200k,
  a relative measure), against 54,231 bytes and 12,303 tokens for the server's own listing; Codex carries none and
  one `tool_search` entry that lists the server (2,866 bytes, 678 tokens), and what its search returns for each tool
  is not measured; VS Code's agent is offered none of them in its job, so it is not measured. The figures are those
  of the binary the job installs. The descriptions of `guard` and of a write's `project` changed, and both are longer (the entries under Fixed and Changed); a case per host is red when that binary wraps a
  definition differently or a definition gains a word.


### Changed

- **The `Release` workflow publishes exactly the tarballs it tested, and asks for approval before it tags.** A job
  without `id-token` now installs, builds and packs the five, and uploads the tarballs with their SHA-256; the packed
  install installs those very files on Node 24.15.0, 24 and 26; the publish downloads them, checks the SHA-256 and
  publishes them, installing and building nothing, so no install or build runs while a job can ask for the OIDC token.
  The tag and the release also run in the `npm` environment, after a publish and in `mode: tag-only`, so nothing is
  tagged or released without the reviewer's approval. `.github/the-packed-install/run.sh` takes an optional directory
  of tarballs to install instead of packing its own. The publish checks each tarball against the SHA-256 the packing
  job exposes as its outputs, and does not install a newer npm: it only fails if the npm it has is older than
  11.5.1. `CONTRIBUTING.md` says what to do when a publish stops halfway: run the workflow again, which skips the
  packages already at the version, and that a rerun packs the head of `main` as it is then. The test of the workflow holds the
  environment in both jobs, no `id-token` in a job that installs or builds, the publish without install or build, the
  publish needing the packed install and no `always()` in its `if`.
- **The five published packages carry no source maps and say where in the repository they live.** `files` of each now
  leaves out `dist/**/*.map` (a map pointed at sources the package never shipped), and `repository.directory` names the
  package's folder. The packed install check runs on Node 24.15.0, 24 and 26, its script stops at nothing but still
  fails at the end, and it fails if a tarball carries a `.map`.
- **Two more lines read as they mean.** The first line of what the status reading prints is now `<identity>, where things stand.`, because the identity already carries a colon (`mnid:<hex>`); and the description of the `rules_before_an_edit` tool has a comma before "and the host holds the write", so that it is the host that holds the write and a person that cites the rule's id. No word changed; the description weighs one byte more.
- **The text the program prints reads better where the sweep of the em dash left a chain of colons or an ambiguous
  comma.** Only the punctuation changed, and no word: the `--global` line of `--help` (the parenthesis
  "(left out by default)"), the line `mnema completion --help` prints about where the script goes, the lines of
  `mnema doctor` and `mnema key protect` about the agent key and the private tree, the note an MCP session logs for an
  agent key not in force, the sentence for a tree passed over, the two refusals about a checkout whose key left the
  record, the line `mnema recall` prints when nothing could be read, the `bootstrap` description of the MCP server
  and the description of the hooks.
- **The rest of what the program prints no longer carries an em dash.** The lines of `mnema doctor` (what it found
  and what to do about it), of the key commands (the lines for an agent's or a checker's key, enrolling and retiring
  one), of `mnema verify` (what each tree says, the notes about `--against-github` and `--against-sigstore`, and
  the lines `--since` prints: `gone: <file> ...`, `rewritten: <file> ...`), of `mnema witness`, of the decision import
  (`docs/adr/0002.md: no level-1 title; nothing names the decision`), of the task commands and `timeline`
  (`Task <id>: 2 legal move(s):`), of the line after `run start` (`for <agent>: <goal>`), of `rules-file`, and the
  help of every command now use a colon, a comma, a semicolon or parentheses where the dash stood. Where the dash
  was a pair, commas or parentheses stand in; where it joined a label to what it says, a colon does. Nothing else in
  those lines changed: a battery of 288 commands, run on the program before and after with the same swaps applied to
  the older output, prints the same text. The rationale the correction hook writes into the proposals it records now
  reads `in these words: “...”, matched by the shape ...`; proposals recorded before keep their words. What
  the MCP server answers, the descriptions of its tools, the sentence under the title of the program and the
  texts a plugin carries lost their dash in the same way.

- **The lines the program prints most no longer carry an em dash.** A decision's label now reads
  `ADR-2: Keep money as integer cents`, a colon where a dash stood, in the opening document, in what shows one record
  and in the lists. A link the program states reads `Linked A -refuses-a-write→ B` with a hyphen before the relation
  (the arrowhead is kept), and the line after a write says `Landed in the public tree: committed with the repository`.
  The same holds for where things stand (the identity, then a comma), a count followed by what reads it
  (`docs/adr (2): ...`), the last run and its goal, the way a rule is cited at an edit, the line about a backup key
  and the line of a project that already exists, the paragraphs of the opening document, the notes under a list of
  tails, runs, usage and references, the report of a problem (its title no longer has a dash before the
  fingerprint), the messages that name an identity the record does not know, and the same words in the help pages.
  Nothing else in those lines changed: where a dash was a pair, commas or parentheses stand in; where it joined a
  label to its description, a colon does. A file generated before keeps its old characters until it is generated
  again, and the check that compares it with the record will say so. The importer of decision files written by others
  still reads a dash in a title. The replies of the MCP server lost their dash in the same way.
  The recordings on the front page were made again with the binary, so they show the new lines.

- **The lines `verify` prints, the Action's comment and the refusals of the core no longer carry an em dash.** The
  headline of a level reads `local integrity verified (T1 only): no signature was checked`, and
  `local integrity FAILED: see issues`, a colon where a dash stood; the lines about a tail's census, about the external
  witness (`external witness (T3): covered, Bitcoin block ...`) and the sentence for an author that is not covered
  read with a colon, a comma or a hyphen in the same way, and so does the comment the Action posts and the messages
  with which the core refuses a write. The second reader written in Python says the not-covered sentence in the same
  words. `mnema init` writes the header of `.mnema/.gitignore` and `.mnema/.gitattributes`
  without a dash in a repository that has none; a file that already exists is not rewritten, so the old header stays
  in a repository that was initialized before. The recordings `first-record`, `a-write-refused` and `console` were made
  again with the binary. The description of the tools `skills` and `search` lost its two dashes as well, so the
  `tools/list` is 12 bytes smaller (6 for `skills` and 6 for `search`), and the four weights above are the new ones.

- **The text the CI scripts print, the manual's sample output and the notes on hosts no longer carry an em dash.** The
  verdicts of the scripts that guard the trunk (`RULER BROKEN: ...`, `NO ATTRIBUTION FOOTER: ...`,
  `LEFT BEHIND: ...`) and the notes `docs/evidence.md` keeps on Codex and the Copilot CLI use a colon or commas where
  the dash stood, and the sample output in `docs/cli-reference.md` reads as the program prints it. A table cell the
  red-run report left empty now reads `n/a`. The importer of decision files written by others still accepts a dash
  after the number of a title.

- **Every link in the body of a published package's README is a full address on `main`.** The five pages
  (`@mnema/chain`, `@mnema/core`, `@mnema/context`, `@mnema/stacks` and `@mnema/code`) had 22 relative links, such as
  `../../docs/install.md` and `./FORMAT.md`, that land on GitHub from the package's directory; the npm page resolves
  them against the root of the repository and, read from the code of its renderer and not measured on the site, drops
  the `blob/` and the directory, which leaves a missing page or the wrong directory. They are now
  `https://github.com/felipesauer/mnema/blob/main/<path>` (`tree/main` for a directory). The price: a click on GitHub
  now leads to `main`, not to the commit or the branch the page is read on. A test holds that no destination on those
  pages is relative, and that each address of this repository on `main` names a tracked file (`blob`) or directory
  (`tree`) and a heading that exists.

- **A record the gate cannot read refuses the write, where it used to let it through.** When a line of the record is one
  the reader refuses (not JSON, a kind or a field this version does not know, as a newer mnema's line is, or bytes that
  are not canonical), the per-edit gate answered nothing: the command hook exited 1 with an empty reply and the MCP route
  answered a tool error, and every host this plugin wires read either as leave to write. Both now answer `deny`, exit 0,
  in each host's shape, for every write the gate is asked about, with the tree (public, private or global) and the line
  named in the reader's words, and the ways out: update mnema, or restore the line, from the repository's history for
  the public tree and, for the private and the global tree, which are not versioned, from a copy or by repairing or
  removing that line. Nothing is recorded, and a note goes to the second stream. Only that line is caught: a busy tail
  or a fault of the product is not turned into a refusal, and a last line a crash cut short is still dropped and
  refuses nothing. The cost: a line of the project's public or private tree refuses every write in that project, and a
  line of the machine's global tree, which every project reads, refuses every write in every project of the machine;
  on a team with two versions, a line only the newer can read refuses every write of the older in that project until
  it is updated; and switching the refusal off is no way out, because the switch reads the same record. With no
  `mnema` on the PATH the gate still says nothing. `UnreadableLineError` is now exported by `@mnema/chain`.
- **Pages stop promising more than verify and the Action do.** The "what it proves" paragraph in the CLI reference
  and in the `@mnema/code` README said an edit to the record is made "impossible to hide"; verify shows when what is
  in the record has changed since it was signed, and a cut that leaves the last checkpoint in place, and by default does not catch
  a cut off the end that takes the last checkpoint with it, or a whole tail deleted. The reference's line on cutting
  part of a tail no longer says every such cut stays loud. The page on packages
  and the one on the site said the Action "only reads"; with a `checker-key` it also writes signed rule results to the
  working tree. The page on how it works no longer says an edit "cannot be made quietly".
- **The `@mnema/code` page on npm fits one reading, and the reference is its own page.** The package README held 1,877
  lines of every verb and tool; it now says what the package is, how to install it, the first record, what it proves and
  what it does not, and where to go next. The reference moved, whole, to [`docs/cli-reference.md`](docs/cli-reference.md).
  In `docs/what-it-proves.md`, the row on an agent key's signature is one short cell, and the rest of it is the section
  "An agent key, in full", below the table.

- **The root README opens with what mnema is, why, and where it stands.** Under the banner, one line names the category
  and the promise follows unchanged. A Why section says where an agent's choices usually live (a chat that ends, one
  tool's memory, somebody's head) and that mnema writes them down in the repository instead, with their reasons and what
  was turned down, signed and only growing, handed to each session where the host runs hooks and checkable offline; it
  gives no result of its own and points to `docs/evidence.md` for what is measured and what is not. A Status section says, in one place, that nothing is on npm yet (with the install
  page), the Node range, and that the GitHub Action, the SDK and the VS Code extension are not published; it replaces
  the line under the opening and the comment at the top of the Quick start.

- **`FORMAT.md` and the chain package's page say what the two readers do, not what they once did.** The format no
  longer says it leaves the workflow out (§6.7 is part of it), says the order of tails decides what §6.2 refuses and §6.7
  names, writes the tie-break once (`at`, then the tree, then the tail id by UTF-16 code unit, which both readers now
  follow), lists the seven rules a move can break, the cycles of the task workflow, the vectors beyond one per kind and
  the two git files in the layout, and no longer says every gap found in the writing was closed. The package page draws
  the tree as it is on disk, says a tail is a directory, that a birth whose state is not the workflow's own is not
  applied, and what the format and the Python reader cover. No behaviour changed.
- **The GitHub pre-releases `v0.1.0-beta` and `v0.2.0-beta` and every tag, `archive/alpha-0.14` included, were
  withdrawn, and until the packages are on npm the mnema is installed from the source** (`docs/install.md`).
  `mnema doctor` and the plugin's hand-over hook no longer print a release URL: they say that nothing is on npm yet and
  give the address of that page. The version sections below point to the commit they came from.

- **The README's Quick start accepts the decision it records, and says what the `verify` line is.** A decision is born
  `proposed`; `mnema decision move accept <id> --note "…"` puts it in force. `verify` reads the signed record, not the
  decision's state: it prints the same one line, the green, for a proposed decision and for an accepted one.

- **`mnema mcp` opens and reads where no key signs, and a connection that only reads makes no key.** A machine with no
  key of its own, a host asked for an agent that no tree enrols while the person's key is not on the machine, a retired
  key, a key the record proves a member of two identities: the session opened for none of them, so even `bootstrap` was
  refused, and which of two roots a host listed first could decide whether the project that enrols the agent could be
  written in at all. The session opens and serves its reads now, and each write is refused in the tree it was for, with
  the verb to run. The key of a machine that has none is made at its first write, as before, and no longer to answer a
  read. `guard` reads the move and its proof by the tree of the task, whichever root the host listed first, and where
  no enrolled agent signs in that tree and your own key is not on this machine it says the enrolment refusal (and
  `REVOKED_KEY`, where the agent was retired). It also says the refusal that comes from the key (see Fixed below).
  One limit stays: a connection whose first
  signer is in a project it did not list first reads `resume` and `focus` with no actor and no last run, because those
  read the trees of the project it opened in.
- **The command line and the hook read `MNEMA_AGENT_KEY`, and make nothing for the agent.** The verbs that write a
  fact an agent's key may sign (`decision record`, `decision move`, `decision import`, `memory`, `observe`, `task`,
  `skill`, `link`, `unlink`, `retract`, `handoff`, `switch`, `tail prune`, `run`, `stack`, `check declare`, and the
  `corrections` and `promote`, which write through them) now read the variable as the server does: where the record of
  the tree written enrols the agent's key, the fact is signed by it and names the agent the record gives it, and a `--which` that names
  another is not recorded (one line on the error stream says so); where it does not, your own key signs when it opens
  without a terminal, and the `which` is the name the variable asked for, declared; where it does not open, the
  write is refused (`AGENT_NOT_ENROLLED`, `REVOKED_KEY`, `AMBIGUOUS_MEMBERSHIP`) and no key and no identity is made for
  the agent. Before, a machine that held only the agent's folder and no key of yours made a key and founded an
  identity in the public record when a verb ran with the variable. `mnema memory` and `mnema observe` with the
  variable and no `--scope` go to the private tree, as with `--which`. `mnema before-a-write` reads it too (the flag
  wins). `init`, `key …` and `check run` do not read it: what they write is a fact of the person's, and the format
  refuses an agent's key there. A name this product does not enrol is refused, as the entry under Fixed says. `mnema
  doctor` no longer says the process signs as you where your own key may be protected or absent.
- **The pages and the help of the agent key say what the code does, and no more.** The refusal of a write where the
  person's key would sign in place of an agent's is for a key that is protected and with no `MNEMA_KEY_PASSPHRASE` in the
  environment, or not on this machine (the pages said a protected key and no terminal; no terminal is looked for), and in
  the hook it is the recording of the fact that is not done, the reply to the host unchanged. `key enroll --agent` makes
  the key's consent again only in the private and global trees, for a key that lives on this machine; the committed
  tree takes the line's identity or refuses. `key revoke --agent` and a retirement reach the trees of this machine. The
  `which` of a fact is the client's announced name unless an agent key signed it. The refusal of a protected key and
  `key protect` say that the host is then told to sign with the key (`mnema mcp --agent-key <name>`, the plugin's
  `agent_key` option). `mnema doctor` says the agents the generated files ask for only where an agent key is held, and
  its `MNEMA_AGENT_KEY` is its own environment's. That VS Code and Cursor pass the plugin's `agent_key` option on is
  said as not measured where the option is named.
- **A write routed by `project` says the absolute directory it fell in.** The seven write tools that take `project`
  (`capture_memory`, `record_observation`, `record_handoff`, `link_knowledge`, `create_task`, `record_decision`,
  `create_skill`) now add `  In the project at <path>.` to their confirmation, right after the line that says which
  tree it landed in. A `project` can be a name the caller carried, and a conversation can outlive the
  connection it learnt the name in: after a reload the workspace may hold another directory by that name, and the
  write, signed and append-only, resolves to it. The path tells two directories apart where a name shared by both
  does not (one directory can still have two paths, through a symlink); this makes the landing visible at once, it
  does not refuse the write. A write that named no project says nothing new, and neither does one that landed in the
  global tree, which belongs to no project. The line adds 22 bytes to a confirmation (its own 21 and the newline
  before it) plus the path: 72 bytes for a 50-byte path; the tokens depend on the path. The two write confirmations the budget golden measures
  (`record_decision`, `capture_memory`) name no project, so the golden does not move.
- **A reported run no longer repeats its actor, and the focus inside a resume no longer names it.** A run in
  `bootstrap`, `resume`, `focus` and `guard` carried `who`, and `resume.focus` carried `actor`, each the same value as the
  `actor` the answer already gives (every run listed there is one of the actor's). They are left out of the
  derivation, so the MCP tools and the `--json` of the CLI's `status` and `resume` serve the same shape: `who`
  is gone from every run (the `focus` that `guard` pairs with its verdict loses it too) and `resume.focus` is
  `{ openRuns }`. The `focus` read on its own and the `focus` of a `guard` keep their own `actor`; no other field moves.
  Dropping the field is a change to the public API of `@mnema/context`: `ReportedRun` no longer has `who` and
  `Resume.focus` no longer has `actor`.
  `bootstrap` 2,418 to 2,104 bytes (936 to 784 tokens), `resume` 1,441 to 1,127 (591 to 439), `focus` 899 to
  743 (371 to 295), in o200k, a relative measure; each open run past the first saves another `who`. A reader that took the actor from a run takes it from the
  answer's `actor`.
- **The tools of the MCP server answer in JSON without indentation.** Every read (`bootstrap`, `focus`, `resume`,
  `search`, `read_record`, `skills`, the `audit_*` reads, `governing_rules`, `next_actions`, `guard`) wrote its
  payload indented by two spaces, which the host hands to the model as text, so every space of it is read on every
  call. The document is the same one (`JSON.parse` gives back an equal value; no field was added, removed or
  renamed) and is 9% to 58% smaller in bytes over the fixture record of the budget golden: `bootstrap` 3,623 to
  2,418 bytes (1,258 to 936 tokens, o200k), `resume` 2,224 to 1,441, `audit_accountability` 2,205 to 916.
- **The text a hook hands a session no longer carries the paragraph on regenerating the file.** `mnema brief --hook`
  opened every session with how to regenerate `MNEMA.md` and check it against the record, a paragraph for whoever
  holds the file and no use to a session that holds none; it is left out, 393 B and 96 tokens (o200k) fewer at
  every opening. `mnema brief` without the flag prints the paragraph as before, so the file and the staleness
  check are unchanged.
- **The framing the rules carry at each edit is one sentence.** The rules pushed at a write, the pause that asks for a
  person and the hold on a first write opened with two sentences, one naming what was served and one saying whose text
  it is; at an edit where one of them speaks they open with one, "Recorded for this project: text the people and agents
  working on it wrote.", which keeps the claim about who wrote the rules and drops the repeated subject. The rules, their
  ids and the sentence about another run are the same. 46 B fewer at each edit where one of them speaks (rules pushed 380 to 334 bytes,
  102 to 93 tokens, o200k; the pause 564 to 518, 147 to 138; the hold on a first write is the same sentence, not
  measured separately). The opening of a session and the notes keep their two sentences.
- **A write's `project` takes only the absolute path of a project of the session, never the name of its directory.**
  `capture_memory`, `record_observation`, `record_handoff`, `link_knowledge`, `create_task`, `record_decision` and
  `create_skill` refuse `project: "api"` as `UNKNOWN_PROJECT`, with "use the path:" and the paths of the session whose
  directory is called that (all of them when none is), and write nothing. A name is not stable between connections, and
  the record is signed and append-only: after a reload, the `api` a conversation carried landed in another checkout of
  it without a refusal. The reply to a write routed by `project` still says the directory it fell in. The reads are
  unchanged. `AMBIGUOUS_PROJECT`, which only the name could earn, is gone; the description of `project` in the tool
  definitions changes, and so do their weights (see the contract tests).
- **Linking, by the command line or by `link_knowledge`, refuses in the public tree a target that is a path outside the project.**
  A link from a rule to `/etc/passwd` under `governs` was accepted and committed to the tree every clone receives, an
  address no clone can open (the reply said it "covers nothing here", after the fact was signed). It is now refused as
  `OUTSIDE_PROJECT` before a writer is opened, under the relations that carry an address (`governs`,
  `asks-for-a-person`, `refuses-a-write`): an absolute path that does not lie under the project root, or a relative one
  that climbs out of it (`../x`). A path inside the project, spelled any way, and an id are accepted, and an absolute
  path under the root is recorded relative to it (`/work/repo/src` is written `src`, the root itself `.`), by the same
  reduction the gates compare by, so that a clone with another root reads the same address. A relative target is
  recorded as typed, and so is any other relation (`derived-from` cites the file a proposal was read from). The private
  and global trees stay on one machine and keep taking any path, as typed. The `--help` of `link` says so. `unlink` and `retract_link` take the
  same absolute path back: the target as typed is looked for first (a link recorded absolute by an earlier version stays
  retractable), then the one `link` would have recorded. `refs`, `timeline`, `audit_refs` and `audit_timeline` take it
  too: asked by the absolute path, they also find the links recorded relative to the root, each edge once, and in a
  workspace of several projects the path is reduced against the root that contains it and read in that project's
  tree (`audit_refs`, `audit_timeline`, `retract_link`; the last also follows a link to the project that holds it, and its reply says where the retraction fell and, when the agent is not enrolled there, that the person's key signed it).
  An edge of `refs` and `audit_refs` found that way still ends at the path as typed (`to`) and says what the tree
  holds in `recorded` (`"recorded": "src"`); an edge found as typed has no such field.

### Fixed

- **The convergence page's test no longer depends on the day it runs.** The page shows the time of each move
  with the day it was written; the test read a bare date as minted but not the same date ahead of the `T` of a
  timestamp, so it passed only on the day the page was written. Both are read as a date now.
- **The second reader breaks a tie between two tails by UTF-16 code unit, as `FORMAT.md` §6.2 says and `verify`
  does.** It compared tail ids by code point, which puts a character above U+FFFF after one from U+E000 to U+FFFF where
  the format puts it before. With two heads at one `at` on tails whose ids differ there, it took them in the other order
  and named another move under §6.7 (a second birth on the other tail). Tail ids this product writes end in a hex
  installation id, so their order does not move.
- **A clone that rewrites line ends no longer turns an honest record red, and when it happens anyway the refusal
  says CRLF.** A `git clone` with `core.autocrlf=true` (the Git for Windows default) put a carriage return at the
  end of every line of the record, and both `verify` and the second reader refused it whole with the sentence a
  tampered line gets. The project tree now carries a `.gitattributes` holding `* -text`, written like its
  `.gitignore` at the first write and added to an older tree at its next one; it reaches a clone once it is
  committed. A line whose only difference from its signed bytes is a final `\r` is still refused, by both readers,
  and the cause now names the CRLF and the remedy. `FORMAT.md` also says what both readers always did with an empty
  line in the middle of a file: it is passed over.
- **Every character the Unicode standard says draws nothing is made visible.** The soft hyphen, the Hangul fillers,
  the variation selectors (both blocks), the musical and interlinear format marks and the line and paragraph
  separators came out raw in `show`, `search`, `status` and `--json`; the class written as an escape is now every
  Default_Ignorable_Code_Point, the two separators, U+FFF9 to U+FFFB and U+13430 to U+1343F, as a fixed list at
  Unicode 17. A selector after an emoji is escaped too (`❤\ufe0f`).
- **The install page's steps work with a Node installed by the system.** `npm i -g` of the packed tarballs stopped at
  `EACCES` on `/usr/lib/node_modules/@mnema` where npm's global prefix is `/usr`; the steps now install under
  `~/.local` (`--prefix ~/.local`, with `~/.local/bin` on the `PATH`), `corepack enable` takes `--install-directory
  ~/.local/bin`, and the page says when each needs permission. The block makes `~/.local/bin` and puts it on the `PATH`
  before the first `pnpm` (the shim directory is not created for you, and where `pnpm` exists only as that shim it is not
  found otherwise), and says the lines are for `sh`, not for Windows `cmd` or PowerShell. The test that holds the block
  to the page now holds that order.
- **A gate judges a move on the subject as the chain has it, not on the projection kept beside the record.** The
  state a decision, a task or a skill is in, whether a run is still open, and whether a subject or a supersede's
  successor exists at all were read from the projection a tree keeps in `locks/projection.db`, a cache nothing signs: edited by hand, it let a
  rejected decision be accepted, a cancelled task started, a rejected pattern adopted, a run ended twice and a
  decision superseded by one nobody recorded, each signed and passed by `verify`. They are read off the segments now,
  by the lines that name the subject, so each of those moves is refused with the gate's own code
  (`ILLEGAL_TRANSITION`, `UNKNOWN_BY`, `ALREADY_ENDED`), and a projection edited to send a move to another tree gets
  it refused there. `MNEMA_RUN` is proven the same way. Measured on the binary at 100 thousand events
  (123 MB of segments), a `decision move` costs about 0.33 s against 0.24 s before with the page cache warm, and
  0.61 to 0.77 s (median 0.70 s) against 0.24 s with the segments evicted from it; three moves at once in nine
  rounds refused none (`TAIL_BUSY`), as before. An id the canonical form does not write as itself is not searched
  for by its bytes: every line is read for it. A move written by hand with a valid key still puts on the record what
  the gate refuses, and `verify` does not judge transitions yet; `docs/what-it-proves.md` says so. Neither `show`
  nor `brief` says any longer that two moves out of one state "did not see each other": on one tail the second had.
- **A write refuses a tail cut inside what its last checkpoint signed (`TAIL_DAMAGED`), and leaves it as it was.**
  Before reading the checkpoint, the writer cut the tail's end back to its last newline, so a signed line truncated
  by an edit, a merge or a disk went with it, and so did a signed line that had only lost its newline (which `verify`
  read as whole). The next event then reused a seq the checkpoint had signed, failed to be signed, and the write
  exited 1 while the decision it carried showed in `status`. Both append doors now refuse first, under the tail's
  lock, when the last complete line is below the checkpoint's last seq, and every byte of the tail stays where it
  was. The refusal says what `verify` does with it: it fails on a signed line that is cut or missing, and passes on one
  that only lost its newline, so a pass does not clear the tail. Half a line above the last checkpoint, which is what a crash leaves, is still cut and
  written past.
- **The second reader refuses a stored line holding an integer no double holds, where it used to stop.** Past the
  largest double, `mnema_verify.py` raised an `OverflowError`, and past 4,300 digits a `ValueError` (the limit Python
  puts on converting digits), and either one ended the reading with a traceback and no verdict. It now refuses the
  line under section 1, as the product does: a JavaScript reader holds such a number as `Infinity`, which has no
  spelling. The exit status was not 0 either way, so no record read as verified.
- **The README's quick start says five release tarballs.** It said four after `@mnema/stacks` made them five, and an
  install of only four answers 404 for `@mnema/stacks`, which `@mnema/code` depends on. The test that holds the install
  line to `docs/install.md` now holds that count too.
- **The words of the agent-name refusal say what the code does.** The server says the refusal of a name that is no
  agent's once, at its opening, and no longer once for each tree it reaches. The `guard` description lists the codes it
  answers with, `AGENT_NAME_REFUSED` and `AMBIGUOUS_MEMBERSHIP` among them, and no longer says it refuses every agent a
  tree does not enrol (it does where the person's key that would sign instead is not at hand), and the `--help` of
  `--agent-key` on `mcp` and on `before-a-write` says that a name that is no agent's is refused. The command line
  labels `KEY_MADE_MEANWHILE` as it does every other refusal.
- **`guard` says the refusal the key of this machine would give the move, where it used to say ok.** `guard` answered
  `ok` for a task whose write was then refused for the key: the person's key protected by a passphrase with none in the
  environment (`KEY_IS_PROTECTED`), an agent that the task's tree does not enrol while the person's key that would sign
  instead is protected (`AGENT_NOT_ENROLLED`), an agent whose key was retired, whether or not your own key is on this
  machine (`REVOKED_KEY`). An agent that obeyed `guard` and supplied the missing `reason` was refused all the same.
  It now asks the key the way the write does, before the gate, without opening a key or making one, and answers the
  write's own refusal in its words and code (without
  ` The fact was NOT recorded.`). It cannot know a passphrase that is set but wrong (`KEY_PASSPHRASE_WRONG`), the
  record busy at that moment (`TAIL_BUSY`, `KEY_ROOT_BUSY`), or another write changing the task before the move; and
  where the machine has no key at all it still says `MISSING_WHO`, though the first write there makes the key and
  passes.
- **Refusing to retire the last key of an identity no longer says it is "the only key" while an agent's key is still enrolled.**
  The refusal now reads "the only key of <identity> that is not an agent's", which is what is true: an agent's key
  cannot sign an enrollment, so it is the last key able to repair the identity. A comment in the brief command that said
  the plugin hands the document over "with no file at all" now says "without writing a file", as the verb's own page does.

- **An agent key asked for under a name that is not an agent's refuses the write, and makes nothing.** With
  `MNEMA_AGENT_KEY=Claude` (or `--agent-key`) on a machine that held only the agent's folder, the command line and the
  server dropped the name, made your key and founded an identity in the public record, which is what the entry above
  says no longer happens. The name now asks for an agent all the same, and a name this product does not enrol
  (`AGENT_NAME_REFUSED`) is refused on the command line and by the server, naming the name that came and the form
  accepted: no key, no identity, no fact. The server still opens and reads; it is each write that is refused. In the
  hook it is the recording of the fact that is not done, the reply to the host unchanged and saying why.
- **A first write the operation refuses makes no key and founds nothing.** On a machine with no key, a write refused
  by the operation itself (`task move cancel` with no reason, `MISSING_PROOF`; a field over the size limit) made the
  machine's key and left an installation id in the project; through the server, whose session run opened before the
  operation decided, it also founded an identity in the public record (a public key, an anchor and a tail holding
  `identity.founded` and `run.started`), and the refusal said "This key founded an identity of its own". The key is
  made at the first write that lands now, as the entry above says: it is kept, with its installation id, at the first
  append, and the server writes its run after the operation's last refusal, in the hold of that write. Two processes
  making a machine's first write at one instant still make one key: the one that keeps second refuses
  (`KEY_MADE_MEANWHILE`), writes nothing, and its next write signs with the key that is there. The command line says it like every other refusal,
  `Refused (KEY_MADE_MEANWHILE): …`.
- **A first write refused for what it says makes no key and founds nothing either.** The refusals that judge the fact
  itself, `UNREADABLE_EVENT` (`task create ''`), `NOT_A_TITLE` (`<title>`), `NOT_A_REASON` (`***`) and
  `NOT_A_REFERENCE` (`observe '<id>'`), came after the founding. From an empty `HOME`, in a project another key
  founded, each left the key (3 files under the `HOME`) and 5 files in the public tree, among them a tail holding only
  `identity.founded` and no checkpoint, so `verify --require=signed` failed for the whole project; through the server
  it left 6, with a signed `run.started`, and the refusal said "This key founded an identity of its own", and a refused
  `record_observation` left the same in the private tree without a word. Every operation now asks the fact first and
  founds after: each of those refusals of the fact leaves no file in the `HOME`, the public or the private tree, on the command line
  and through the server (a refusal in the global or the private tree leaves its `locks/` folder there, empty), and the
  first write that lands founds as before. The refusals' words, and what `verify`
  accepts, are unchanged.
- **A client whose name is a marker (`<id>`) no longer founds on a first write the server then refuses.** The server's
  session run carries the client's name, and the door refuses a name that is a marker (`NOT_A_REFERENCE`), but it
  asked the run only after the founding, so an otherwise accepted first write left a key, an anchor and a tail holding
  only `identity.founded`, and `verify --require=signed` failed for the whole project. The run is asked with the
  operation's own fact, before anything is founded: that write is refused with the same words, leaves no file in the
  `HOME`, the public or the private tree, and a client with a name of its own founds as before.
- **The `project` in an answer is the absolute path again, not the directory's name.** `search`, `read_record`, `audit_refs`,
  `audit_timeline`, `audit_accountability`, `audit_antipatterns` and `audit_exposure` had begun to say `api` where the
  workspace held one `api`. A name is not stable between connections: with a workspace of `work/api` and `work/alpha`
  that said `api`, and a reload into one of `clones/api` and `work/alpha`, the same `api` echoed into a write landed
  in `clones/api`, in a repository nobody had named, and nothing refused it. The path echoed there is refused as
  `UNKNOWN_PROJECT` and writes nothing. A write's `project` takes only the path (see Changed), and the
  reply to a write routed by `project` still says the directory it fell in. The cost is what the shorter name had saved:
  the budget golden's eight answers grow back by the path minus the name, once per `project`.
- **The hook handler no longer fails to fall back when an older `mnema`, which refuses `--agent-key`, exits before
  reading its input.** A payload larger than the pipe met the closed pipe, and the handler took that for a failed
  run: it did not ask again without the option and answered nothing.
- **The agent-key verbs say what they wrote, tree by tree, and refuse what cannot be an agent's key.** A
  `key enroll --agent` run again over a partial enrolment no longer says `Enrolled agent` when nothing was
  written; a tree that cannot be written after others took the vouch is named with what the others kept, for
  `key revoke --agent` too, and a tree that refuses a retirement is no longer read as "no project". Outside a
  project, a line that is not an agent request is refused as one, not as "the key is not on this machine". On a
  machine that joined an identity each tree says which identity it took the key for. `key request --agent
  --key` with a P-256 or an RSA key is refused at once (`UNREADABLE_KEY`), where it used to print a line that
  `key enroll --agent` then refused as `UNPROVEN_REQUEST`; with `--key` it no longer says the key lives in a
  folder it did not make. `mnema doctor` no longer leaves out that the record proves a retired agent key a
  member of two identities. The help of `key enroll --agent` and `key request --agent` says that the private and
  global trees, for a key that lives on this machine, take the key's consent made again under their own identity, and
  that the committed tree takes the line's identity or refuses.
- **A server that signs as an agent finds the agent in every project of its workspace, and its run's end names the
  agent the record names then.** A write routed to another project (the `project` argument, or a transition on an
  id only that project holds) was signed with the person's root: it minted a key on a machine that held only the
  agent's, or signed as the person in silence where that project enrols the agent. The close of a run, which chooses
  its key when it is written, no longer stamps the `which` read when the run opened (a person who enrolled the agent
  while the host was open made `verify` report a `run.ended` its `which` did not name). Restoring a key refuses
  an agent key (`AN_AGENT_KEY`) before anything is written; a second `key enroll --agent` landing at the same moment
  is "already enrolled", not a member's key. `verify` says of an agent key with no tail both that it may have signed
  nothing yet and that its tail may have been dropped; a refusal for a retired key promises only the trees it
  reached, and the refusal at a session's opening names no single tree.
- **The sentences of two refusals say what was checked.** The refusal at a session's opening says it checked this
  project's trees and the global tree, not "any tree this session reaches"; the sentence of a request or refusal the
  hook could not record no longer ends in two full stops.
- **The second reader binds every event in a signed range to the checkpoint's signer.** The product
  refused an event whose `signerFp` is not the key that signed the checkpoint over it, and an event
  whose `which` is its `who`; `FORMAT.md` said neither, and the Python verifier read an event's own
  `signerFp` into the enrolment fold. So it verified a record in which a checker key signs a
  checkpoint over an event naming the person's key, and §6.2 saw the person. §6 now says both rules,
  with the set an identity is trimmed of written out (Python's `strip()` removes more than
  JavaScript's `trim()`), and both readers refuse that record. `mutate.py` builds it, and the case
  `which` = `who` + U+00A0; the gap registry has a twenty-seventh entry, closed. The product's verdict
  on any record does not move.
- **The agent key's refusals and census say what holds.** `verify` calls a retired agent key that has no tail
  "retired" in the census, in each tree, not "enrolled". The refusal of a write for an agent the record does not
  enrol says why the person's key cannot sign in its place: it is protected and `MNEMA_KEY_PASSPHRASE` is not in the
  environment, or it is not on this machine. `key revoke` with a protected key says so for the person who runs it
  (`KEY_IS_PROTECTED`), not with the advice given to an agent's host. `key request --agent --key` names the kind of
  key it refuses ("an EC key", "an RSA key") and, for a key given by file, the exact file the host signs with once it
  is put in the agent's folder.
- **A limit, declared: the role of an agent key belongs to the record that enrols it.** A record that has not heard of
  an `agent.enrolled` can enrol the same key as an ordinary member, and both readers accept it there. `mnema key
  request --anchor <id> --key <file>` now refuses a file kept in the agents' folder (`AN_AGENT_KEY`); that checks the place the file
  really is (links followed), not what it holds, so a link to it is refused and a copy kept elsewhere is not recognised. `docs/what-it-proves.md` and `FORMAT.md`
  say it.
- **The host contract holds the 2,048-character ceiling of a server's instructions against Claude Code 2.1.296 and later, which moved its default.**
  Claude Code cut a server's instructions at 2,048 characters up to 2.1.295 and cuts at 4,096 since 2.1.296, as its
  changelog says; `CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH` sets the number. The case now asks the host for 2,048, which
  2.1.285, 2.1.287 and 2.1.296 each keep, and the pin moves to 2.1.296. The product's own ceiling does not change and
  stays safe: it is the lower of the two. What it does not know is how a host reads a description of a tool past 2,048
  on 2.1.296; the pages that said "2,048" of the host now say up to which version.
- **The front page says what mnema is not, and groups the docs by who reads them.** `README.md` carries the four
  lines of `docs/where-it-fits.md` ("Not a semantic memory", "Not an agent runner", "Not a copy somewhere else", "Not
  access control") and lists the docs under use, verify, integrate and contribute; a case holds each line to the
  sentences of the page it comes from, and every page of `docs/` to one group. Two sentences said more than the code
  holds, and now say less: the front page said "what each one does, line by line, is in Features" of products
  Features does not describe (the page that verifies itself, the agent in CI), and `docs/where-it-fits.md` said "the most that leaves
  that machine" is a digest without saying that it leaves only when you run the witness verb, and that Sigstore
  sends the identity too; `docs/what-it-proves.md` now says Sigstore's leaving is where somebody ran it.
  "Not a copy somewhere else" no longer says that what you record privately never leaves the machine: the notes
  of every tree this machine holds, the private one included, reach the agent's host, which sends them to its model,
  both when a session opens through the plugin and when the agent asks for them (a search, or a record read whole,
  answers from the private tree too; both were run against the real server for this change), and the line and
  `docs/where-it-fits.md` now say so. The stamp's page, `docs/what-it-proves.md` and `docs/cli-reference.md` now say
  what the calendar receives: a hash of the checkpoint's digest joined to a random nonce, and nothing else of the
  record, not the digest itself (only the Sigstore countersignature, where somebody ran it, sends the digest and the
  identity); the glossary no longer says the private tree "stays on that machine" but that it is not committed. The
  guard holds the line to what it contains, not to what it adds, and does not hold what a host does with the text
  once it has received it.
- **The second reader's page no longer says a cut cannot take the checkpoints with it.** It can: events cut from the end
  of a tail while `checkpoints.jsonl` stays are reported, and `prev` catches a checkpoint dropped from the start or
  the middle, not the last ones. By default both readers accept the checkpoints file deleted alone, and the last
  checkpoints deleted with their events kept; with --require signed both refuse them. The last events cut together
  with the checkpoints that covered them pass at every level, in both readers; only a copy of the record from before
  the cut shows them gone, which is what verify reads with --since. The page, the reader's own text for that limit,
  `docs/install.md`'s sentence about other MCP clients, `@mnema/chain`'s threat table and the CLI reference's line on
  cutting part of a tail (which said such a cut reads "up to the last checkpoint"; it reads as fully signed) now say
  what was read. The second reader's page also no longer says every mutation of its tool is refused: three are
  accepted by both readers and two read INCOMPLETE, and no mutation is accepted by one reader alone. It now names a
  third place the two verdicts differ: with every tail deleted and the keys left, the product at its default level
  says verified with a note per key and exits 0 (it exits 1 with `--require signed`, and with `--since` over a copy
  from before), and the second reader says BROKEN and exits 3 at its default level and with `--require signed`. The
  other pages that said every mutation is refused (the page on verifying without installing, `@mnema/chain`'s
  README, the second reader's README and a test's comment) now say the same five. The lines in the CLI reference
  and the `@mnema/code` README that said verify does not catch a whole tail deleted now say that is the default, and
  what `--require signed` and `--since` do.
- **A record in which no tail holds anything is refused by both readers, by name.** With no tails/ directory, no tail
  directory in it, or only tails that hold no event and no checkpoint, the product's verify said verified (T1 only)
  and exited 0, and the second reader said BROKEN and exited 3 without saying which committed keys had no tail, or
  VERIFIED when a tail's proof was left behind. Both now refuse it under FORMAT.md section 4, at every level of
  --require, with exit 1, and both still name each committed key with no tail (section 6.5). The product rules on the
  committed tree always, and on the private and global trees when they hold a key or a tail. A record init founded is
  never in that shape, since init writes events and a checkpoint before it returns; a .mnema/ left half made by an
  init that failed is, and fails until a first public write founds it. The second reader keeps BROKEN for a path with
  no directory at it. One tail removed whole while another remains is unchanged: a census note, verified by both, with
  --require signed too. The list verify --json carries of what no requirement answers now says that, the newest
  events cut with their checkpoint, a record erased and founded again, and a removal older than the revision --since
  compares with; it no longer says a record whose tails were removed with their keys reads as a fresh one, which it
  never did. The CLI reference, the second reader's README, FORMAT.md, and the pages on what verify proves say the
  same. The Action's comment now quotes what verify said on stderr (the issues) before what it said on stdout (the
  census), so the refusal by name stays inside the quotation however many keys the record has, and the page the
  `site` writes says `the record` of an issue that has no tail instead of `#undefined`. `inherit` still decides
  nothing by this rule, but a commit whose record holds no tail with an event or a checkpoint now fails the verify
  that reads it, so it is read as unverified and contributes no decision.
- The repository no longer takes a new em dash (U+2014). A test reads every text file in the workspace and
  fails at the line and column of one written outside the areas not yet rewritten, which it lists with a ceiling
  that only goes down; where the character is data, its escape is allowed only in the files it lists, with the
  reason. The escapes that stood in comments as punctuation are rewritten, and `AGENTS.md` and `CONTRIBUTING.md`
  state the rule.
- **The version the program says is the one that will reach npm, `0.1.0`.** The repository declared `0.2.0-beta`, a
  withdrawn pre-release that was never published to npm, and the console's recording on the front page showed it. Every
  manifest, the two version constants, the plugin manifests and the golden of `--version` now say `0.1.0`, and the
  console's recording was made again from the built binary. The records of the withdrawn pre-releases below stay as
  they were.
- **The front page's banner, steps and "how mnema fits" are drawn in the family's paint and motion.** Each carries its
  own page and the accent's glow, tonal cards and dots that run their arrows; the banner's light is faint and moves
  nothing, the steps' numbers light one after the other, and a reader who asks for less motion sees the last frame.
  Their words, frames and text alternatives do not change; their text takes the family's sizes, and the family's
  guards hold them too.
- **The banner, the steps and "how mnema fits" stand on the middle of their frame, with room around them, and are
  fainter under the accent on a light page.** Each leaves 8 units between what it draws and every side of its frame,
  centred from top to foot as well as across; the frames grow by up to 16 units, so the drawings show a little
  smaller at the same width. On a light page the glow, the tints and the faces under the accent are fainter, the
  newest cube of the banner is the accent itself with its faces parted by the page, and the chips of the steps are
  edged at 1.5; the dark pictures keep their paint, and the words and text alternatives do not change. The test that
  holds a one-unit stroke to the middle of a pixel now reads every run of a path (absolute and relative), a
  rectangle, a line, a polyline and a polygon, with the stroke and width a shape takes from its groups, under the
  translates and uniform scales of `transform` attributes and of the keyframes a shape's style names; it names a
  curve, a circle or an ellipse, any other transform and a width it does not read. It refuses whole, by name, a
  picture with what it does not read: a `<use>`, a `<symbol>`, an `<svg>` inside the picture or any element it does
  not know; a stroke, a stroke width, a transform or an `animation-name` on the outer `<svg>`, or a `viewBox` that
  does not start at 0 0; `vector-effect`, `transform-origin` or `transform-box`; a transform, a translate, a rotate, a
  scale or the `animation` shorthand in a `style` attribute, the outer `<svg>`'s included; a stylesheet that sets a
  stroke, moves a shape or gives it an animation outside a keyframes, or a keyframes it cannot parse; no `</defs>`, a
  count of `<defs>` that differs from that of `</defs>`, or a shape before the `<defs>`; and an attribute not written
  as `name="value"`. Its CSS is read by a list: in a `style` attribute and in every rule and keyframe of a stylesheet
  it refuses any property but those the script writes (`animation` and four of its longhands, `opacity`,
  `transform` and `stroke-dashoffset`) and, in a `style`, a stroke and its width, so a `d`, an `offset-path` or an
  `inset` is named. It does not read the selectors of a stylesheet, the condition of an `@media`, or what a
  stylesheet writes outside braces.

## [0.2.0-beta] - 2026-10-11, a pre-release withdrawn, from before this line

### Added

- **`mnema verify --against-sigstore` names the run a Sigstore certificate carries.** From a GitHub
  Actions job, the note of each bundle now also says the repository, the workflow, the commit and the
  run the certificate names (Fulcio's extensions 12, 9, 13 and 21), and `--json` carries them as
  `ran`. A certificate for an e-mail names none. They name a run, not the agent or the model inside
  it; the verdict, the level and the exit are what they were. The second reader still names the
  bundle and does not check it. `docs/what-it-proves.md` has the row, and `packages/action`'s README
  a recipe for an agent in CI.
- **The plugin is ported to four hosts beyond Claude Code, from one table of the hosts.** `packages/code/src/host-names.ts`
  holds one row per host and one cell per rung, (a) the MCP server and a rules file, (b) the opening
  of a session, (c) a refusal before a write, (d) a pause for a person, each saying how it is known:
  held by a test, read once on the real host, or documented and not measured. The plugin's hooks
  files and manifests, a summary on the README and the whole table on `docs/evidence.md` are
  generated from it, and a test is red when one of them was edited by hand. Codex, GitHub Copilot
  CLI, OpenCode and Gemini CLI are ported: Codex and Copilot CLI read a manifest and a hooks file of
  their own in the plugin, OpenCode a module copied into the project, Gemini CLI an extension
  installed from a checkout. Each opens a session and refuses a write where a rule refuses it,
  Copilot CLI also pauses one for a person, and each is held by a job that runs the host's real
  binary against a stand-in model, with no account. `mnema before-a-write --host` takes `codex`,
  `copilot`, `opencode` and `gemini`, and `mnema brief --hook --host codex` cuts the opening to
  Codex's own ceiling at a whole rule. Cursor's editor, Antigravity's command line, Factory Droid,
  Qwen Code, Goose, Continue's `cn` and Warp's agent are rows at the first rung, documented and not
  measured; the first two have a script to read them by hand in `plugin/captures/`.

- **Stacks: the skills and agents a project adopts.** `@mnema/stacks` is the contract of a stack (a
  `stack.json`, skills in the open Agent Skills format, agents in a neutral format, declared hooks and
  a licence), with its validator and a digest anyone reproduces with `digest.sh`; it is released with
  the other four packages. `mnema stack add <source>` reads a folder, a tar archive or an `https://`
  git address, shows the plan whole and writes only when `--expect` names the digest it showed. It
  refuses a stack that brings an MCP server, writes skills and agents where the hosts that read them
  look, and records `stack.adopted` in the tree `--scope` names; `--to <folder>` writes the files and
  records nothing. A `stack.sigstore.json` is checked offline against the trust root the binary
  carries, and the plan names who signed beside the digest. `stack list`, `show`, `diff`, `check`,
  `export` and `remove` (which keeps every file changed since it was written) read and undo; a hook a
  stack declares stays off until `stack enable` shows its script and a person at a terminal types its
  name. A session's opening says which stacks govern the project, and `mnema doctor` and `stack
  check` say where the files part from the record. Two example stacks, `evidence-first` and
  `review-pass`, and an index of stacks with a link and a digest each (`stack-index/`) are in the
  repository.

- **A fault in mnema is not a refusal, and `mnema report` shows what it would say about one.** The
  last-resort catch tells an internal error from a refusal and says which it was. An internal error is
  logged on this machine, outside the record, and `mnema report` shows its report whole (mnema's
  version, Node's, the platform, the verb, the kind of error and where in mnema it happened, and
  nothing else), and keeps your answer: `--decline` for that kind of error, `--off` for all of them.
  It sends nothing: at a terminal it prints a link that opens GitHub's issue form with the report in
  it. The MCP server's instructions tell an agent to leave the report to the person, and no tool sends
  or accepts one. The bug report on GitHub is a form.

- **The edge of an edit says when another run was there.** When a rule refused a write or asked for a
  person at a path in another run of this machine's identity, in the last 30 minutes, a reply to an
  edit there that already has something to say (a rule's push, an asking, a refusal, the hold on a
  first write) ends with one sentence naming that run's agent and how long ago. It is read from facts
  the record holds and writes nothing.

- **An event can cite the heads it was written on top of.** The envelope gains an optional `after`:
  the entry hashes of the heads of other tails the writer had read and its tail had not cited yet.
  Every reader of many tails takes an event after what it cites, whatever the clocks said. `verify`
  names a citation the record does not hold and a tail whose clock ran behind what it cites, both
  informational, and the Python reader says the same.

- **`mnema promote`** lists what is in force, in the same words, in the committed records of two or
  more projects you name (`--workspace`), and copies one of them to the global tree as `proposed`,
  with a `derived-from` link to each instance you cite. It never scans the disk.

- **`MNEMA_CACHE_DIR`** keeps the cache of reads in a directory you choose: a checkout you cannot
  write to, the worktrees of one project, or a CI cache. It stays a cache.

- **`mnema rules-file` carries a rule addressed at a directory**, as `dir/**`, and says what each host
  adds to a glob.

- **The Python reader takes `--require signed`**, with the meaning `verify --require=signed` gives it.

- **A subagent is asked to hand its decisions back in a block that can be checked.** `mnema handback`
  runs at the host's `SubagentStop` event: a final reply that does not end in one fenced block whose
  info string is `mnema-handback`, holding `{"decisions":[{"settled","why","turnedDown"}]}` (the list
  empty where nothing was settled), is sent back once with the format as the reason; the second stop of
  the same subagent is let through. `mnema handback --schema` prints the JSON Schema the check applies.
  It checks the shape and never whether the subagent settled something, and it has its own switch,
  `subagent-handback`. Held against the real Claude Code binary; Codex and Copilot CLI document an
  equivalent event and the host table says so, with no port.

- **Stacks in the console and in the editor.** `mnema stack index [folder]` prints the entries of an
  index of stacks (name, version, link, digest, and the folder of one kept in the checkout) and
  `--json` gives them to a program; `mnema stack list --json` does the same for the installed ones. The
  console runs the stack readers and, as for every verb that can change the record, refuses the acts
  (`add`, `remove`, `export`, `enable`, `disable`) and names the shell. The VS Code extension, which is not
  published, gains a "mnema: stacks" panel: list, show, compare, check, export, remove, and add from a folder or
  from the index, each running the `stack` verb; an add shows the plan the command line printed, whole,
  asks once, and writes with the digest that plan showed. It has no control that turns a hook on.

- **The record can say which stacks govern the work.** Two new event kinds, `stack.adopted`
  (`payload.name`, `payload.version`, `payload.digest`, `payload.scope`) and `stack.removed`
  (`payload.version`, `payload.digest`, `payload.scope`), name a stack by its digest and say in
  which tree it governs: `public`, `private` or `global`. Neither carries a path, a source
  address or a credential: the write door admits only closed forms, and a reader refuses any
  field the contract does not declare. `mnema stack add` and `mnema stack remove` write them. The Python reader takes them
  from `event-schema.json` with no code of its own (`packages/chain/FORMAT.md`, section 6.6).

- **A Sigstore countersignature.** `mnema witness sigstore` signs the last checkpoint of each
  tail with a short-lived Sigstore certificate (the browser here; the job's own token in GitHub
  Actions) and files the bundle at `witness/<checkpoint>.sigstore.json`. Of the record only the
  checkpoint digest leaves; the e-mail, or the repository, the workflow, the commit and the run, goes into Sigstore's
  public log by design, and the help and the act say so. In GitHub Actions it refuses a private
  repository. `mnema key sigstore <identity>` records the claim (`account.linked`,
  `service: "sigstore"`, no new kind) that lets a bundle speak for an identity of the record,
  an e-mail as `sha256:` and the SHA-256 of the address, never the address; a workflow as it is;
  and
  `mnema verify --against-sigstore` reads every bundle offline against the trust root the binary
  carries, in notes. The Python reader names each bundle as not checked (gap G26).

- **A link can be taken back, by the identity that recorded it.** A new event kind,
  `link.retracted` (`payload.target`, `payload.rel`, `payload.reason`), names an edge the way
  `knowledge.linked` did and says why. `mnema unlink <subject> <target> --rel <label> --reason "<why>"`
  and the `retract_link` tool write it, after resolving an `ADR-<n>` label on either end as
  linking does. Nothing is erased: the link's own event stays, and every read that applies a link
  (`rules`, `before-a-write`, the opening brief, `governing_rules`, the edit census) stops seeing
  the edge once its only asserter took it back, so a rule addressed at a path stops acting there.
  The graph readings (`refs`, `diagram` and the `references` tool), which show the history of what names
  what, keep the link and mark it `(retracted by its author)`.
  Any key of that identity retracts it; another identity is refused with `NOT_THE_AUTHOR`, a
  retraction it signed anyway is not applied, and `mnema verify` names it in a
  `census [foreign-link-retraction]` line, informational, exit unchanged. The rule is in
  `packages/chain/FORMAT.md` §6.4, with a vector; no byte of any existing kind changed.
  Known limits: a binary from before this change refuses a record holding a `link.retracted` as
  an unknown kind, so `verify` fails there and every read of that tree stops with
  `unreadable stored line` until that machine is upgraded. And the retraction follows the link to
  the FIRST tree, in the order every locate walks, that holds a link of that edge: when another
  identity also recorded the same edge in an earlier tree, `unlink` is refused there with
  `NOT_THE_AUTHOR`, and there is no flag to point it at the later tree that holds yours.

- **`mnema doctor` sees what keeps VS Code's agent from loading the plugin, and `--fix vscode`
  mends it.** The doctor reads the user `settings.json` of VS Code (the places of each platform,
  the snap's old one included) and says whether `chat.pluginLocations` is set, whether it lists
  a mnema plugin that exists and is the version of the binary, and what to run. `mnema doctor
  --fix vscode` is the one thing it writes, and only when asked: it shows the change (`--dry-run`
  stops there), copies the file aside, edits that one setting without losing the file's comments
  or trailing commas, and refuses a file it cannot edit safely. It lists the marketplace copy of
  the plugin, whose path does not change at an update. The doctor also sees the mnema server
  declared in any project of `~/.claude.json`, one whose directory is gone included, and says
  how to remove it, and names a script on the `PATH` that shadows the real `mnema`.

- **The record says which key is a backup.** A new event kind, `backup.declared`
  (`payload.backupFp`), says that one of an identity's keys is kept off the machine. `mnema init`
  writes it when it enrolls the cold backup. `verify` and the Python reader read it: a declared
  backup with no tail is said as `census [backup-key]` on every machine, so an honest clone no
  longer carries a `census [key-without-tail]` note, and any other key with no tail still gets
  one. The declaration is accepted only from the key's own identity (one naming another
  identity's key is refused) and takes effect only when a checkpoint covers it
  (`packages/chain/FORMAT.md`, section 6.5).

- **An optional git hook that suggests the `Mnema-Decision` trailer.** `mnema commit-hook install`
  writes a `prepare-commit-msg` hook, `mnema commit-hook uninstall` removes it, and nothing else
  installs it: not `init`. It follows `core.hooksPath`, refuses (naming the path) to replace a hook it
  did not write, and removes only a file that is byte for byte its own. In a commit made in an editor
  it appends `#` comment lines naming the decisions in force that govern the staged files, which git
  drops unless the `# ` in front of a line is removed. It never fails a commit: with `mnema` missing
  from the hook's `PATH`, or failing, it does nothing.
- **A `mnema_path` option on the plugin.** Both plugins declare a `userConfig` option for the
  absolute path of the `mnema` to run; left as `mnema` (the default) they run the first one on the
  `PATH`, as before. The hooks read it from `CLAUDE_PLUGIN_OPTION_MNEMA_PATH` and the MCP server
  through a small launcher (`server/launch.mjs`) that treats an unsubstituted placeholder as no choice
  made, so a host that does not know `userConfig` still starts the `PATH`'s `mnema`. The manifests
  also carry the `$schema` of the Claude Code plugin manifest.
- **A guard on the plugin's `hooks.json`.** A test refuses an event, a matcher-group key, a handler
  key or a handler type that Claude Code's hooks documentation does not list (the list carries the
  date and the page it was read from), so a typo that would leave a hook silently mute turns the
  suite red.
- **Example rules (`examples/rules/`).** A first rule ready to take as it is: an edit to `biome.json`
  is held for a person (`asks-for-a-person`). It is a short script of `mnema` commands, and a test
  runs it against a sandbox and checks that the product asks for a person on that file and on no
  other.
- **`--stdin` and `--body-file` on `skill create`, `memory` and `observe`.** The long text of a
  write can come from standard input or from a file instead of the line, as it already could for
  `decision record`; the text typed on the line (`--body`, the `memory` argument, `--text`) still
  works, and a line that gives it from two places is refused with the places it named. A missing
  text is now this refusal, not the parser's.
- **The SDK names the id behind an `ADR-<n>` label.** `acceptDecision` and `rejectDecision`, handed
  the label a write printed instead of an id, refuse as before (`UNKNOWN_DECISION`) and now carry a
  `message` with the sentence the command line and the MCP server say: the id (or ids) that label
  stands for. The three doors say it from one function.
- **`mnema rules <path>` and `mnema why <path>` read a path where it really lands.** A path that
  a link leads to somewhere else inside the project is read again
  at that place too, with the same resolution the write gates use, and the rules of both places are
  added together, each once, so the reading never says less than the gate applies; a link that
  leaves the project is answered as written. The same
  resolution now reads a relative link from the directory it really sits in, so a link inside a
  directory that is itself a link no longer climbs out of the way it was spelled.
- **`doctor` and the plugin's hand-over hook point at the pre-release.** With no `mnema` on the
  `PATH`, or another program answering to the name, they used to say `npm i -g @mnema/code`, which
  answers 404 until the packages are published; they now give the install of the pre-release from
  its four tarballs, the line the root README gives.
- **A checker key can be retired.** `mnema key revoke --checker <fingerprint> --reason "<why>"`
  records `checker.retired`, a new event kind, signed by any identity of the record, as an
  enrolment is. Once a checkpoint covers it, `mnema verify` refuses a `check.passed` or
  `check.failed` the key signs after it, any other fact it signs, and a `checker.enrolled` naming it
  again; `check run` and `key enroll --checker` refuse the key. The results it signed before stay
  valid and `verify` names them in its census, informational, because a leaked key can date a
  result before its own retirement. `mnema audit accountability` says who retired the machine. The
  Python reader folds the same rule, and the two readers agree on it.
- **The Action runs the checks.** `@mnema/action` takes a `checker-key` input, the private half of
  a checker key from a repository secret: after its other steps it runs `mnema check run` with it,
  leaves the results in the working tree and fails when a check did not pass. A declared program
  is started without the Action's inputs in its environment.
- **What each host hands the MCP server it starts is measured in the host jobs.** In place of
  the product's own server, each job starts one that writes down the name the client announced, the
  executables above it and which of a closed list of variables exist in its environment (names
  only, never a value or a path), and the case asserts them by value. Held for Claude Code, Codex,
  GitHub Copilot CLI, Gemini CLI and OpenCode; in VS Code's agent's job no handshake of the plugin's server
  is seen, and a case says so, without saying why. The table is in `docs/evidence.md`.


### Changed

- **Every third-party action in the workflows is pinned by the SHA of a commit.** `uses:` named a moving major tag
  (`actions/checkout@v7`); it now names the 40-hex commit, followed by `# vX.Y.Z` for the release it was taken from,
  and a test is red on a tag, a branch, a short SHA or a SHA with no version. It does not check that the SHA
  belongs to the tag in the comment. Dependabot's `github-actions` ecosystem is unchanged.
- **The host contract checks are named for their host alone on a pull request and a push.** The six jobs
  carried the pinned version of the host in their name (`host contract (codex 0.161.0)`), so raising a pin
  would have renamed a required check; the name is now `host contract (codex)`, and the version stays in
  the run's summary. The weekly and manual runs append the version they were given, and nobody requires
  those. A test reads the workflow and is red on a name that is not the host plus that one suffix.
- **The node 24 cell runs the suite once, instrumented, and the coverage floors carry a declared slack.** The cell used to
  run it twice (plain, then for the coverage gate). Floors are now 93.7 statements, 86.8 branches, 96.0 functions
  and 95.2 lines: the figures measured on the runner (94.23, 87.33, 96.54, 95.71) minus half a point. The guard that
  scans the workspace for callers of the gate's derivation reads the tree once, where it read it once
  for each name it asked about.
- **The private tree lives beside the repository's objects.** Inside a git repository it moved from
  `<project>/.mnema/private/` to `<git common dir>/mnema/<project path>/private/`, so `git worktree
  remove` no longer deletes private notes; every worktree reads the same notes and writes a tail of its
  own. `mnema doctor` names a worktree that still holds notes in the old place, and `mnema doctor
  --fix private-tree` moves them (`--dry-run` says what it would move).
- **Ed25519 is verified under one strict rule** by the product, the Python reader and the page
  `mnema site` writes: canonical encodings, no key and no `R` of small order, and `S < L`. A signature
  that some Node versions accepted over a small-order key is refused by all three. The 1,077 vectors of
  Wycheproof, CCTV and ed25519-speccheck, copied with their licences, hold the three to one verdict.
- **A stored line that is not UTF-8 is refused** by every reader, naming the byte, where it used to be
  read with U+FFFD in place of the bad bytes. A torn last line cut inside a character is dropped, as
  any torn last line is.
- **`mnema --help` is grouped by the flow of the work**: Record, Hand over, Verify, Read, The git log,
  This machine, Called by a host, with only the name in the column.
- **The console has a band behind each command sent and a dot before each answer**, with a faint line
  under an answer that names the verb, how long it took and the hour; the guide down the margin and
  the margin are gone.
- **A refusal of a write opens with the rule that refuses it**, and says the shell is not covered.
- **An e-mail address in a body is replaced with `<email>`** before it is recorded, on every door, and
  the reply says so.

- **Eight verbs went under the noun they belong to; the old names are gone, with no alias.**
  `skills` is now `skill provenance`. `focus` is part of `resume`, which lists the runs the actor
  has open under the last one (`--json` already carried them as `focus`). `accountability`,
  `antipatterns` and `exposure` are now `audit accountability`, `audit antipatterns` and
  `audit exposure`. `handoff`, `next-actions` and `guard` are now `task handoff`, `task next` and
  `task guard`. The tools of the MCP server keep their names. The console, which offers only the
  verbs that cannot change the record, no longer runs `task next`, `task guard` and
  `skill provenance`, because a group is classified by its most powerful member.

- **A clean `mnema verify` is one line.** The census note about the backup key `init` makes and the
  line saying the private tree holds no record are informational, and now come only with the new
  `--verbose`. A break, an issue, any other census note and the exit are the same with and without
  it. `docs/where-it-fits.md` says what a signed commit proves and what a mnema record does.
- **Requires Node 24.15.0 or a later 24, or 26.0.0 or later.** The floor was 22.12.0; Node 22
  and Node 25 are out of the range. The library that checks a Sigstore bundle (`@sigstore/verify`
  4.1.2) declares `^24.15.0`, and the binary refuses any Node outside the range in one line, a 22,
  a 23, a 25 or a 24 below 24.15.0 included. CI runs the suite on 24.15.0, the current 24 and 26.
- **The cache is `node:sqlite`, and nothing is built at install.** The projection cache used
  `better-sqlite3`, a native addon downloaded or compiled per platform and ABI; it now uses the
  `node:sqlite` the Node ships (a release candidate from 24.15.0, no warning there), so there is no
  install script and no prebuilt binary to miss. The record, its format, the locks and the cache's
  tables are the same, and a cache written by the older build is replaced on the next read, as any
  cache of another build is. Measured on a 1,500-event record against the build before, no verb
  is more than 1.04 times what it was.
- **The Action's own test has room in its time limit.** Its cases start the real `mnema` binary
  (seven processes of set-up and two per run); the slowest took 4.3 to 4.5 s measured alone against
  the 5 s default, and went red once on a loaded runner. The limit is 20 s for that file; nothing
  in it waits on a network.

### Fixed

- **A refusal no longer says a write was not appended when it was.** Every write now appends and signs
  in one hold of the tail's lock. It used to sign under a second hold, and when that one was refused
  the reply said "not appended" about a fact already on the chain.
- **A busy tail no longer turns a rule off.** The edit gate decides a refusal or a pause by reading and
  answers whatever the append does; when the fact cannot be recorded in its time, the reason says the
  refusal could not be recorded, and why.
- **A lock file that names no pid is broken once it is older than 10 seconds**, where it used to refuse
  every write until somebody deleted it.
- **A Node below the floor is told so in one sentence**, where some versions failed to load the program
  first: the entry checks the version before it links anything else.
- **A tail directory that holds no event is not counted as a tail**, which made a witnessed record read
  short of `fully-signed`.
- **An `ADR-<n>` label means the same thing in every verb that takes an id.** `decision move`
  refused the label while `link` accepted it and recorded the text "ADR-1" as one end of an edge
  pointing at nothing. A label that names exactly one decision in the project is now accepted
  (`decision move`, `decision supersede`, `show`, `refs`, `timeline`, `observe`, `check declare`,
  `link`, and their MCP tools and SDK calls) and is turned into that decision's id before anything is
  looked up or written. A label two trees both carry is refused with the ids that carry it, and a
  label no decision carries is refused by `link` instead of being recorded.

- **A tail's lock is no longer taken from a live holder.** A waiter used to break a lock a minute
  old even when its process still answered, so a holder that was alive and slow (a stopped process,
  a suspended laptop) could end up with a second writer on the same tail. Only a lock whose process
  is gone is broken now; a pid reused by an unrelated process keeps the tail busy, and the refusal
  says to delete the lock file it names.
- **A timestamp calendar is contacted only on the https port.** A proof naming an operator's host on
  another port is refused and not contacted.
- **The by-hand capture scripts read from the home they say they use.** In the script for Cursor's
  editor, `claude plugin list` ran before the scratch `HOME` was exported and read the plugin of the
  real one; it now runs after. In the script for Antigravity's command line, the block that writes
  the probe did not enter the project first; it does. The scripts for Cursor's command line and
  editor gain a case, `what-the-host-hands-the-server`, that registers the same server the host jobs
  use and has a person copy the name the client announced, the executables above it and which
  variables of the closed list exist, names only, into the capture.

### Known limits

- The hand-back check is on by default: a subagent whose final reply lacks the block costs one extra
  turn (the stand-in model's session took about half a second longer, measured on Claude Code); its
  switch, `subagent-handback`, stops it. Claude Code also fires `SubagentStop` for its internal
  agents, and each of those is sent back once too; VS Code and Cursor were not measured.
- A binary from before `after` stops reading the record once an envelope carries it, as it does for
  any field it does not know; one from before the UTF-8 rule reads a line that is not UTF-8 instead of
  refusing it.

- A binary from before `stack.adopted` and `stack.removed` stops reading the whole record once
  one is in a tree it reads, as it does for any kind it does not know (`packages/chain/FORMAT.md`,
  section 4.1).

- A binary from before `checker.retired` stops reading the whole record once a retirement is in
  the committed tree, as it does for any kind it does not know (`packages/chain/FORMAT.md`,
  section 4.1).
- A retirement does not take back the results the key signed before it: they verify, and the
  census names them. Which of them the key signed after it leaked, the record cannot say.

- A binary from before `backup.declared` stops reading the whole record once `init` has written
  one into the committed tree, as it does for any kind it does not know.
- A record written before `backup.declared` carries no declaration, and a later `init` does not
  add one: its backup still reads as `census [key-without-tail]` on every machine but the one
  that made it, and the note says that an undeclared backup reads that way.
- A Sigstore bundle is no witness level: it never moves the verdict, the level,
  `--require witnessed` or the exit. The trust root is carried, not fetched, so a bundle signed
  after Sigstore turns its keys over reads `not covered` on this binary. The suite signs against
  Sigstore's own test doubles; the public instance was signed against once, by hand, through the
  `Sigstore probe` workflow.

## [0.1.0-beta] - 2026-10-05, a pre-release withdrawn, from before this line

The first release of this line: `@mnema/code`, and the three packages it is built from. The
numbering starts over here: it does not continue the 0.x alpha.
Requires Node ≥ 22.12.0; the packages are ESM-only.

### Added

- **A front page that says who it is for.** The root README opens with the promise, honest badges and
  the first-record recording, then who it is for and when not to use it; one section lists what else
  the product does, each with what it does not prove. The package pages gain the log read against
  the record, the inherited record, `doctor`, the plugin's skills and the server-only plugin.
- **A guard on commit e-mails.** The pull request job that keeps the tool's footer out of the record
  now also refuses an author or committer outside `*@users.noreply.github.com` (GitHub's own
  `noreply@github.com` is allowed as a committer), and the non-merge commits of one pull request
  must share a single author address, since the squash turns any other into a `Co-authored-by`.
- **A library door to the record** (`packages/sdk`, not published): `openRecord` records a decision, accepts
  or rejects one, takes a note, reads the brief, the notes and the rules for a path, and verifies the
  record, each by calling the function the matching command calls; `mnemaHooks` returns the
  Claude Agent SDK hooks that hand a session the opening document and ask the record before a write.
  A test holds the command line, the MCP server and the library to the same events and the same
  refusal codes. `@mnema/code` gains one subpath, `library`, which only the SDK is meant to import.
- **A VS Code extension for the person who judges** (`packages/vscode`, not published): a lens over
  each file a rule in force addresses, a panel of decisions awaiting judgment that accepts or
  rejects through the command line's own decision verb with the required note, a notice when one is proposed while
  the window is open, and the verify level and channel state in the status bar. Every read and
  write goes through the `mnema` command line.
- **Decisions inherited from another repository** (the `inherit` verb): a project points,
  in the committed `.mnema/inherit.json`, at a git repository that holds a record and at one commit of
  it. `mnema brief` prints that record's decisions in force in a section of their own, naming the
  repository and the commit; they are read and never signed by the project, and the project's
  `verify` does not count them. A record that does not verify at the commit prints none, and the
  brief says so. Moving the pointer is explicit and shows what changes first; the copy is kept
  under the mnema home, outside the project. Inheriting is trusting that repository at that commit.
- **A rule can carry its check** (the `check` command): a decision in force names the program that
  checks it, and a machine with a key of its own records, at a commit, whether the rule held. That
  key is enrolled by a member of an identity (the `--checker` form of the key request and enroll
  commands) and signs check results only: `mnema verify` refuses a check result from any other key
  and any other fact from that key, and `mnema audit accountability` lists it as a machine. Four new event
  kinds, read by both verifiers.
- **A GitHub Action over the record** (`packages/action`, not published): on a pull request it keeps
  one comment saying which events the pull request adds to the record and which changed files an
  accepted rule addresses, and fails the check when `mnema verify --require=signed` fails. An
  optional input also fails it when a rule that asks for a person addresses a changed file and only
  the author has approved. It reads the record and writes nothing but the comment.
- **A signed, append-only record in the repository.** Decisions with their reasoning and the
  options turned down, the patterns a team works by, tasks, handoffs, memories and
  observations, as typed facts in `.mnema/`, committed with the code and handed to every
  clone. Every fact is hash-chained, and every write the command line or the MCP server makes
  is signed before it returns.
- **Three trees to write to**: the committed project record the team shares, a private one
  for the machine, and a global one for what outlives a project. Every write says which tree
  it landed in.
- **A lifecycle for decisions.** A decision enters `proposed`, is in force once `accepted`,
  and is changed only by a new decision that supersedes it, never by an edit. A move the gate
  does not allow is refused with a typed reason, the same on the command line and over MCP.
- **Two surfaces over one record** in `@mnema/code`: an MCP server over stdio (`mnema mcp`)
  that an agent writes through while it works, and a command line for reading, auditing and
  verifying.
- **`mnema verify`**, which needs no private key and no network, names the level it reached
  instead of answering yes or no, and exits non-zero on a broken record, so it drops into CI.
  `--require=signed` catches checkpoints taken out from under the events they signed; a cut
  that took the newest events with their checkpoint reads as a shorter honest record.
- **An outside witness, opt-in.** `mnema witness stamp` has the public OpenTimestamps
  calendars attest a checkpoint's digest, so a record rebuilt later cannot claim a history.
  Only the digest leaves the machine.
- **Secrets kept out by their format.** A value in a shape the product recognizes never
  reaches the chain; a password written out in prose does, and nothing deletes a fact
  afterwards.
- **A Claude Code plugin.** A session opens with the decisions in force, the adopted patterns
  and the notes recorded for the project: first the ones that share a word with what the
  session touches (the files changed in the working tree, the tasks in progress, the branch,
  the last three commits), read with no model, then the newest. At each edit, the rules addressed at that file land beside the result
  of the write, and a rule recorded as asking for a person holds the write until one decides.
  Each channel can be switched off, and switching one off is itself a signed fact. VS Code's
  agent and Cursor's command-line agent are handed the opening.
- **Reads that pay for what arrived, not for the record.** The projection the command line and the
  hooks read from is kept on disk beside the record, brought forward by the events that landed
  since the last read, and rebuilt whole whenever it cannot be shown to be a continuation (a
  sealed segment whose size or modification time changed, the active one whose size changed, a
  different record, a different build). A rewrite of the active segment that keeps its size is
  not seen by the projection, and `verify` refuses it. Deleting it changes no answer, only the
  time. A write numbers, moves and checks who counts from that projection rather than from a
  replay held under the lock; measured at 100 thousand events, 0 of 27 writes timed out waiting
  for the lock with the projection warm, and 1 of 18 on the first use.
- **A console.** `mnema` alone at a terminal asks what you want to do here, and its first
  door opens a session that reads the record and refuses to write. It needs a window at least
  80 columns wide and 42 rows tall.
- **`@mnema/chain`, the proof engine, released on its own** with zero runtime dependencies.
  Its tarball carries the format's specification (`FORMAT.md`), the published canonical
  vectors and event schema, and a second verifier written from that document in
  standard-library Python, importing nothing of the product.
- **`@mnema/core` and `@mnema/context`**, released because `@mnema/code` depends on them: the
  work domain (the gate, the projections, identity) and the read-only derivations that turn
  the record into the context an agent is handed.
- **The read-only package is `@mnema/context`.** It was called the copilot layer while it was built,
  and the name collided with GitHub Copilot, so it is renamed before its first release.
- **Licensed under Apache-2.0 alone, with a `NOTICE`.** The whole repository and every package
  carry the Apache License 2.0 and a `NOTICE` that credits the author; each tarball ships both.
- **Source maps that carry their source.** Every map a package ships holds the text of the
  files it names, so a debugger in an installed tree can open them.

- **A read-only diagram of the state machines**, and the timeline and references of one entity
  (the `diagram`, `timeline` and `refs` verbs): mermaid text on stdout, nothing written.
- **A signed retraction for notes**: a memory or an observation can be taken back by a fact
  of its own, and the note stops being offered while its history stays.
- **A rule that refuses a write** (`refuses-a-write`): the relation, the signed fact that
  records a refusal at a channel, the switch that turns it off, and one decision that carries
  it; the three hosts' pre-write hooks answer `deny` for a path such a rule addresses.
- **Keys compared with GitHub's** (`verify --against-github`, when asked): the signing keys
  against the SSH keys the linked account publishes.
- **The agent's second channel to write**: skills, a session tally, a hold on the first write
  and a reader for the corrections an agent was given.
- **Decisions imported as proposals** from the ECC Memory Vault, superpowers rulings and
  Claude Code memory files (`decision import`).
- **The `site` verb**: the committed record as one page that verifies itself in the browser.
- **Small things the command line should do**: a rationale from a file or from stdin, a rules
  file for Claude Code, `doctor`, a plugin without hooks, a warning when a skill is exported.
- **`verify --since`**, and a sentence saying how far a green `verify` proves; a stored line that
  is not canonical is refused.
- **Invisible characters made visible**, a repeated refusal said once, and a test that private
  notes stay in their project.
- **Guards on the plugin's hooks and the repository**: hook ids, `AGENTS.md`, a pull request
  template and no home paths.
- **The git log read against the record.** Four read-only verbs: `trailer` prints the
  `Mnema-Decision: ADR-n` line for a commit message; `commits` lists the commits that cite a
  decision and, apart, those that touched the paths it addresses; `why` shows the decisions a file
  or a commit stands under; and `aging` lists the accepted decisions whose paths changed in many
  commits since they were accepted.


### Changed

- The trunk is now named `main` (it was `main-v1`); the 0.x alpha is on the `archive/alpha-0.14` tag.
- Only the identity that wrote a note retracts it, with any key of that identity. `mnema retract`
  and the `retract_note` tool refuse another identity and say whose the note is; a retraction
  another identity signed anyway is not applied, so `search`, the opening read and `recall` keep
  serving the note; and `mnema verify` names it in a census line, informational, with the exit
  unchanged. The rule is in `packages/chain/FORMAT.md` §6.4; no byte of any event changed.
  Known limit: a binary from before this change still applies such a retraction and hides the note.
- **A write is decided on the record as it stands, under the lock**, every write is synced to
  disk, and a move made apart from the writer's view is said so.
- **The console shrinks one axis per resize**, every frame held to the screen.
- **The tests of every package are type-checked** by `pnpm typecheck`, and what the checker
  found is fixed (326 errors, 0 left).
- **The docs say what holds today.** The README gains two rows in the table of what does not
  hold: a leaked checker key signs "passed" for any rule and commit and no fact withdraws the
  role, and a binary from before a kind existed stops reading the whole record once that kind
  is in the committed tree. The install section says nothing is on npm yet and gives the
  command for the pre-release's four tarballs. The README shows what the `ADR-<n>` label is and
  that `decision move` takes the id. `SECURITY.md` says the alpha lives on the
  `archive/alpha-0.14` tag, and `AGENTS.md` says the tests are type-checked.
- **A label typed where an id belongs is answered with the id.** `decision move`, over MCP too,
  refuses an `ADR-<n>` and names the decision, or the decisions, that carry it. The label is
  still no address: a tree numbers its own.

### Fixed

- The brief, and every other line that passes through the rule of the line, now writes the Unicode Tag characters (U+E0000 to U+E007F) as visible escapes; they sit outside the basic plane and slipped through.
- A rule that refuses a write, or asks for a person, no longer stops at the path the host wrote:
  a write through a symbolic link (or into a new file under a linked directory) is matched against
  where it really lands inside the project as well, the refusal still outranking the asking. A link
  that leaves the project is matched by the path as given.

### Known limits

- A leaked checker key keeps signing results the verifier accepts: the role narrows what the
  key can sign, and no fact withdraws it yet. A program started by `check run` can read the key.
- A binary from before a kind existed stops reading the whole record once that kind is in the
  committed tree (`packages/chain/FORMAT.md` §4.1).

[Unreleased]: https://github.com/felipesauer/mnema/commits/main
[0.1.2]: https://github.com/felipesauer/mnema/releases/tag/v0.1.2
[0.1.1]: https://github.com/felipesauer/mnema/releases/tag/v0.1.1
[0.1.0]: https://github.com/felipesauer/mnema/releases/tag/v0.1.0
[0.2.0-beta]: https://github.com/felipesauer/mnema/tree/a8907992a60527d2d3dad1c61bafce983e54af46
[0.1.0-beta]: https://github.com/felipesauer/mnema/tree/1c17287fa389b2ef75f1d2ea71d4c7fbca54889d
