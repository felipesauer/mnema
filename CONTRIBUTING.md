# Contributing to mnema

This page is for someone who has just cloned the repository and wants to change it. What
the product is, and what it does and does not prove, is on the [front page](README.md).

## What you need

- **Node.** Requires Node ≥ 22.12.0: that is the floor `engines.node` declares in the root
  `package.json`, and `.npmrc` sets `engine-strict=true`, so an older runtime is refused at
  install rather than failing later. CI runs the suite on Node 22 and 24.
- **pnpm**, at the version the root `package.json` pins in `packageManager`. This is a pnpm
  workspace, and every step below goes through it.
- **Python 3**, as `python3` on the `PATH`. The second reader in
  [`packages/chain/verifier/`](packages/chain/verifier/) is standard-library Python, so there
  is nothing to install, and its cases in the suite fail rather than skip when `python3` is
  missing. The oldest Python it supports is stated on
  [its page](packages/chain/verifier/README.md), which is the one place that number lives.
- **git**, and the `script` and `stty` of util-linux: the cases that drive the console through
  a pseudo-terminal call both. CI runs on Ubuntu.

## The gates

In this order:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm lint
pnpm typecheck
pnpm test
```

- `--frozen-lockfile`, so that a change to `pnpm-lock.yaml` is one you meant to make.
- `pnpm build` comes before `pnpm typecheck` and `pnpm test`. The packages compile against
  each other's built declarations, and cases that cross a package read its `dist`, so a stale
  `dist` is how a type check or a test goes green over code that no longer exists.
- `pnpm lint` is Biome with warnings as errors.
- `pnpm test` is the whole suite. Every test process runs with a `HOME` made for it, so a run
  never signs with your key or writes to your own records
  ([`.github/a-home-of-its-own/`](.github/a-home-of-its-own/README.md)).

**When a case goes red, keep the output before you run it again**, then run
`pnpm why-it-went-red`. It runs each red case again on its own and says which of two things
the red was: `THE GUARD CAUGHT` (it fails alone too, so it is a defect at this commit) or
`IT DID NOT REPRODUCE ALONE` (the machine was busy). The rest of what it can say is in
[its page](.github/why-it-went-red/README.md).

## What the suite will hold you to

Much of the suite guards the repository itself, not only the product's behaviour. These are
the ones a first change usually meets:

- **Every product file has a test that observes a value it produced.** Line coverage is not
  enough here: [`every-file-has-a-test-that-names-it.test.ts`](packages/code/tests/every-file-has-a-test-that-names-it.test.ts)
  accuses a file under `packages/*/src` that no test imports and asserts about, unless it has
  a row in the file's ledger saying what reaches it instead. The ledger can only shrink. The
  same file counts the import clauses of the whole test tree, so a new test moves that number:
  the failing case shows the new count, and you write it into the file on purpose.
- **Pages are checked against the binary.** A `mnema` command in a shell block, or in an
  inline code span, of a tracked Markdown page is parsed by the real command tree, and a verb
  or a flag the binary does not have is a red
  ([`the-shell-a-page-publishes-is-the-shell-that-runs.test.ts`](packages/code/tests/the-shell-a-page-publishes-is-the-shell-that-runs.test.ts),
  [`the-command-handed-over-runs-as-handed.test.ts`](packages/code/tests/the-command-handed-over-runs-as-handed.test.ts)).
  Both keep an exact count of the commands they read, so adding one means updating that count
  too. Relative links and `#anchors` in a page have to land
  ([`every-link-a-page-carries-lands.test.ts`](packages/code/tests/every-link-a-page-carries-lands.test.ts)).
- **No label without a definition in the repository.** A shorthand whose meaning is not
  written in any tracked file is refused
  ([`a-label-a-stranger-can-look-up.test.ts`](packages/code/tests/a-label-a-stranger-can-look-up.test.ts)).
  Write the principle out in words instead.
- **No credit to the tool that wrote a change.** A commit message or a pull request
  description that credits a coding assistant as co-author, or carries its generated-by
  footer, fails the `the-link-cannot-come-back` job
  ([its page](.github/the-link-cannot-come-back/README.md)).

A new guard is expected to come with a case that shows it failing on the defect it exists
for: a guard that has never been seen to fail looks exactly like one that cannot.

## A pull request

- **One change per pull request.** If the work has two parts, it is two pull requests.
- **A title in English that says what changes**, as a sentence, the way the history already
  reads: `git log --oneline` shows the form.
- **When two ways of doing something pull apart, the one that keeps the record checkable wins
  over the one that is more convenient.** That is the criterion behind most of what the
  guards above ask for.

Security problems are not reported through a pull request or a public issue: see
[`SECURITY.md`](SECURITY.md). Taking part in this project means following the
[Code of Conduct](CODE_OF_CONDUCT.md).
