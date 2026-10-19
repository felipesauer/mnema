# Notes for an agent changing this repository

This is the short list of what an agent gets wrong here first. What the product is lives on
the [front page](README.md); the full contributor guide is [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Run the gates, in this order, on what you committed

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm lint
pnpm typecheck
pnpm test
```

`pnpm build` comes before `pnpm typecheck` and `pnpm test`: the packages compile against each
other's built output, so a stale `dist` makes both go green over code that no longer exists.
When a case is red, keep the output, then run `pnpm why-it-went-red`: it says whether the
guard caught a defect or the machine was busy.

## Commits and pull requests

- Branch, commit message and pull request in English, descriptive: what changes, as a sentence.
- Commit with a `users.noreply.github.com` address, not a work or personal one
  (`git config user.email` shows which you will use).
- No `Co-Authored-By` trailer and no generated-with footer: the
  `the-link-cannot-come-back` job fails on them. If an agent wrote the change, say which model,
  host and version in the field the pull request template asks for.
- One change per pull request. Add files by path; never `git add -A` or `git add .`.

## Where the tests are

Product tests are in `packages/*/tests/`, named for the behaviour they hold. A new file under
`packages/*/src` needs a test that asserts about a value it produced, and a new test file needs
its line in `every-file-has-a-test-that-names-it.test.ts`. `pnpm typecheck` checks the tests
too (each package's `tsconfig.test.json`), but vitest strips types when it runs them, so a type
is never what makes a test fail: assert on a value, never on a type guard. A new guard comes
with a case that shows it failing on the defect it exists for.

## Skills

A change to a skill in `plugin/skills/` needs an eval: prompts that must bring the skill up and
prompts that must not, and what a real run did with each. No automated eval exists yet; the test
named `every-skill-the-plugin-ships-is-what-it-says` checks only the skill's form. The details are
in [`CONTRIBUTING.md`](CONTRIBUTING.md#changing-a-skill).

## Writing

A sentence in a README or `--help` says only what the code guarantees, and a claim cites the
test or measurement that holds it. A sentence that stopped being true is rewritten with the
reason, not deleted.

No em dash (U+2014) in anything you write here: docs, comments, test names, strings the product
prints, manifests, commit messages and pull request descriptions. Use a comma, a colon, a full
stop or parentheses, as the sentence needs. Where the character is data (a width, a byte count, a
format someone else defines), write it as an escape (a backslash, then `u2014`) and add the file
to the list in `packages/code/tests/the-prose-carries-no-em-dash.test.ts`, with the reason. The en
dash (U+2013) is not covered.

## Never commit

Keys, tokens or anything that signs; the contents of a real `~/.mnema`, anything under
`.mnema/private/`, and key material anywhere; absolute
paths of a person's machine; the output of an eval run; build output (`dist/`,
`node_modules/`, `coverage/`); local assistant state. Run the product against a throwaway
`HOME`, never your own.
