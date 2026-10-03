# Changelog

Notable changes to the packages in this repository are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The line before this one, the 0.x alpha published as `@felipesauer/mnema`, is deprecated on
npm and lives on the [`main`](https://github.com/felipesauer/mnema/tree/main) branch, with its
own changelog.

## [Unreleased]

The first release of this line: `@mnema/code`, and the three packages it is built from.
Requires Node ≥ 22.12.0; the packages are ESM-only.

### Added

- **Decisions inherited from another repository** (the `inherit` verb): a project points,
  in the committed `.mnema/inherit.json`, at a git repository that holds a record and at one commit of
  it. `mnema brief` prints that record's decisions in force in a section of their own, naming the
  repository and the commit; they are read and never signed by the project, and the project's
  `verify` does not count them. A record that does not verify at the commit prints none, and the
  brief says so. Moving the pointer is explicit and shows what changes first; the copy is kept
  under the mnema home, outside the project. Inheriting is trusting that repository at that commit.
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

[Unreleased]: https://github.com/felipesauer/mnema/commits/main-v1
