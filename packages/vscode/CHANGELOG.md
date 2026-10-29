# Changelog

## Unreleased

- A side bar of its own. The two views, Awaiting Judgment and Stacks, left the Explorer for an
  mnema container in the activity bar, with the M as its icon and a badge with the number of
  decisions awaiting a judgment. The extension's icon in the store is now the same M.
- A short status bar item. It shows the level `mnema verify` reports and, when decisions wait,
  how many. The detail (what `mnema verify` printed, the channels that are off, when it was read)
  is in its tooltip, and the M is the icon it wears. The new setting `mnema.statusBar.enabled`
  hides it. A message no longer pops up when a decision is proposed: the badge and the count
  carry the notice.
- A decision opens whole. Click a proposal and it opens as a read-only document with its title,
  state, reasons, what was turned down and its moves. While it awaits a judgment, Accept and Reject
  are on the title of that editor. A note is still required: the accept box starts with a stamp
  you can press Enter on, or replace with a reason; the reject box asks for a reason.
- Each item shows its state with an icon, and the commands are grouped under `mnema` in the
  palette.
- `mnema: What To Do` lists the decisions awaiting a judgment, and each one opens whole.
- `mnema: Why Is This File Like This?` (on a file in the Explorer or in the editor, and in the
  palette) shows what `mnema why` printed for it.
- The `.mnema` folder wears an `M` in the Explorer.
- It starts far fewer `mnema` processes, and none in a folder without a `.mnema`.
- A file whose name starts with a dash now gets its rules.
- The walkthrough, the empty views and the `mnema.command` setting say `npm i -g @mnema/code`
  to install the command line.
- It still needs the `mnema` command line (`@mnema/code`) where the editor can start it, and it
  adds no verifier of its own: what it shows is what `mnema` printed.

## 0.1.3

- First version on the Visual Studio Marketplace and Open VSX, as `mnema.mnema`. If you installed
  the 0.1.2 file by hand (`felipesauer.mnema`), uninstall it: it is a different extension id.
- An icon, buttons grouped by meaning, short titles for the commands, a text for each empty view,
  and a status bar item with the level `mnema verify` reports.
- It still needs the `mnema` command line (`@mnema/code`) where the editor can start it, and it
  adds no verifier of its own: what it shows is what `mnema` printed.

## 0.1.2

- The rules in force over the open file, the decisions waiting for a judgment with accept and
  reject, and the stacks adopted for the project. Installed from a file.
