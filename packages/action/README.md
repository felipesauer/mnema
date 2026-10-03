# @mnema/action

A GitHub Action for [mnema](https://github.com/felipesauer/mnema). On a pull request it reads the
record the repository already carries in `.mnema/`, writes ONE comment saying what the pull request
does to it, and fails the check when the record does not verify as signed.

It is not published: not to the GitHub Marketplace and not to npm (`private: true`). It runs from
a checkout of this repository, with the `mnema` of the `@mnema/code` that sits beside it.

## What it gives you

- **One comment, kept current.** The first line of the comment is a marker; each later push
  replaces that comment instead of adding another. It shows the events the pull request adds to
  the record, counted by kind, and the decisions it proposes, accepts, rejects or supersedes, by
  `ADR-<n>` and title.
- **Which changed files a rule addresses.** For each changed file it runs `mnema rules`, and lists
  the files addressed by a rule in force: an accepted decision linked to the path with `governs`,
  `asks-for-a-person` or `refuses-a-write`, with the rule's name and id.
- **`verify --require=signed` as the check.** The Action fails when `mnema verify --require=signed`
  exits non-zero. `--require=signed` is a flag of `verify`; nothing is added to it here.
- **Optional, off by default: approval for rules that ask for a person.** With
  `require-approval-for-asks: "true"` the Action also fails when a changed file is addressed by an
  accepted `asks-for-a-person` rule and no reviewer other than the author stands approved on the
  pull request.
- **Quiet on pull requests that do not concern the record.** It adds a comment only when the pull
  request adds events, touches a governed file, or the record fails to verify. A comment it wrote
  earlier is still refreshed, so it never goes stale.

## Install

There is nothing to install from a registry. Use it from a checkout of this repository, after
building it, with `fetch-depth: 0` so the base commit is in the clone and the two records can be
compared:

```yaml
name: record
on: pull_request

permissions:
  contents: read
  pull-requests: write

jobs:
  record:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with:
          node-version: '24'
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - uses: ./packages/action
        with:
          require-approval-for-asks: 'false'
```

`pull-requests: write` is there for the comment alone; `contents: read` is all the checkout needs.
The action runs on `node24`.

| Input | Default | What it does |
| --- | --- | --- |
| `github-token` | `${{ github.token }}` | reads the pull request's files and reviews, and writes the comment |
| `require-approval-for-asks` | `false` | `true` fails the check when an accepted `asks-for-a-person` rule addresses a changed file and only the author has approved |

## How it is built

The part worth testing has no network in it. `record.ts` reads `.mnema/tails/*.jsonl` and says
which events a pull request added; `governed.ts` reads the answer of `mnema rules <path> --json` and the
pull request's reviews; `comment.ts` turns a report into text; `judge.ts` is one run, with the
repository, `mnema` and GitHub handed in. GitHub is reached in `github.ts` over `fetch` with the
token, and `fetch` is a parameter. `world.ts` is `git` and the `mnema` binary as child processes;
`run.ts` is the entry `action.yml` runs.

## What it proves — and what it does not

- It proves what `mnema verify --require=signed` proves and nothing beyond it: every event of the
  record is covered by a verified signature. It does not add a second verifier and does not widen
  that promise; `--require=witnessed` and `--since` are not asked.
- The events it reports as added are the ones the checked-out commit holds in `.mnema/tails/` and
  the pull request's base commit does not, compared by their chain hash. That is a count of lines
  that arrived. It does not say who wrote them, and it does not say the pull request is right to
  add them: the signature check is `verify`'s.
- "A rule in force" means an accepted decision. A proposed, rejected or superseded decision is
  never reported as governing a file, and a rule whose recorded address names nothing in the tree
  is not reported either.
- The approval check counts a review the pull request holds as approved, from a login other than
  the author's, whose latest deciding review is an approval. It does not tie the approval to the
  commit it was given on, it does not read teams or code owners, and it cannot tell a person from a
  bot account. Nothing here makes a rule that asks for a person bind anybody else: that remains
  the host's `before-a-write` and the repository's own branch protection.
- It asks `mnema rules` about at most 200 changed files, one process each, and the comment says
  how many it left out. Files under `.mnema/` are never asked about.
- It never writes to the record, signs an event, commits or pushes. `mnema` keeps a projection
  cache under `.mnema/locks/`, which the record's own `.gitignore` leaves out. The only thing sent
  to GitHub is the comment.
- A pull request from a fork gets a read-only token, so the comment cannot be written; the run
  logs a warning and the check still reports `verify`'s verdict.
- It reads the record at the repository root only, and only a `pull_request` event: any other event
  is refused by name. It is not on the Marketplace, so it cannot be used from another repository by
  name; its `action.yml` needs the built `dist/` of this package beside it, which `pnpm build`
  produces and the repository does not commit.
- Titles, names and ids it repeats come from the record and the tree. They are cut at 120
  characters and flattened to one line; `&`, `<`, `>` and backticks are replaced, `@` is followed by
  a zero-width space, and each of `\ [ ] ( ) ! * _ | #` is escaped with a backslash, so a link, an
  image, emphasis, a heading or a table-cell break in them is shown as text.
- It replaces only a comment that carries its marker and was written by `github-actions[bot]`; a
  comment with the marker from any other author is left alone and the Action adds its own.
- When neither the checked-out commit nor the base holds `.mnema/tails`, it logs
  `this repository holds no mnema record`, refreshes a comment it wrote earlier with that
  sentence (it adds none), exits 0, and runs neither `verify` nor `rules`.

## License

Apache-2.0. See the [LICENSE](../../LICENSE) and [NOTICE](./NOTICE).
