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

1. **A folder with no `.mnema`.** Open it. The extension does not start on opening: no status bar item (opening one of its views, or
   running `mnema: Refresh`, starts it). The two
   mnema views in the Explorer say the folder holds no record and how to start one.
2. **A folder with a `.mnema` and no `mnema` command.** Set `mnema.command` in your user settings to a
   path that does not exist. The status bar item says the command was not found, with a warning
   icon. The two views say the command is missing, and do not say nothing is pending. Hovering the
   item says what to install or set. Clicking it opens the `mnema.command` setting.
3. **One decision awaiting a judgment.** The view lists it. A notification says a decision was
   proposed, with a Review action. Each item shows two icon buttons (accept, reject), not text.
4. **Accept with an empty note.** The input box refuses it and says why; nothing is recorded.
5. **The lens.** Open a file under an address a decision in force names: the lens above its first
   line says how many rules govern it, and clicking it opens the list.
6. **The status bar on three themes.** Light, dark and high contrast. The icon and the text are
   legible on each. The item never shows a check mark or a seal: only the level `mnema verify`
   printed. Hover it: the lines are the ones `mnema verify` printed.
7. **A screen reader** (Orca, NVDA or VoiceOver). It announces the status bar item as a button with the
   label the extension set, and reads the items of both views.
8. **Zoom to 200 percent, and the walkthrough.** The views, the welcome texts and the status bar item
   stay usable. Open **Help > Welcome > Walkthroughs** and read the three steps: the words match what
   `mnema init` and `mnema verify` do, and none says the record is safe or verified.

## 2. What to keep

A dated file next to this one, named `vscode-extension-<date>.json`, with the environment of step 0
and one of the three words per case. A capture is never edited: a new one is a new file, and a page
that cites one says it was read by hand on that date, in that version.
