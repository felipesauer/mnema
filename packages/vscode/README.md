# @mnema/vscode

[![CI](https://img.shields.io/github/actions/workflow/status/felipesauer/mnema/ci.yml?branch=main&style=flat-square&label=CI&color=997dbf)](https://github.com/felipesauer/mnema/actions/workflows/ci.yml) [![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-997dbf?style=flat-square)](../../LICENSE) ![Node 24.15.0 or a later 24, or 26.0.0 or later](https://img.shields.io/badge/node-%5E24.15.0%20%7C%7C%20%3E%3D26.0.0-997dbf?style=flat-square) ![Not published: run from a checkout](https://img.shields.io/badge/npm-not%20published-997dbf?style=flat-square)

A VS Code extension for the person who reviews the [mnema](https://github.com/felipesauer/mnema)
record, not for the agent. The record already says which decisions govern a file and which wait for
a judgment; this puts both where the person is reading, so that a decision is not left unjudged only
because judging it meant opening a terminal.

It is not published: not to the VS Code Marketplace and not to npm (`private: true`). It runs from
this repository, and every read and every write goes through the `mnema` command line.

## What it gives you

- **A lens over each file a rule addresses.** The first line of the file says how many decisions in
  force address it, by what they do (`governs`, `asks-for-a-person`, `refuses-a-write`), read from
  `mnema rules <path> --json`. Clicking it lists them: the decision's name, what it does to the
  file, and who accepted it, as the record says. A file no rule in force addresses has no lens.
- **A panel, "mnema: awaiting judgment", in the Explorer.** The decisions whose state is
  `proposed`, read from `mnema search --kind decision --state proposed --json`, each with the
  justification and the alternatives `mnema show <id> --json` holds for it, in its tooltip.
- **Accept or reject, with the note.** Each item has an accept and a reject button (and the commands
  `mnema: Accept Decision` and `mnema: Reject Decision`). The input box does not take an empty
  note, nor one of only spaces, and cancelling it sends nothing. What is sent is
  `mnema decision move accept <id> --note <note>` (or `reject`), started with an argument array and
  no shell, and what the command line answers is what is shown, a refusal included.
- **A notice when a decision is proposed while the window is open.** The record is watched through
  the editor's file watcher on `.mnema/**`; when it has been quiet for 1.5 seconds it is read again,
  and a decision waiting now that was not waiting at the previous reading is announced once. There
  is no timer polling the record.
- **A panel, "mnema: stacks", in the Explorer.** The stacks adopted for the project, read from
  `mnema stack list --json`: each with its version, the tree it was adopted into, and whether its
  files are still as written. Its buttons and commands run the `stack` verb of the command line:
  - `mnema: Add Stack` (from a folder, archive or git address) and `mnema: Add from Index` run `mnema stack add <source> --scope <scope> --dry-run` and show what it printed, the
    whole plan, in the output channel "mnema stacks". Only after that is one question asked; if
    the person confirms, the write is `mnema stack add <source> --scope <scope> --expect <digest>`
    with the digest that plan printed, so the files written are the ones shown. From the index, the
    plan's digest must also be the one the index lists, or nothing is asked and nothing is written.
    The index is read by `mnema stack index` from the folder named by `mnema.stackIndex` (default
    `stack-index`, relative to the workspace folder); an entry the checkout does not hold is not
    installed from here, and the message names the digest to compare.
  - `mnema: Show Stack`, `mnema: Compare Stack` and `mnema: Check Stack` run the verbs `show`,
    `diff` and `check` of `stack` and print what they printed, a departure included.
  - `mnema: Remove Stack` runs `mnema stack remove <name> --dry-run`, shows it, asks once, and only then removes;
    `mnema: Export Stack` runs `mnema stack export <name> <folder>` into a folder the person types.
- **Icons and short titles.** Every command carries a codicon (`$(check)` accept, `$(close)` reject,
  `$(refresh)` refresh, `$(law)` rules over the file, `$(add)` and `$(library)` add a stack,
  `$(eye)` show, `$(diff)` compare, `$(checklist)` check, `$(trash)` remove, `$(export)` export), so the
  buttons are icons and the command's title (one to three words) is their tooltip. A decision has accept
  and reject side by side; a stack has show, compare and check beside it, export in the context menu and
  remove alone in the last group of it; the stacks view's title bar has add, add from the index and
  refresh, and the decisions view's has refresh. The Command Palette lists the commands only where a
  workspace folder is open, and the rules command only over a file. Each input box and each choice has a
  title (with "1 of 2" where there are two steps), a placeholder that says what to type and stays open
  when focus moves; a note that is empty is refused with what to fix.
- **What an empty view says.** A folder with no `.mnema` says so and points to `mnema init` and to
  [the first record](../../docs/first-record.md); with a record, the decisions view says that nothing is
  listed as awaiting a judgment (and that nothing is listed either when `mnema` could not run, which the
  status bar shows) and links to the setting `mnema.command`, and the stacks view, when `mnema stack list` was read, offers the two ways to
  add one, and otherwise says it has not listed the stacks (the status bar shows what `mnema` read). Whether the folder holds a `.mnema` is read from the disk, not from the command line.
- **No button turns a hook on.** A stack may declare hooks; they are shown as the command line
  reports them, and a hook is on only when a person, at a terminal, read its script and typed its
  name (`mnema stack enable <stack> <hook> --from <source>`). The extension has no command for it and says where it is done; the
  command line, started as the extension starts it, refuses with no terminal.
- **The status bar.** The level `mnema verify --json` reports for the record, with a codicon that follows
  it (a book for `fully-signed` and `externally-witnessed`, an info mark for a weaker level, an error
  mark for a failure, a question mark for an answer it could not read; never a check mark or a seal),
  and how many of the channels `mnema switch` lists ([what they are](../../docs/switches.md)) are off.
  The tooltip is the text `mnema verify` printed, line by line (up to six), then the channels off by
  name: what a level covers is what the command line says, and the extension adds no sentence of its
  own about it. The item has an accessibility label and the role of a button. Clicking it reads again.
- **A missing command is not "nothing pending".** Before anything else the extension asks
  `mnema --version`. When the command cannot be started, answers as no mnema does, or is older than
  0.1.2 (the version the extension is written against), the views say the command is missing and how to
  fix it (install `@mnema/code` from source, or set `mnema.command`), nothing else is asked of it, and
  the status bar says "command not found" and, clicked, opens the `mnema.command` setting. The context
  key `mnema.cliMissing` carries it, and it clears at the next reading that finds a working command.
  The setting is read again at every reading, and changing `mnema.command` starts one, so a corrected
  setting needs no reload. A command that did not answer `--version` within 60 seconds is reported as
  not answering, in the tooltip, not as not found. The error mark of the bar follows `record.ok` in
  `mnema verify --json`, the verdict whose failure makes `mnema verify` exit 1.
- **A walkthrough of three steps** (Help > Welcome > Walkthroughs, "Get started with mnema"): make the
  command available, run `mnema init`, run `mnema verify` and read what it prints. It says to read the
  command's output, never that the record is safe or verified.

## Install

The extension needs the `mnema` command (from `@mnema/code`) where the editor can start it; the
setting `mnema.command` names another executable if it is not on the `PATH`. It starts when the
workspace holds a `.mnema` folder. The path of the executable comes only from your user settings
(`mnema.command` is a machine-scoped setting, so a repository's `.vscode/settings.json` cannot set
it), and the extension stays off in a workspace that is not trusted.

There is nothing to install from a registry. From a built checkout (`pnpm install`, `pnpm build`):

```sh
pnpm --filter @mnema/vscode package
code --install-extension packages/vscode/mnema-*.vsix
```

`package` bundles the extension into one file, `extension.cjs`, with no database in it, and has `vsce`,
the editor vendor's packer, write the `.vsix` next to this `package.json`. The file is about 15 KB:
the extension reads the record only through the `mnema` command line, so nothing native rides along
and nothing is installed beside it. CI runs the same command, installs the file into a real VS Code
three times (a folder with no `.mnema`, where it must not start on opening the folder and so must not run `mnema` (opening one of its views, or running one of its commands, starts it, and from then on it runs the command line); a folder
with a `.mnema` and a `mnema.command` that does not exist, where the bar must say the command was not
found; and a folder with a real record read by the `mnema` built here, where the bar must carry a level
and the tooltip what `mnema verify` printed). `pnpm --filter @mnema/vscode install-check` does the same
by hand, under `xvfb-run -a` on a machine without a screen. What no CI reads (a hover, a context menu,
the light and high-contrast themes, a screen reader) has [a script for a person](../../plugin/captures/vscode-extension-script.md), and keeps the file as an
artifact of the run (`mnema-vscode-extension`). It is a local file and this repository never sends it
anywhere: no workflow publishes it, and a test fails if one does.

## How it is built

The part worth testing has no editor in it. `rules.ts`, `proposed.ts` and `status.ts` turn what the
command line printed into what is shown, `cli.ts` starts the command, and `extension.ts` wires them
to the editor through a handed-in `vscode` module. The tests run `extension.ts` against a stand-in
for that module; nothing downloads or starts an editor.

## What it proves, and what it does not

- It proves nothing itself. Every verdict, every rule and every state shown is what the `mnema`
  command line printed, and the extension adds no second verifier: `mnema verify` is the check, and
  the status bar shows only the level it reports, never what that level does not cover.
- "A rule in force" is a decision whose state the record's own classification calls in force; a
  proposed, rejected or superseded decision gets no lens. A rule whose recorded address matches the
  file is the one the command line named: no path is matched here.
- Acceptance is the command line's. The extension does not know who may accept: when `mnema` refuses
  a verdict, the refusal is shown and nothing is recorded. A verdict made here is signed as whoever
  the `mnema` it starts is on that machine.
- The note is required before anything is sent, which is the extension asking for what the command
  would refuse without it; it is not a judgment of what a good note is.
- A decision that never reaches a watcher is not announced. The notice depends on the editor
  reporting a change under `.mnema/`; a change it does not report (a folder excluded from
  watching, say) shows up at the next reading, which the status bar and the `mnema: Refresh` command
  start. It announces what is new between two readings in this window, so a decision that was
  already waiting when the window opened is listed and not announced.
- It reads the first workspace folder only, and only that folder's record. The panel lists at most
  200 decisions, and says in each tooltip how many exist when there are more.
- The channels are read from the printed lines of `mnema switch`, which has no JSON form: if
  those lines change shape, the status bar shows the channels as not read rather than guessing.
- It writes nothing of its own: the only writes are the verdict above and the stack acts (add,
  remove, export), each made by `mnema`. A stack's plan, its signature line and its refusals are
  the command line's text, not this extension's: nothing here says that a stack is safe, and a
  stack being in the index or signed does not make it so. Not offered here, and done in a terminal:
  `--as` when a name is taken, a folder of your own with `--to`, and the hooks. It opens no
  network connection; `mnema` keeps whatever cache it keeps under `.mnema/locks/`.
- It is tested against a stand-in for the editor's API, and the stack acts also against the built
  command line in a project of their own. The tests have not clicked a button in a real editor; CI
  starts the packaged file in one and checks that its commands are registered. It is not on the
  Marketplace.

## License

Apache-2.0. See the [LICENSE](../../LICENSE) and [NOTICE](./NOTICE).
