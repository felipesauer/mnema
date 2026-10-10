# The stack index

A list of stacks other people can look at: each entry is a name, a version, a one-line description, a link
to where the stack lives, and its digest. **The index holds no stack and no code**, only where to find one and the
digest it must have.

`index.json` is the list. The first two entries are the example stacks of this repository, in
[`packages/stacks/examples/`](../packages/stacks/examples/).

## What an entry says

| Field | Meaning |
|---|---|
| `name`, `version`, `description` | what the stack's own `stack.json` says |
| `link` | a page to read the stack on |
| `digest` | the SHA-256 identity of the stack, as [`@mnema/stacks`](../packages/stacks/README.md) computes it (`sh digest.sh <folder>` gives the same) |
| `path` | only for a stack kept in this repository: its folder, which the test suite holds to the digest |

## What it proves, and what it does not

- The digest is what to compare: `mnema stack add <source> --dry-run` shows the digest of what it read, and the
  stack is the one listed only if the two are equal. The index is a list of links; the trust is in the digest the plan
  shows, and in the signature if the stack carries one, not in being listed.
- Being listed says that someone proposed the stack and a reviewer let the entry in. It does not say the stack is
  safe: read what a stack brings before you adopt it.
- For the stacks kept here the suite recomputes the digest and fails when the entry and the folder disagree. For a
  stack kept elsewhere nothing here recomputes anything; the digest is what the proposer wrote, and the link may
  move.

## Adding a stack

Open a pull request that adds an entry to `index.json`: the name, the version, the description, a link, and the
digest of the stack at that version. Do not add the stack's files.
