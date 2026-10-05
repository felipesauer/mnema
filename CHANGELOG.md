# Changelog

Notable changes to the packages in this repository are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The line before this one, the 0.x alpha published as `@felipesauer/mnema`, is deprecated on
npm and lives on the [`archive/alpha-0.14`](https://github.com/felipesauer/mnema/tree/archive/alpha-0.14)
tag, with its own changelog.

## [Unreleased]

### Added

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

### Fixed

- **A tail's lock is no longer taken from a live holder.** A waiter used to break a lock a minute
  old even when its process still answered, so a holder that was alive and slow (a stopped process,
  a suspended laptop) could end up with a second writer on the same tail. Only a lock whose process
  is gone is broken now; a pid reused by an unrelated process keeps the tail busy, and the refusal
  says to delete the lock file it names.
- **A timestamp calendar is contacted only on the https port.** A proof naming an operator's host on
  another port is refused and not contacted.

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
  template and no home paths in the measurements.
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
