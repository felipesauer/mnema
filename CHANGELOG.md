# Changelog

Notable changes to the packages in this repository are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The line before this one, the 0.x alpha published as `@felipesauer/mnema`, is deprecated on
npm and lives on the [`archive/alpha-0.14`](https://github.com/felipesauer/mnema/tree/archive/alpha-0.14)
tag, with its own changelog.

## [Unreleased]

### Added

- **A Sigstore countersignature.** `mnema witness sigstore` signs the last checkpoint of each
  tail with a short-lived Sigstore certificate (the browser here; the job's own token in GitHub
  Actions) and files the bundle at `witness/<checkpoint>.sigstore.json`. Of the record only the
  checkpoint digest leaves; the e-mail, or the repository and the workflow, goes into Sigstore's
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
  result before its own retirement. `mnema accountability` says who retired the machine. The
  Python reader folds the same rule, and the two readers agree on it.
- **The Action runs the checks.** `@mnema/action` takes a `checker-key` input, the private half of
  a checker key from a repository secret: after its other steps it runs `mnema check run` with it,
  leaves the results in the working tree and fails when a check did not pass. A declared program
  is started without the Action's inputs in its environment.

### Changed

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
  was slower.
- **The Action's own test has room in its time limit.** Its cases start the real `mnema` binary
  (seven processes of set-up and two per run); the slowest took 4.3 to 4.5 s measured alone against
  the 5 s default, and went red once on a loaded runner. The limit is 20 s for that file; nothing
  in it waits on a network.

### Fixed

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

### Known limits

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
  after Sigstore turns its keys over reads `not covered` on this binary. Signing has been run
  only against Sigstore's own test doubles, not against the public instance.

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
  and any other fact from that key, and `mnema accountability` lists it as a machine. Four new event
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
[0.1.0-beta]: https://github.com/felipesauer/mnema/releases/tag/v0.1.0-beta
