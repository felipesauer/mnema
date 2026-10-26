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
- `pnpm test:host-contract` starts a real host and is not part of `pnpm test`; it needs
  `MNEMA_HOST_CONTRACT_HOST` and that host's own variables (see
  [`vitest.host-contract.config.ts`](vitest.host-contract.config.ts)). What each host sends of the
  server's 27 tool definitions is pinned in
  [`packages/code/tests/host-contract/weights/`](packages/code/tests/host-contract/weights), one file
  per host. After a tool's description changes, `pnpm test:host-contract the-tool-definitions-the-host-sends -u` for each of the four hosts
  (Claude Code, OpenCode, Copilot CLI, Gemini CLI) rewrites its file with what the host sent; commit
  the four, and the figures `docs/evidence.md` repeats. Without `-u` a different figure fails the case
  and shows the difference.

Beside the suite, CI runs two scanners on every pull request and on `main`, outside the checks a
pull request must carry: `gitleaks` reads the whole history for a committed credential, and
`osv-scanner` reads `pnpm-lock.yaml` for a dependency with a published advisory (and again every
Monday, against the lockfile as it is). `.gitleaks.toml` lists what is public or made up and why;
a finding that is not on that list is a credential to rotate, not a line to add to it.

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

**Publishing to npm is the maintainer's own act**: the first version was published by hand, and from then on
a workflow publishes, but only when a person approves it. A release needs no token and no secret in this
repository: npm trusts `.github/workflows/release.yml` (see below) and signs a provenance statement with
each package.

The check that runs before any of this packs the five publishable packages, installs them together into
an empty prefix and an empty `HOME`, and runs `init`, `decision record` and `verify` with the installed
binary, and it fails if a tarball carries a source map. CI runs it on Node 24.15.0, 24 and 26, and you can
run it yourself:

```sh
pnpm build && bash .github/the-packed-install/run.sh
```

### The first version, 0.1.0

Done for 0.1.0 on 20 October 2026: the five packages are on npm, each trusts `release.yml` in the `npm`
environment, and each requires two-factor authentication and disallows tokens. The steps stay here for a
package added later, whose first version is published by hand the same way before npm can trust the
workflow for it.

1. Open a pull request that runs `pnpm release:prepare 0.1.0`. **Write the number**: without one the script
   proposes a number from the CHANGELOG, and today that would be 0.2.0. The pull request carries what the
   script writes: the number in every manifest, the CHANGELOG cut, the recording made again.
2. Merge it.
3. On the merged commit, build and pack the five, then publish them in this order, from your own login (a
   package that is not on npm yet has no trusted publisher to publish for it). The `@mnema` scope
   has to exist on your npm account before this step: create the organization or the user scope first, or
   the first `npm publish` is refused.

   ```sh
   pnpm install --frozen-lockfile && pnpm build
   mkdir -p /tmp/mnema-tarballs
   for p in chain core context stacks code; do (cd packages/$p && pnpm pack --pack-destination /tmp/mnema-tarballs); done
   for p in chain core context stacks code; do npm publish /tmp/mnema-tarballs/mnema-$p-0.1.0.tgz --access public; done
   ```

4. In the repository's Settings, make the environment named `npm` first: yourself as the required
   reviewer, and "Deployment branches" limited to `main`. Do this before the next item: an environment
   that does not exist is created with no protection at all when a job asks for it.
5. Then, on npmjs.com, for each of the five packages, add a trusted publisher: this repository, the
   workflow file `release.yml` and the environment `npm`.
6. Run the `Release` workflow by hand (Actions, Run workflow) with `mode: tag-only`, and approve it in the `npm`
   environment when it asks (the tag and the release are never made without your approval, in this way or
   after a publish). It publishes nothing: it checks that the five packages on npm carry the version of the
   root `package.json`, and only then creates the tag `v0.1.0` and the release of GitHub. The tag falls on the
   head of `main` at the moment you dispatch, so run this before any other pull request is merged.
7. On each package's settings on npmjs.com, turn on "Require two-factor authentication and disallow tokens".

### The next versions

1. `pnpm release:prepare` (with the number, or without it to be told one and why), then a pull request.
2. Merge it. The `Release` workflow starts on the push to `main`. A job that holds no `id-token` installs,
   builds and packs the five and keeps the tarballs with their SHA-256; the packed install installs those very
   tarballs on Node 24.15.0, 24 and 26. Only when those pass does the publish wait for your approval in the
   `npm` environment.
3. On approval the publish downloads the tarballs, checks the SHA-256 and publishes them in the order chain,
   core, context, stacks, code (with `--provenance`, skipping one that is already at the version). It installs
   and builds nothing (it only checks that the npm it has is 11.5.1 or newer), so what is published is what was
   tested and no install script runs while the job can ask for the OIDC token. It checks each tarball against
   the SHA-256 that the packing job exposed as its own outputs, not against a file that travels with the
   tarballs.
4. The tag and the release (whose notes are the CHANGELOG section) come only after the five are on npm (the job
   asks npm every 30 seconds for up to about ten minutes, since npm can take that long to serve a new version), and
   they ask for your approval in the `npm` environment once more.

If a publish stops halfway, run the workflow again (Actions, Run workflow, `mode: publish`): the packages
already at the version are skipped and the ones left are published. The tag and the release are made only
once all five are on npm. A run again packs and tests the head of `main` as it is then, not the commit of
the run that stopped: the packages already published came from the earlier commit, and the tag falls on
the commit of the run that finishes. If `main` moved in between, the packages are not all from one commit,
so before running again check that the commits since are not changes to the packages.

A push to `main` whose root version is the one npm already serves publishes nothing and ends green.
The workflow has published versions since 0.1.1 (the first one, 0.1.0, was published by hand).

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
