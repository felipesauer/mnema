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
After a change to text, a page, the changelog or a list of files, `pnpm test:guards` runs just
the cases that walk the whole tree; it does not replace `pnpm test`. Build the site first
(`cd site && npm ci && npm run build`) and run `THE_SITE_MUST_BE_BUILT=1 pnpm test:guards`:
without a built site the cases that read it are skipped, not green.
Run the whole `pnpm test` once before you push, not only the files you touched: the guards
walk the tree and count its files and lines, so a focused case that passes proves little.
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

## Probing the product

Run the binary with a throwaway `HOME` and a working directory outside any checkout of this
repository: the private record lives in the `.git` of the working directory, so a probe run
from a clone writes into that clone.

## The record of this repository

Decisions here are recorded with mnema (the block at the end of this file says how). The
change to `.mnema/` goes in the same pull request as the work it describes, signed by the
key of whoever contributes. Never `.mnema/private/`, never key material.

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
`node_modules/`, `coverage/`); local assistant state (the one file of `.claude/` that is
committed is `.claude/rules/mnema-instructions.md`, written by `mnema instructions`). Run the product against a throwaway
`HOME`, never your own.

<!-- mnema:begin v3 (written by mnema; `mnema instructions --remove` takes it out) -->

## Recording the work (mnema)

This repository keeps a signed record of its decisions in `.mnema/`. Where the mnema tools are connected:

- At the start of a session, call `bootstrap`: it opens with what is in force, what awaits a judgement and the work in flight.
- Before changing a file, call `governing_rules` with its path.
- When a choice is settled, with the person or alone, that someone could later question (a library, an approach, a trade-off, an option turned down), call `record_decision` in that turn, with the `rationale` and, in `alternatives`, what was turned down and why. Record it even when it is also written in a plan, a ledger, this file or your own memory.
- A decision is born `proposed`; once it is accepted it is in force here (an acceptance made by an agent is recorded as an agent’s, and `mnema switch off agent-accepts` leaves it to a person).
- A decision is not edited once it is recorded. When a new one replaces an earlier one, record the new one and then call `decision_transition` on the earlier one with `action` `supersede`, the new decision’s id in `by` and the `reason`; the new one is then read as replacing the earlier one, which it names.
- A subagent records no decision: it hands its decisions back in its final reply, and the session that started it records them.
- When you learn something about this project that its code does not show, call `capture_memory`, also when you keep it in your own memory.
- Work in flight is a task (`create_task`), and handing work to another agent is a handoff on it (`record_handoff`), with its brief: the short text, and the path of a file where the brief is long.
- Not for the record: each step taken, a credential, personal data, what the code or git already says.
- Commit `.mnema/` with the work it describes: the record changes as the work does, through these tools and the `mnema` command. Never edit or reformat its files by hand.

Where the tools are not connected and the `mnema` command is installed, the shell does the same. This records a decision, with what was turned down:

    mnema decision record "Use pnpm for the workspace" "The lockfile and the workspace scripts already assume it." --alternatives "npm: no workspace protocol; yarn: a second lockfile to keep"

And this one says a new decision replaces an earlier one:

    mnema decision supersede <old-id> <new-id> --reason "<why>"

<!-- mnema:end -->
