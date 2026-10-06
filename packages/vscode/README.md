# @mnema/vscode

[![CI](https://img.shields.io/github/actions/workflow/status/felipesauer/mnema/ci.yml?branch=main&style=flat-square&label=CI&color=997dbf)](https://github.com/felipesauer/mnema/actions/workflows/ci.yml) [![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-997dbf?style=flat-square)](../../LICENSE) ![Node 22.12 or later](https://img.shields.io/badge/node-%E2%89%A522.12-997dbf?style=flat-square) ![Not published: run from a checkout](https://img.shields.io/badge/npm-not%20published-997dbf?style=flat-square)

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
  `mnema: Accept decision` and `mnema: Reject decision`). The input box does not take an empty
  note, nor one of only spaces, and cancelling it sends nothing. What is sent is
  `mnema decision move accept <id> --note <note>` (or `reject`), started with an argument array and
  no shell, and what the command line answers is what is shown, a refusal included.
- **A notice when a decision is proposed while the window is open.** The record is watched through
  the editor's file watcher on `.mnema/**`; when it has been quiet for 1.5 seconds it is read again,
  and a decision waiting now that was not waiting at the previous reading is announced once. There
  is no timer polling the record.
- **The status bar.** The level `mnema verify --json` reports for the record, and how many of the
  channels `mnema switch` lists are off, with their names in the tooltip. Clicking it reads again.

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

`package` copies the extension with the workspace packages it reads, `@mnema/context` and
`@mnema/core`, and has `vsce`, the editor vendor's packer, write the `.vsix` next to this
`package.json`. CI runs the same command and keeps the file as an artifact of the run
(`mnema-vscode-extension`). It is a local file and this repository never sends it anywhere: no
workflow publishes it, and a test fails if one does.

## How it is built

The part worth testing has no editor in it. `rules.ts`, `proposed.ts` and `status.ts` turn what the
command line printed into what is shown, `cli.ts` starts the command, and `extension.ts` wires them
to the editor through a handed-in `vscode` module. The tests run `extension.ts` against a stand-in
for that module; nothing downloads or starts an editor.

## What it proves — and what it does not

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
- It writes nothing of its own: the only write is the verdict above, made by `mnema`. It opens no
  network connection; `mnema` keeps whatever cache it keeps under `.mnema/locks/`.
- It is tested against a stand-in for the editor's API and has not been run inside a real editor by
  the checks of this repository. It is not on the Marketplace.

## License

Apache-2.0. See the [LICENSE](../../LICENSE) and [NOTICE](./NOTICE).
