# The workbench: your notes, beside the record

The record is signed and append-only, and it holds the decisions. The work around them (what is being
changed and why, what was handed to whom, what a study found) is notes, and notes change. mnema gives them
a place that is **not part of the record**: `.mnema/workbench/`.

Nothing in it is proof. `mnema verify` and the Python second reader do not read it, a verdict is the same
with the folder as without it, and a line written there is signed by nobody. A decision does not live there:
it goes to the record when it is made, and a note cites its id.

```sh
mnema workspace init     # make it (a project in a git repository, founded by `mnema init`)
mnema workspace status   # where the two roots are, whether the link is right, what is open
```

## The two roots

| Root | Where | Committed | Survives |
| --- | --- | :---: | --- |
| `.mnema/workbench/shared/` | in the project | yes | the clone |
| `.mnema/workbench/local` | a link to `<git dir>/mnema/<project>/workbench/` | never | `git worktree remove`; **not** `git clean -x`, which removes the link and nothing it points to |

`local` is this machine's: the same folder from every worktree of the clone (write a note in one, read it in
another), kept when a worktree is removed, and out of reach of `git add`, because the record's `.gitignore`
has the line for it and `init` makes sure of that line **before** it makes the link. The link holds an
absolute path of this machine, which is why it is never committed. On Windows it is a junction, which needs
no privilege; that is the one place this has not been run.

## What `init` makes

`workbench/README.md` (how a session opens), `templates/` (`change.md`, `brief.md`, `study.md`, `log.md`),
`shared/.gitkeep`, and the link `local`, with `changes/` and `studies/` made in the folder it points to. It
never writes over a file that is there: run twice, it says nothing changed, and a template you edited stays
as you left it. It does not make a `local` of its own where one exists that is a folder, and it does not
move a link that points somewhere else; it says so.

## What `status` prints

Paths, the number of files under each root, and one line for each change whose `change.md` front matter
says `status: open` or `status: paused`. It never prints what a note says.

## When the link is gone

`git clean -x` (and a fresh clone) leaves no `local`. `mnema doctor` names it under `workbench`, and
`mnema doctor --fix workbench` makes it again, to the same folder, with the notes in it as they were. `--fix`
makes the link and touches no note.

The notes are one person's on one machine: the private half is not backed up by git, and a change you want
others to read goes under `shared/`.
