# @mnema/vscode

[![CI](https://img.shields.io/github/actions/workflow/status/felipesauer/mnema/ci.yml?branch=main&style=flat-square&label=CI&color=997dbf)](https://github.com/felipesauer/mnema/actions/workflows/ci.yml) [![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-997dbf?style=flat-square)](../../LICENSE) ![Node 24.15.0 or a later 24, or 26.0.0 or later](https://img.shields.io/badge/node-%5E24.15.0%20%7C%7C%20%3E%3D26.0.0-997dbf?style=flat-square) ![Published as mnema.mnema on the Visual Studio Marketplace and Open VSX](https://img.shields.io/badge/extension-mnema.mnema-997dbf?style=flat-square)

A VS Code extension for the person who reviews the [mnema](https://github.com/felipesauer/mnema)
record, not for the agent. The record already says which decisions govern a file and which wait for
a judgment; this puts both where the person is reading, so that a decision is not left unjudged only
because judging it meant opening a terminal.

It is published as `mnema.mnema` to the Visual Studio Marketplace and to Open VSX by the release
workflow, and the same file is attached to the GitHub release. Every read and every write goes through
the `mnema` command line, which the extension does not bring: `@mnema/code` stays a prerequisite.

## What it gives you

- **A lens over each file a rule addresses.** The first line of the file says how many decisions in
  force address it, by what they do (`governs`, `asks-for-a-person`, `refuses-a-write`), read from
  `mnema rules --json -- <path>` (the path comes after `--`, so a file named `-x` is a file). Clicking it lists them: the decision's name, what it does to the
  file, and who accepted it, as the record says; picking one opens that decision whole (see below),
  with no judgment button, since it is in force. A file no rule in force addresses has no lens.
- **A container of its own in the activity bar, titled mnema, with the banner's M as its icon.** It holds
  the two views below, "Awaiting Judgment" and "Stacks", and carries a badge: the number of decisions
  awaiting a judgment, as many as `mnema` says exist (not only the ones listed), nothing at zero and
  nothing when the list was not read. The icon is the first letter of the console's wordmark, drawn when
  the extension is packed.
- **A view, "Awaiting Judgment".** The decisions whose state is
  `proposed`, read from one `mnema status --json`, which serves the first 20 with their `ADR-n`; when
  `mnema` counted more than it served, `mnema search --kind decision --state proposed --json` is asked too,
  so the view lists up to 200 as before (the ones `status` served by their ADR, the others by their id).
  Each has a short tooltip (the ADR and the title; the justification is in the document a click opens,
  not in the tooltip, so no `mnema show` is run for each item). Each wears a neutral icon (never a check mark: it has not been judged) and is read out as
  "ADR-1, <title>, awaits a judgment". Clicking one opens it whole.
- **A decision, whole.** Open Decision (a click on an item, or from the Command Palette, which asks
  which one) opens a read-only text document named by the ADR (`ADR-1`, with no extension, so no markdown preview can render a link in it) holding what
  `mnema show <id> --json` answered: the title, the state, the scope, who recorded it and who accepted
  it, when, the justification and the alternatives as the record has them, and the moves it went
  through, with the command and the time it was read at the top. It carries nothing the answer did
  not (a field `show` leaves out is left out, and the scope is the one `show` says, never the list's).
  It is read again each time it opens and at each reading of the record, so a decision that moved
  elsewhere shows its new state; it is the address (`mnema-decision:` with the decision's id, never
  the ADR number, which two decisions can share) that says which decision it is. A `show` that fails
  is shown as the command line said it. It is plain text, not a web page or a preview: a link or a
  tag in a justification is just characters. What the record wrote goes through the same rule
  the command line's `show` applies: a title or a field is one line, and a control byte (an escape, a bell, a
  right-to-left override) is written as its visible `\u00xx` escape, so a title cannot forge a
  `State` line. The hour it was read at is in UTC with the Z, like the events' own hours. A
  document you close is no longer read again.
- **Accept or reject, with the note.** While the decision in front is `proposed`, its editor's title
  carries an accept and a reject button; each item of the view has them too (beside it and in its
  context menu), and so do the commands Accept Decision and Reject Decision, listed as `mnema: Accept
  Decision` and `mnema: Reject Decision` in the Command Palette (which asks which decision). One
  decision at a time: there is no accept-all. The box is titled `Accept ADR-1` or `Reject ADR-1`
  (the start of the id when there is no ADR) and does not take an empty note, nor one of only spaces;
  cancelling it sends nothing. On an accept the box starts with a stamp, `<the day>, accepted in
  the VS Code extension, no reason typed`, selected, so Enter sends it as it stands and typing
  replaces it by a reason; it says what is true of the act (the day, the place, that no reason was
  typed) and nothing of the decision, and a reason typed is better. The day in the stamp is the day on
  your own calendar (your local date); the signed time the record keeps is the event's own `at`. On a reject the box starts empty
  and a reason has to be typed. What is sent is
  `mnema decision move accept <id> --note <note>` (or `reject`), started with an argument array and
  no shell, and what the command line answers is what is shown: `ADR-2 accepted.` when it said the
  decision was accepted, its own line when it said anything else, its refusal when it refused.
- **What To Do.** `mnema: What To Do`, in the Command Palette, in the `...` menu of the awaiting view and as a link in
  the status bar's tooltip, is a pick made of one `mnema status --json` read when it opens: a line per decision
  awaiting a judgment, in the order `mnema` gave (`ADR-2  <title>`), each opening that decision whole, and, when
  `mnema` counted more than the decisions it listed (it serves 20, and what awaits can also be a skill or a task), a line
  `N more await a judgment` that opens the container. When nothing awaits it says so in its placeholder. In a folder with no `.mnema`
  its one line says there is no record and opens a terminal (nothing is run); with no `mnema` command, its one line opens the
  `mnema.command` setting. It lists no task, recommends nothing and has no line that judges: a decision is judged from
  its own document, with the note.
- **Why Is This File Like This?** In the Explorer's context menu and the editor's, and in the Command Palette, over a file of the
  open folder: runs `mnema why -- <path>` and shows what it printed, as `mnema` words it, in a read-only document under a
  header that says what was asked and when (UTC, with the Z). Each opening is a new document, so a second look is never
  an old reading. A file outside the folder says so and runs nothing.
- **A mark on the `.mnema` folder.** In the Explorer the record's own folder wears the badge `M` and the accent of the
  front page (the colour `mnema.recordFolder`, which a theme can override), and its tooltip says what the folder is. No
  file is marked: `mnema` does not list the addresses its rules cover, so a file with no mark would look as if no rule
  reached it, which the record does not say. The mark is a comparison of two paths; it starts no process and reads nothing. The editor draws one badge per
  item: where git marks the folder too (the record has changes git has not committed, say), the badge drawn in the editor
  measured (1.143.1) is git's, and the accent stays on the name.
- **No notification per proposal.** The record is watched through the editor's file watcher on
  `.mnema/**`; when it has been quiet for 1.5 seconds it is read again, and a decision proposed
  meanwhile raises the badge on the container's icon and the count in the status bar. Nothing
  interrupts: no message is shown for a proposal, and there is no setting for one. There is no timer
  polling the record.
- **A view, "Stacks".** The stacks adopted for the project, read from
  `mnema stack list --json`: each with its version, the tree it was adopted into, and whether its
  files are still as written. Its buttons and commands run the `stack` verb of the command line:
  - Add Stack (from a folder, archive or git address) and Add from Index run `mnema stack add <source> --scope <scope> --dry-run` and show what it printed, the
    whole plan, in the output channel "mnema stacks". Only after that is one question asked; if
    the person confirms, the write is `mnema stack add <source> --scope <scope> --expect <digest>`
    with the digest that plan printed, so the files written are the ones shown. From the index, the
    plan's digest must also be the one the index lists, or nothing is asked and nothing is written.
    The index is read by `mnema stack index` from the folder named by `mnema.stackIndex` (default
    `stack-index`, relative to the workspace folder); an entry the checkout does not hold is not
    installed from here, and the message names the digest to compare.
  - Show Stack, Compare Stack and Check Stack run the verbs `show`,
    `diff` and `check` of `stack` and print what they printed, a departure included.
  - Remove Stack runs `mnema stack remove <name> --dry-run`, shows it, asks once, and only then removes;
    Export Stack runs `mnema stack export <name> <folder>` into a folder the person types.
- **Icons and short titles.** Every command carries a codicon (`$(check)` accept, `$(close)` reject,
  `$(refresh)` refresh, `$(law)` rules over the file, `$(add)` and `$(library)` add a stack,
  `$(eye)` show, `$(diff)` compare, `$(checklist)` check, `$(trash)` remove, `$(export)` export,
  `$(go-to-file)` open a decision, `$(list-unordered)` what to do, `$(history)` why a file is the way it is), so the
  buttons are icons and the command's title (one to three words where it is a button, up to six where it is not, as
  `Why Is This File Like This?`) is their tooltip. Every command is
  in the category `mnema`, which is what puts `mnema: ` before its title in the Command Palette and in
  a keybinding's list, so no title repeats it. A decision has accept
  and reject side by side; a stack has show, compare and check beside it, export in the context menu and
  remove alone in the last group of it; the stacks view's title bar has add and refresh, with add from
  the index in its `...` menu, and the decisions view's has refresh. A stack wears an icon by what
  `mnema stack list` reported (`$(package)` when sound, `$(warning)` when it departs from what was
  written, `$(error)` when its receipt is refused) and the text beside it says the same, since a
  colour alone does not count. The Command Palette lists the commands only where a
  workspace folder is open, and the rules command only over a file. Each input box and each choice has a
  short title, a placeholder that says what to type and stays open when focus moves (`Why? Required.`
  for a note, `Install where?` with a codicon before each scope for a stack); a note that is empty is
  refused with what to fix.
- **What an empty view says.** A folder with no `.mnema` says so and points to `mnema init` (run in a
  terminal, which a link opens) and to [the first record](../../docs/first-record.md); with a record, the
  decisions view says that nothing awaits a judgment only when the answer of `mnema status` was read and understood (the context key
  `mnema.proposedRead`, the twin of `mnema.stacksRead`), and otherwise says it has not listed them, which
  the status bar explains; the stacks view, when the answer of `mnema stack list` was read and understood, offers the two ways to
  add one, and otherwise says it has not listed the stacks (the status bar shows what `mnema` read).
  Every link sits inside a sentence: no line is only a link, because the editor draws such a line as a
  wide blue button. Whether the folder holds a `.mnema` is read from the disk, not from the command line.
- **A folder with no `.mnema` never has the command line run in it.** The container is there in every
  folder, and opening one of its views starts the extension (measured in VS Code 1.143.1), so the
  extension has one door to the command line, and the door does not start `mnema` unless the folder
  holds a `.mnema`, looked for on the disk at every call (a record born later, by `mnema init` in a
  terminal, is read at the next change under `.mnema/`). With none, the status bar item is hidden, the
  badge is empty, no lens is drawn, the context key `mnema.cliMissing` stays false (no record is not "command not
  found"), and a command that needs the command line says once: "This folder holds no .mnema record.
  Run mnema init in a terminal here." The extension never runs `mnema init` itself.
- **No button turns a hook on.** A stack may declare hooks; they are shown as the command line
  reports them, and a hook is on only when a person, at a terminal, read its script and typed its
  name (`mnema stack enable <stack> <hook> --from <source>`). The extension has no command for it and says where it is done; the
  command line, started as the extension starts it, refuses with no terminal.
- **The status bar.** The level `mnema verify --json` reports for the record, with a codicon that follows
  it (a book for `fully-signed` and `externally-witnessed`, an info mark for a weaker level, an error
  mark for a failure, a question mark for an answer it could not read; never a check mark or a seal),
  and, when decisions await a judgment, how many (`fully-signed · 2 to judge`, the same number as the
  badge). The text is short on purpose: nothing about the channels is in it. The tooltip, in markdown,
  has the level, a link to the container with the number awaiting, the lines `mnema verify` printed
  (up to six, in a code block, as they came; for a failure also the first three issues it listed),
  the channels off by name with a link to [what they are](../../docs/switches.md), the time of the
  reading, and links to Refresh and to the setting. What a level covers is what the command line
  says, and the extension adds no sentence of its own about it. The words that came from the command
  line or from the record are escaped, so a name or a line written by someone else cannot become a
  link, and the only commands a link may run are the container, What To Do, Refresh and the settings editor:
  never a verdict. A click on the item opens the container, in every state. When `mnema verify`
  fails the item wears the theme's warning background and the tooltip carries what failed; a weaker
  level is not a warning. The item has an accessibility label that spells the whole sentence out
  ("mnema: fully-signed, 2 decisions await a judgment") and the role of a button.
- **The setting `mnema.statusBar.enabled`** hides the item (default on). It is machine-scoped, like
  `mnema.command`: a repository's `.vscode/settings.json` cannot hide an item that says when
  `mnema verify` fails. It takes effect without a reload.
- **A missing command is not "nothing pending".** Before anything else the extension asks
  `mnema --version` (when it starts, on Refresh, when `mnema.command` changes, at a change of the record while the last
  answer was that the command is missing, and in the reading in which any call came back with no exit code at all, which
  is how a command that vanished mid-session is told). When the command cannot be started, answers as no mnema does, or is older than
  0.1.2 (the version the extension is written against), the views say the command is missing and how to
  fix it (install `@mnema/code` from source, or set `mnema.command`), nothing else is asked of it, and
  the status bar says "mnema not found", its tooltip says why and links to the `mnema.command`
  setting, and a click on it opens the container, whose views carry the same link. The context
  key `mnema.cliMissing` carries it, and it clears at the next reading that finds a working command.
  The setting is read again at every reading, and changing `mnema.command` starts one, so a corrected
  setting needs no reload. A command that did not answer `--version` within 60 seconds is reported as
  not answering, in the tooltip, not as not found. The error mark of the bar follows `record.ok` in
  `mnema verify --json`, the verdict whose failure makes `mnema verify` exit 1.
- **Few processes per reading.** Reading the record after a change starts one `mnema status --json` (and the `search`
  only when `status` cut its list); `--version` is not asked again while the command is there. `mnema verify`, `mnema verify
  --json` and `mnema switch` run when the extension starts, on Refresh, after a judgment or a stack act of yours and when the
  setting changes, and after a change of the record at most once in ten seconds, with a last run ten seconds after the
  last write of a burst, so the bar is never more than about ten seconds behind the record and its tooltip says when
  it read. They are not run while the status bar item is switched off. `mnema stack list --json` runs only when the Stacks
  view is on screen (and on Refresh); hidden, the list is marked old, and read when the view appears. Measured in the tests
  with the command line replaced by a recorder: starting with two proposals costs 5 processes with the Stacks view hidden
  and 6 with it shown (it was 8), a change of the record costs 1 (it was 6, and one `show` for each new proposal), a
  Refresh costs 6 (as before), and twenty changes 1.6 seconds apart cost 32 processes (they were 120).
- **A walkthrough of three steps** (Help > Welcome > Walkthroughs, "Get started with mnema"): make the
  command available, run `mnema init`, run `mnema verify` and read what it prints. It says to read the
  command's output, never that the record is safe or verified.

## Install

The extension needs the `mnema` command (from `@mnema/code`) where the editor can start it; the
setting `mnema.command` names another executable if it is not on the `PATH`. It starts when the
workspace holds a `.mnema` folder, or when you open its container. The path of the executable comes only from your user settings
(`mnema.command` is a machine-scoped setting, so a repository's `.vscode/settings.json` cannot set
it), and the extension stays off in a workspace that is not trusted.

From a store, in VS Code or in an editor that reads Open VSX:

```sh
code --install-extension mnema.mnema
```

If you installed the 0.1.2 file by hand (`felipesauer.mnema`), uninstall it first: it is a different
extension id, and both would register the same commands. From a built checkout (`pnpm install`,
`pnpm build`), the file the release publishes is made by:

```sh
pnpm --filter @mnema/vscode package
code --install-extension packages/vscode/mnema-*.vsix
```

`package` bundles the extension into one file, `extension.cjs`, with no database in it, and has `vsce`,
the editor vendor's packer, write the `.vsix` next to this `package.json`. The file is about 36 KB:
the extension reads the record only through the `mnema` command line, so nothing native rides along
and nothing is installed beside it. CI runs the same command, installs the file into a real VS Code
four times (a folder with no `.mnema`, where it must not start on opening the folder and so must not run `mnema`;
the same folder with the container opened, which does start the extension, and where `mnema` must still
never be run and the bar and the badge must be empty; a folder
with a `.mnema` and a `mnema.command` that does not exist, where the bar must say "mnema not found" and a
click must open the container; and a folder with a real record and one proposed decision, read by the
`mnema` built here, where the bar must carry a level and `1 to judge`, the tooltip what `mnema verify`
printed, the click the container, the manifest's container its icon file and the badge the number 1, and
where opening the proposed decision must give a document with its title, its justification and its state,
in front, after asking `mnema show <id> --json`, and where Why Is This File Like This? over a committed file must
open a document with what `mnema why` printed). `pnpm --filter @mnema/vscode install-check` does the same
by hand, under `xvfb-run -a` on a machine without a screen. What no CI reads (a hover, a context menu,
the light and high-contrast themes, a screen reader) has [a script for a person](../../plugin/captures/vscode-extension-script.md). CI keeps the file as an
artifact of the run (`mnema-vscode-extension`). The only thing that sends the file anywhere is one job of
the release workflow, which a person approves in a protected environment and which publishes the very file
it packed and checked, with the store command lines installed from a lockfile and no install script run, and a store that already has the version is skipped; a test fails if a
publish command or a store token appears in any other job or file. The file has no token in it.

## How it is built

The part worth testing has no editor in it. `rules.ts`, `proposed.ts`, `decision.ts`, `why.ts` and `status.ts` turn what the
command line printed into what is shown, `record-mark.ts` says which folder wears the mark, `cli.ts` starts the command, and `extension.ts` wires them
to the editor through a handed-in `vscode` module. The tests run `extension.ts` against a stand-in
for that module; nothing downloads or starts an editor.

## What it proves, and what it does not

- It proves nothing itself. Every verdict, every rule and every state shown is what the `mnema`
  command line printed, and the extension adds no second verifier: `mnema verify` is the check, and
  the status bar shows only the level it reports, never what that level does not cover. Its tooltip
  holds the lines `mnema verify` printed, in a block, and nothing the extension says of them.
- "A rule in force" is a decision whose state the record's own classification calls in force; a
  proposed, rejected or superseded decision gets no lens. A rule whose recorded address matches the
  file is the one the command line named: no path is matched here.
- Acceptance is the command line's. The extension does not know who may accept: when `mnema` refuses
  a verdict, the refusal is shown and nothing is recorded. A verdict made here is signed as whoever
  the `mnema` it starts is on that machine.
- The note is required before anything is sent, which is the extension asking for what the command
  would refuse without it; it is not a judgment of what a good note is. The stamp the accept box
  starts with is not a reason: it is the day and the place, true of the act, put there so that the
  person who has read the decision and agrees is one keystroke from recording it, and a person who
  has something to say replaces it. Nothing the record says is copied into it, and a reject has none.
- The document of a decision is what `mnema show` answered when the extension last asked, which is
  at the time written at its top, not necessarily now. A decision judged in another window or in a
  terminal while it is open shows the old state until the next reading; the command line refuses a
  verdict that no longer applies, and the refusal is shown.
- A decision that never reaches a watcher is not counted until the next reading. The badge and the
  bar depend on the editor reporting a change under `.mnema/`; a change it does not report (a
  folder excluded from watching, say) shows up at the next reading, which the `mnema: Refresh`
  command and the link in the tooltip start.
- It reads the first workspace folder only, and only that folder's record. The view lists at most
  200 decisions, and says in each tooltip how many exist when there are more; the badge counts the
  decisions `mnema` says await a judgment (when `status` cut its list, the number `mnema search` gives for
  decisions), so it can be larger than the list. `status` also counts skills and tasks that await; those are
  not decisions to judge here, and What To Do says they exist. It says "awaits a judgment" and nothing
  of the record's soundness.
- The bar can be up to about ten seconds behind a burst of writes to the record, and says when it read; a
  verification that the interval skipped runs at the end of the burst, not never. The Stacks list can be
  old while its view is hidden, and is read when the view appears.
- In a folder with no `.mnema` it asks the command line nothing and says nothing about the record:
  the bar is not shown and the views teach `mnema init`. That is a statement about the folder on the
  disk, not about anything `mnema` read.
- The channels are read from the printed lines of `mnema switch`, which has no JSON form: if
  those lines change shape, the tooltip says the channels were not read rather than guessing.
- It writes nothing of its own: the only writes are the verdict above and the stack acts (add,
  remove, export), each made by `mnema`. A stack's plan, its signature line and its refusals are
  the command line's text, not this extension's: nothing here says that a stack is safe, and a
  stack being in the index or signed does not make it so. Not offered here, and done in a terminal:
  `--as` when a name is taken, a folder of your own with `--to`, and the hooks. It opens no
  network connection; `mnema` keeps whatever cache it keeps under `.mnema/locks/`.
- It is tested against a stand-in for the editor's API, and the stack acts also against the built
  command line in a project of their own. The tests have not clicked a button in a real editor; CI
  starts the packaged file in one and checks that its commands are registered. A store accepting the
  file is the store's act, not something a test here shows.

## License

Apache-2.0. See the [LICENSE](../../LICENSE) and [NOTICE](./NOTICE).
