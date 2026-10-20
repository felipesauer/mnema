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

`pnpm test:guards` runs only the cases that walk the whole tree (every page, every workflow,
every file that needs a test), the ones a change breaks without touching them. Run it after
a change to text, a page, the changelog or a list of files; it does not replace `pnpm test`.
A case joins it by carrying `// @reads-the-tree` as its first line.

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
- **No em dash.** A text file in the repository that holds U+2014 is a red, at its line and
  column ([`the-prose-carries-no-em-dash.test.ts`](packages/code/tests/the-prose-carries-no-em-dash.test.ts)).
  The areas not yet rewritten are listed there, each with a ceiling that only goes down. Where the
  character is data, its escape is allowed only in the files that test lists, each with its reason.

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

**Publishing to npm is the maintainer's own act**, and the first publication is made by hand. After it, a
workflow publishes, but only when a person approves it. A release needs no token and no secret in this
repository: npm trusts `.github/workflows/release.yml` (see below) and signs a provenance statement with
each package.

The check that runs before any of this packs the five publishable packages, installs them together into
an empty prefix and an empty `HOME`, and runs `init`, `decision record` and `verify` with the installed
binary. It runs on a push to `main`, and you can run it yourself:

```sh
pnpm build && bash .github/the-packed-install/run.sh
```

### The first version, 0.1.0

1. Open a pull request that runs `pnpm release:prepare 0.1.0`. **Write the number**: without one the script
   proposes a number from the CHANGELOG, and today that would be 0.2.0. The pull request carries what the
   script writes: the number in every manifest, the CHANGELOG cut, the recording made again.
2. Merge it.
3. On the merged commit, build and pack the five, then publish them in this order, from your own login (the
   packages are not on npm yet, so there is no trusted publisher to publish for you):

   ```sh
   pnpm install --frozen-lockfile && pnpm build
   mkdir -p /tmp/mnema-tarballs
   for p in chain core context stacks code; do (cd packages/$p && pnpm pack --pack-destination /tmp/mnema-tarballs); done
   for p in chain core context stacks code; do npm publish /tmp/mnema-tarballs/mnema-$p-0.1.0.tgz --access public; done
   ```

4. On npmjs.com, for each of the five packages, add a trusted publisher: this repository, the workflow file
   `release.yml` and the environment `npm`. In the repository's Settings, make an environment named `npm`
   with yourself as a required reviewer.
5. Run the `Release` workflow by hand (Actions, Run workflow) with `mode: tag-only`. It publishes nothing: it
   checks that the five packages on npm carry the version of the root `package.json`, and only then creates
   the tag `v0.1.0` and the release of GitHub.
6. On each package's settings on npmjs.com, turn on "Require two-factor authentication and disallow tokens".

### The next versions

1. `pnpm release:prepare` (with the number, or without it to be told one and why), then a pull request.
2. Merge it. The `Release` workflow starts on the push to `main` and waits for your approval in the `npm`
   environment.
3. On approval it runs the packed install on Node 24.15.0, 24 and 26, publishes the five tarballs in the
   order chain, core, context, stacks, code (with `--provenance`, skipping one that is already at the
   version), and only then creates the tag and the release, whose notes are the CHANGELOG section.

While `@mnema/code` is not on npm, a push to `main` does not publish: the workflow says the first
publication is by hand and ends green. The workflow has not run yet.

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
