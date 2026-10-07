# What else it does

Each line says what it does and what it leaves unproven; the page it points to has the rest.

- **A rule can refuse a write.** An accepted decision linked to a path with `refuses-a-write` stops
  the write there: in Claude Code and VS Code through the host's own hook, in Cursor's agent through
  a hook of its own that only refuses. It was measured in all three with no model, and of Cursor's
  tools only `Write` was. It binds an agent that goes through the plugin, not a person with an
  editor, and `mnema switch off edit-refuses-a-write` is the way out — recorded, as a signed
  fact. [The plugin's page](../plugin/README.md#what-it-does--and-what-it-does-not).
- **A note can be taken back.** `mnema retract` appends a signed retraction of a memory or an
  observation, with a reason. The note leaves the opening and the search and stays in the record,
  and `verify` still sees both facts: nothing is erased.
- **A read pays for what arrived, not for the whole record.** A read keeps what it built in each tree's gitignored
  `locks/projection.db` and takes only what was appended since. It is derived, never the record:
  deleting it changes no answer, and a clone does not carry it.
  `MNEMA_CACHE_DIR` keeps it in a directory you choose instead (a checkout you cannot write to,
  worktrees that share one, or a CI cache restored between runs); a directory shared by several
  projects holds a file for each, and it is still only a cache. The SDK honors the variable only when
  `openRecord` uses the default environment; with an explicit `env` it is ignored, as `MNEMA_HOME` is.
  When a fresh install creates a tail the project moves to another cache file and the old one stays in
  the directory: deleting old cache files is safe (it is only cache), and in a cached CI directory it
  means the directory can grow.
- **The git log, read against the record.** `mnema trailer`, `commits`, `why` and `aging` print the
  `Mnema-Decision` trailer a commit carries and the commits that cite or touched what a decision
  addresses. They write nothing; a trailer is its author's claim, signed by nobody, and `aging`
  points at decisions whose code moved a lot, it does not say they are wrong.
- **Who signed, where somebody asked.** `mnema key github <name>` records a signed claim that an
  identity is a GitHub account, and `mnema verify --against-github` compares the keys that signed
  with the SSH keys that account publishes: *today*, and on github.com's word, not at the time of
  signing.
- **A rule that carries its check.** `mnema check declare` names the program that checks a decision
  in force; `mnema check run`, on a machine with a checker key, records whether it held at a commit.
  A checker key can sign that result and nothing else. The result does not say the program checks
  what its rule says.
- **A record that inherits another's.** `mnema inherit set` pins another repository's decisions at
  one commit, and `mnema brief` prints them apart from the project's own. They are read, never
  signed here, and `verify` does not count them.
- **Decisions you wrote before you had a record.** `mnema decision import` reads decision documents,
  the ECC Memory Vault, a rulings ledger or Claude Code's memory files and proposes each one as
  `proposed`, with a dry run first. Nothing is accepted for you.
- **By code, in a pull request, in an editor.** [`@mnema/sdk`](../packages/sdk/) records and reads the
  record from a program; [`@mnema/action`](../packages/action/) comments what a pull request does to
  the record and fails the check when `verify --require=signed` does;
  [`@mnema/vscode`](../packages/vscode/) shows the rules over the open file and rules on waiting
  decisions. **None of the three is published**: they run from a checkout of this repository.
  The SDK calls the same functions as the command line, and a test holds the doors to the same
  events and refusals.
- **Your machine, checked.** `mnema doctor` says whether a `mnema` is on the `PATH`, whether the
  plugin is installed, whether VS Code's settings tell its agent where the plugin is, and whether the
  server is declared twice. Asked alone it writes nothing and does not ask the registry;
  `mnema doctor --fix vscode` is the one change it makes, and only when you type it. For skills, the plugin brings `recording-decisions`, `recording-rulings` and
  `diagnosing-recording`; `mnema-server-only` is the same server without the hooks and the skills.
