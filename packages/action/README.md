# @mnema/action

[![CI](https://img.shields.io/github/actions/workflow/status/felipesauer/mnema/ci.yml?branch=main&style=flat-square&label=CI&color=997dbf)](https://github.com/felipesauer/mnema/actions/workflows/ci.yml) [![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-997dbf?style=flat-square)](../../LICENSE) ![Node 24.15.0 or a later 24, or 26.0.0 or later](https://img.shields.io/badge/node-%5E24.15.0%20%7C%7C%20%3E%3D26.0.0-997dbf?style=flat-square) ![Not published: run from a checkout](https://img.shields.io/badge/npm-not%20published-997dbf?style=flat-square)

A GitHub Action for [mnema](https://github.com/felipesauer/mnema). On a pull request it reads the
record the repository already carries in `.mnema/`, writes ONE comment saying what the pull request
does to it, and fails the check when the record does not verify as signed. Handed a checker key, it
also runs the checks the rules in force carry and records whether each one held.

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
- **`verify --require=signed --since <base>` as the check.** The Action fails when
  `mnema verify --require=signed --since <base>` exits non-zero, `<base>` being the pull request's
  base commit. Both are flags of `verify`; nothing is added to them here. `--since` is what catches
  a record cut back to an earlier state that is honest in every byte — the newest events taken
  with the checkpoint that covered them — which a reading of the record alone cannot see; it also
  fails a tail removed after a `tail.pruned`, which is the one change a reviewer has to look at.
- **Optional, off by default: approval for rules that ask for a person.** With
  `require-approval-for-asks: "true"` the Action also fails when a changed file is addressed by an
  accepted `asks-for-a-person` rule and no reviewer other than the author stands approved on the
  pull request.
- **Optional, off by default: the checks the rules carry.** With `checker-key` set from a
  repository secret, the Action runs `mnema check run` with that key once everything above is read:
  each rule in force that carries a check gets one `check.passed` or `check.failed`, signed by the
  key, naming the rule and the commit checked out. The results are left in the working tree, the
  comment gets a "Checks the rules carry" section with what passed and what failed, rule by rule
  (when no check ran, one line says why), and the Action fails when a check did not pass. Without
  `checker-key` the comment has no such section.
- **Quiet on pull requests that do not concern the record.** It adds a comment only when the pull
  request adds events, touches a governed file, or the record fails to verify. A comment it wrote
  earlier is still refreshed, so it never goes stale. A comment over the 65536 characters GitHub
  accepts is cut, with a line saying so.

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
The action runs on `node24`, and starts the `mnema` binary with that same Node, not with the one `actions/setup-node` puts on the `PATH`. That Node is the one the runner carries for `node24` actions: GitHub's hosted runner is above the floor, and a self-hosted runner older than v2.334.0 (which carries 24.14.0) refuses to run the binary.

### Running the checks

A rule can carry the program that checks it (`mnema check declare <decision-id> <program>`), and a machine with a key of its
own records whether it held. That key is a checker: the record enrolls it once, and it signs check
results and nothing else.

1. On any machine, make the key under a home of its own, so it is not the key you write with:
   `MNEMA_HOME=<a new directory> mnema key request --checker --anchor <your identity>`.
2. In the project, enroll the line it printed: `mnema key enroll --checker <the line>`, then commit
   and push the record.
3. Store the private half — the `.key` file under `<that directory>/identity/keys/` — as a
   repository secret, for example `MNEMA_CHECKER_KEY`, and delete the file.
4. Hand it to the Action, and keep the results:

```yaml
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
          # the pull request's own commit, so a result names a commit that stays in the history
          ref: ${{ github.event.pull_request.head.sha }}
      # … install and build as above …
      - uses: ./packages/action
        with:
          checker-key: ${{ secrets.MNEMA_CHECKER_KEY }}
      - uses: actions/upload-artifact@v7
        if: always()
        with:
          name: mnema-check-results
          path: .mnema/tails/
```

A result names the commit checked out. The default checkout of a `pull_request` event is a merge
commit that exists only on the runner, which is why the example checks out the pull request's head.
Committing the results, or uploading them as above, is a step of your workflow: the Action pushes
nothing.

If the secret leaks, retire the key — `mnema key revoke --checker <fingerprint> --reason "<why>"`,
from a machine that writes as a member — commit and push the retirement, and enroll a new key. From
the retirement on, `mnema verify` refuses a result the old key signs, and it names the results that
key signed before in its census: they were signed while the key held the role, and a leaked key can
date a result before its own retirement, so the record no longer vouches for them.

| Input | Default | What it does |
| --- | --- | --- |
| `github-token` | `${{ github.token }}` | reads the pull request's files and reviews, and writes the comment |
| `require-approval-for-asks` | `false` | `true` fails the check when an accepted `asks-for-a-person` rule addresses a changed file and only the author has approved |
| `checker-key` | empty | the private half (PEM) of a key the record enrolls as a checker, from a secret; runs `mnema check run` with it and fails when a check did not pass. Empty runs no check |

## How it is built

The part worth testing has no network in it. `record.ts` reads `.mnema/tails/*.jsonl` and says
which events a pull request added; `governed.ts` reads the answer of `mnema rules <path> --json` and the
pull request's reviews; `comment.ts` turns a report into text; `judge.ts` is one run, with the
repository, `mnema` and GitHub handed in. GitHub is reached in `github.ts` over `fetch` with the
token, and `fetch` is a parameter. `world.ts` is `git` and the `mnema` binary as child processes;
`run.ts` is the entry `action.yml` runs.

## What it proves — and what it does not

- It proves what `mnema verify --require=signed --since <base>` proves and nothing beyond it: every
  event of the record is covered by a verified signature, and every file of the record the base
  commit held still begins with the bytes it held there. It does not add a second verifier and does
  not widen that promise; `--require=witnessed` is not asked. A cut is caught against the base the
  pull request names, and a base that is itself already cut is not
  (`packages/action/src/run.test.ts`).
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
- Without `checker-key` it never writes to the record or signs an event. With it, it writes the
  results `mnema check run` signs to the working tree, and nothing else; it never commits or
  pushes. `mnema` keeps a projection cache under `.mnema/locks/`, which the record's own
  `.gitignore` leaves out. The only thing sent to GitHub is the comment.
- A result says that the key the record enrolled reported the rule held at that commit. It does
  not prove the program ran as declared, nor that it checks what its rule says; whoever can commit
  a declaration can make the runner start that program.
- The checker key is written to a file readable by the runner's user only, under `RUNNER_TEMP`,
  for the length of the run, and removed after it. A declared program is started without the
  Action's inputs in its environment — the key and the token among them — and without `MNEMA_*`;
  it runs as the same user, so it can read the key file while it exists. Scope the secret to the
  job that runs the checks.
- A pull request from a fork is not given the repository's secrets, so `checker-key` arrives empty
  and no check runs there.
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
