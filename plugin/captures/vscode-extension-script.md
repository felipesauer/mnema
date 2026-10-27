# Reading the VS Code extension, by hand

This is the script for what the install check in CI cannot see: the pixels. CI installs the packed
extension into a real VS Code under a virtual display and asserts what it can read from the
extension host (that it starts only where a `.mnema` folder is, that it says the command is missing,
what the status bar item says). It cannot say how a hover looks, how a context menu is laid out, or
whether anything is readable on a light or a high-contrast theme. A person reads those, in about half
an hour, and writes the result down as a capture: a reading, not a test.

Use a scratch user-data folder and a scratch extensions folder so your own editor profile is not
touched, and a scratch home for the `mnema` the extension starts. Do not paste a key, a token or an
account name into the result.

## 0. The environment, written down first

The date; the version and commit shown by **Help > About**; the operating system; the SHA-256 of the
`.vsix` that was installed (`pnpm --filter @mnema/vscode package` writes it next to the extension's
`package.json`); the commit of this checkout; and who read it.

## 1. The cases

Each case ends in one of three words: `held`, `did-not-hold`, `not-run`. A case that does not hold is
a finding, and a good capture.

1. **A folder with no `.mnema`.** Open it. The extension does not start on opening: no status bar item.
   The activity bar has the mnema container, with the M as its icon and no badge. Open it (that starts the
   extension, and nothing runs `mnema`: no status bar item appears either). Its two views, Awaiting Judgment and
   Stacks, say the folder holds no record and how to start one, in sentences, with no blue button. Run
   `mnema: Refresh` from the palette: one message says the folder holds no record.
2. **A folder with a `.mnema` and no `mnema` command.** Set `mnema.command` in your user settings to a
   path that does not exist. The status bar item says "mnema not found", with a warning
   icon. The two views say the command is missing, and do not say nothing is pending. Hovering the
   item says why, and what to install or set, with a link to the `mnema.command` setting. Clicking
   it opens the mnema container.
3. **One decision awaiting a judgment.** The view lists it, and the mnema icon in the activity bar carries the badge 1. The
   status bar says the level and `1 to judge`. Propose another from a terminal: the badge and the bar go to 2 and
   no notification appears. Each item shows two icon buttons (accept, reject), not text, and a neutral circle icon, not a check
   mark; the stacks view shows a package, a warning or an error icon beside the text that says the same.
4. **Open a decision, accept it with the stamp, reject without a reason.** Click a proposal: a document named
   `ADR-n.md` opens in front with the title, the state, the justification and the alternatives, the command and the time
   it was read at the top, and an accept and a reject button on the editor's title. Click accept: the box is titled
   `Accept ADR-n`, holds `<today>, accepted in the VS Code extension, no reason typed` selected, and Enter records
   exactly that; the toast says `ADR-n accepted.`, the buttons leave the title and the document says `accepted`. On
   another proposal click reject: the box is empty and an empty or spaces-only note is refused with what to fix.
   Opened from a lens, a rule in force shows no buttons. Open a document, accept the decision in a terminal, then
   refresh: the document shows the new state.
5. **The lens.** Open a file under an address a decision in force names: the lens above its first
   line says how many rules govern it, and clicking it opens the list; picking a rule opens that decision whole, without buttons.
6. **The status bar on three themes.** Light, dark and high contrast. The icon and the text are
   legible on each. The item never shows a check mark or a seal: only the level `mnema verify`
   printed, and `N to judge` when something awaits. Hover it: the tooltip is markdown, and the lines
   in its block are the ones `mnema verify` printed. Change one byte of a file in `.mnema/tails/` in a
   throwaway copy and refresh: the item takes the warning background of the theme and the tooltip
   says what failed. Set `mnema.statusBar.enabled` to false in the user settings: the item goes away
   with no reload; a `.vscode/settings.json` that sets it has no effect.
7. **A screen reader** (Orca, NVDA or VoiceOver). It announces the status bar item as a button with the
   label the extension set (the whole sentence, "mnema: fully-signed, 1 decision awaits a judgment"),
   and reads the items of both views.
8. **Zoom to 200 percent, and the walkthrough.** The views, the welcome texts and the status bar item
   stay usable. Open **Help > Welcome > Walkthroughs** and read the three steps: the words match what
   `mnema init` and `mnema verify` do, and none says the record is safe or verified.

## 2. What to keep

A dated file next to this one, named `vscode-extension-<date>.json`, with the environment of step 0
and one of the three words per case. A capture is never edited: a new one is a new file, and a page
that cites one says it was read by hand on that date, in that version.
