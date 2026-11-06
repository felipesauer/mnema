# What 0.1.6 is expected to bring

<!-- description: What mnema 0.1.6 is expected to bring, as plans and not promises, each line linked to the accepted decision of this record that holds it. -->

These are plans, not promises. Each line below is expected, and each is linked to the accepted decision of this repository's record
that holds it: the link opens the record's own page, which checks itself in your browser (see [the page that verifies itself](site.md)).
No date is given, and a line changes when a decision does: a decision is never edited, so a newer one that replaces an older one
says so, and this page follows the newer one. A thing that is not here has no accepted decision behind it yet, which is not a "no".

## Using mnema alone, and keeping a copy of what is not in git

- **A repository whose team has not adopted mnema.** A local mode of `init` is expected to keep the record in `.mnema/`, listed in
  `.git/info/exclude` and never in `.gitignore`, to write no block into the team's files, and to say that the record is local to this
  clone; a `local leave` step and then `mnema record commit` are expected to adopt it. [ADR-179](https://mnema.work/record/#ADR-179)
- **A guided backup and restore.** A `backup` verb is expected to copy the private and global trees (and a `backup keys` verb the cold
  key only, always encrypted) to a folder by default, or to a git repository the person chooses, with its history kept; to run only when
  called, or from an after-commit hook installed on request; and to restore only tails and public keys, never a machine key.
  [ADR-131](https://mnema.work/record/#ADR-131), [ADR-144](https://mnema.work/record/#ADR-144)
- **The backup, in the local mode.** It is expected to copy the excluded public tree too, to keep several targets on one machine with
  every project assigned to one explicitly (none by default), and, at first, not to encrypt the copy: a sentence is expected to say
  who can read the target. [ADR-179](https://mnema.work/record/#ADR-179)

## Reading the record

- **Every relation a reading shows is expected to carry its grade,** asserted or mentioned, and never inferred.
  [ADR-160](https://mnema.work/record/#ADR-160)
- **A guided first recording for every host** is expected to import a repository's decision files as proposed and to end by showing
  a rule arrive at an edit. [ADR-160](https://mnema.work/record/#ADR-160)
- **A redesigned record page** is expected to have a view of one decision by its hash, one timeline and a sidebar, and a lineage graph
  drawn at build; it is expected to show only what the record proves. [ADR-141](https://mnema.work/record/#ADR-141)
- **The check for a newer version, asked for by the person,** is expected to be a `--latest` option of `doctor` (or a machine switch the
  person turns on); nothing asks the npm registry unprompted. [ADR-140](https://mnema.work/record/#ADR-140)

## Moved from 0.1.5

- **More of the proof the record is held to,** and some product items, were moved to 0.1.6 when 0.1.5 was closed on its core: the
  proof battery (`prove`, cosign and Rekor, the Python reader's witnessed mode, the mutation harness, the schemas of the MCP tools, the
  rule fixtures, a verdict for `why` and a hardening of the writer's key); and, as product items, a check after `init`, running without
  installing, a shorter README, a brief read in two passes, and rules arriving at an edit in VS Code and Cursor. [ADR-152](https://mnema.work/record/#ADR-152)
- **How a rule that asks for more work than the edit is charged** and **which MCP tools are cut or merged** were moved to 0.1.6 and are
  expected to be settled here. [ADR-120](https://mnema.work/record/#ADR-120)

## What is measured next

- **A full-size measurement of rules, of a conversation that is compacted, and of governance,** is expected:
  what an agent does when a rule conflicts with what it was asked (obeying it is counted as stopping to ask before editing), whether a
  rule holds after a compaction, and whether an agent writes through the shell to a path a rule refuses. The write gate does not cover the shell
  today, and a task is expected to study whether it should. [ADR-178](https://mnema.work/record/#ADR-178)
