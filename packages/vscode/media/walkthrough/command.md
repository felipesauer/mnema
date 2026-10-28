# Make the mnema command available

This extension never reads the record itself. Every list, rule and verdict it shows is what the
`mnema` command line printed, so the command has to run on this machine.

- Install it with `npm i -g @mnema/code`; the install page is
  https://github.com/felipesauer/mnema/blob/main/docs/install.md.
- Or, if it is installed somewhere the editor does not look, set the `mnema.command` setting to
  the path of the executable. It is a user setting: a repository's own settings cannot change it.

When the command cannot be run, the status bar says "mnema not found" and the mnema views say
the command is missing, which is not the same as nothing being pending.
