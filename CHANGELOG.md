# Changelog

Notable changes to the packages in this repository are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The line before this one, the 0.x alpha published as `@felipesauer/mnema`, is deprecated on
npm and lives on the [`archive/alpha-0.14`](https://github.com/felipesauer/mnema/tree/archive/alpha-0.14)
tag, with its own changelog.

## [Unreleased]

### Added

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
  tree (and again when the session lands on a project; a name that is no agent's at all is said once, when it opens) — and where the person's key is protected and `MNEMA_KEY_PASSPHRASE` is not in the environment, or is not on this machine, the write is
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
  definition of all 27 (50,204, 50,330, 51,257 and 57,030 bytes; 11,387, 11,527, 11,501 and 12,718 tokens in o200k,
  a relative measure), against 54,568 bytes and 12,306 tokens for the server's own listing; Codex carries none and
  one `tool_search` entry that lists the server (2,891 bytes, 672 tokens), and what its search returns for each tool
  is not measured; VS Code's agent is offered none of them in its job, so it is not measured. The figures are those
  of the binary the job installs. The descriptions of `guard` and of a write's `project` changed, and both are longer (the entries under Fixed and Changed); a case per host is red when that binary wraps a
  definition differently or a definition gains a word.

### Changed

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

### Fixed

- **The second reader refuses a stored line holding an integer no double holds, where it used to stop.** Past the
  largest double, `mnema_verify.py` raised an `OverflowError`, and past 4,300 digits a `ValueError` (the limit Python
  puts on converting digits), and either one ended the reading with a traceback and no verdict. It now refuses the
  line under section 1, as the product does: a JavaScript reader holds such a number as `Infinity`, which has no
  spelling. The exit status was not 0 either way, so no record read as verified.
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
  operation decided, it also founded an identity in the public record — a public key, an anchor and a tail holding
  `identity.founded` and `run.started` — and the refusal said "This key founded an identity of its own". The key is
  made at the first write that lands now, as the entry above says: it is kept, with its installation id, at the first
  append, and the server writes its run after the operation's last refusal, in the hold of that write. Two processes
  making a machine's first write at one instant still make one key: the one that keeps second refuses
  (`KEY_MADE_MEANWHILE`), writes nothing, and its next write signs with the key that is there. The command line says it like every other refusal,
  `Refused (KEY_MADE_MEANWHILE): …`.
- **A first write refused for what it says makes no key and founds nothing either.** The refusals that judge the fact
  itself — `UNREADABLE_EVENT` (`task create ''`), `NOT_A_TITLE` (`<title>`), `NOT_A_REASON` (`***`) and
  `NOT_A_REFERENCE` (`observe '<id>'`) — came after the founding. From an empty `HOME`, in a project another key
  founded, each left the key (3 files under the `HOME`) and 5 files in the public tree, among them a tail holding only
  `identity.founded` and no checkpoint, so `verify --require=signed` failed for the whole project; through the server
  it left 6, with a signed `run.started`, and the refusal said "This key founded an identity of its own", and a refused
  `record_observation` left the same in the private tree without a word. Every operation now asks the fact first and
  founds after: each of those refusals of the fact leaves no file in the `HOME`, the public or the private tree, on the command line
  and through the server (a refusal in the global or the private tree leaves its `locks/` folder there, empty), and the
  first write that lands founds as before. The refusals' words, and what `verify`
  accepts, are unchanged.
- **A client whose name is a marker (`<id>`) no longer founds on a first write the server then refuses.** The server's
  session run carries the client's name, and the door refuses a name that is a marker (`NOT_A_REFERENCE`) — but it
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

## [0.2.0-beta] - 2026-10-11

### Added

- **`mnema verify --against-sigstore` names the run a Sigstore certificate carries.** From a GitHub
  Actions job, the note of each bundle now also says the repository, the workflow, the commit and the
  run the certificate names (Fulcio's extensions 12, 9, 13 and 21), and `--json` carries them as
  `ran`. A certificate for an e-mail names none. They name a run, not the agent or the model inside
  it; the verdict, the level and the exit are what they were. The second reader still names the
  bundle and does not check it. `docs/what-it-proves.md` has the row, and `packages/action`'s README
  a recipe for an agent in CI.
- **The plugin is ported to four hosts beyond Claude Code, from one table of the hosts.** `packages/code/src/host-names.ts`
  holds one row per host and one cell per rung — (a) the MCP server and a rules file, (b) the opening
  of a session, (c) a refusal before a write, (d) a pause for a person — each saying how it is known:
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

- **Stacks: the skills and agents a project adopts.** `@mnema/stacks` is the contract of a stack — a
  `stack.json`, skills in the open Agent Skills format, agents in a neutral format, declared hooks and
  a licence — with its validator and a digest anyone reproduces with `digest.sh`; it is released with
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
  logged on this machine, outside the record, and `mnema report` shows its report whole — mnema's
  version, Node's, the platform, the verb, the kind of error and where in mnema it happened, and
  nothing else — and keeps your answer: `--decline` for that kind of error, `--off` for all of them.
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
  `service: "sigstore"`, no new kind) that lets a bundle speak for an identity of the record —
  an e-mail as `sha256:` and the SHA-256 of the address, never the address; a workflow as it is —
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
  executables above it and which of a closed list of variables exist in its environment — names
  only, never a value or a path — and the case asserts them by value. Held for Claude Code, Codex,
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
- **`mnema --help` is grouped by the flow of the work** — Record, Hand over, Verify, Read, The git log,
  This machine, Called by a host — with only the name in the column.
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

## [0.1.0-beta] - 2026-10-05

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
  and the notes recorded for the project — first the ones that share a word with what the
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
[0.2.0-beta]: https://github.com/felipesauer/mnema/releases/tag/v0.2.0-beta
[0.1.0-beta]: https://github.com/felipesauer/mnema/releases/tag/v0.1.0-beta
