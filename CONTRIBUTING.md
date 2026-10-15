# Contributing to mnema

This page is for someone who has just cloned the repository and wants to change it. What
the product is, and what it does and does not prove, is on the [front page](README.md).

## What you need

- **Node.** Requires Node 24.15.0 or a later 24, or 26.0.0 or later: that is the range `engines.node` declares in the root
  `package.json`, and `.npmrc` sets `engine-strict=true`, so an older runtime is refused at
  install rather than failing later. CI runs the suite on Node 24.15.0 (the floor), the current 24 and 26.
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
  same file keeps a line for every product file and a line for every test file with the number
  of import clauses in it, so a new file, a removed one, or a changed import is red: the failing
  case names the file and what it read, and you write that line into the file on purpose.
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

## Changing a skill

The skills the plugin ships are in [`plugin/skills/`](plugin/skills/). **A change to a skill, or a
new one, comes with an eval: the cases that must bring the skill up and the cases that must not.**
Today no automated eval of that kind exists. What runs is
[`every-skill-the-plugin-ships-is-what-it-says.test.ts`](packages/code/tests/every-skill-the-plugin-ships-is-what-it-says.test.ts),
which holds the form (the `name` is the directory, the `description` says when the skill applies,
every tool it cites is served), not whether a model reaches for it. So the minimum is in the pull
request: at least one prompt that should activate the skill and one that should not, and what a
real run of a host did with each. A change to the `description` is the change this matters most
for, since that line decides when the skill is offered. If an eval is added later, this section
names how to run it.

## Releases

There is no tag and no release until the first publication on npm, and the procedure for one will be
written with it. **Publishing to npm is the maintainer's own act**: nothing here runs `npm publish`.
What exists today is the check of the package: it packs the five publishable packages, installs them
together into an empty prefix and an empty `HOME`, and runs `init`, `decision record` and `verify` with
the installed binary.

```sh
pnpm build && bash .github/the-packed-install/run.sh
```

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
