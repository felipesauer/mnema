# The link cannot come back

This repository does not credit the tool that wrote a change in the change's own record. No
`Co-Authored-By:` naming the assistant in a commit message; no `Generated with [Claude Code]`
under a pull request description.

The rule is old and explicit. It held for **243 pull requests** because a person remembered it
each time, and on **2026-09-11** a sweep found what remembering had missed:

| where | how many | reach |
|---|---:|---|
| a co-author trailer in `main-v1`'s own commits | **1** | the default branch of a public repository |
| `🤖 Generated with [Claude Code]` in those commits | **13** | 27/07 to 11/09 |
| the same footer in pull request **descriptions** | **19** | public, #361 to #616 |

Undoing it cost **194 rewritten commits**, a force-push onto a protected branch with the
protection opened and closed around it, and 19 API calls. Of the four deliveries around the leak,
three were read by hand before their merge and the footer was removed; **the one that was not read
is the one that carried it**. That is the whole argument for this directory: the rule had no
machine.

## The two surfaces

**The commit message** is the half everybody thinks of, and the dear one to repair.

**The pull request body** is not git at all — it is a field of the GitHub API — and it carried
**19 of the 33** leaks. A guard over commits alone leaves the larger half open, so both go through
one rule (`attributionIn`), and `packages/code/tests/the-link-cannot-come-back.test.ts` fails if
either surface stops being handed to it.

## What it refuses, and what it must not

Two spellings, each declared with the shape it recognises rather than as a substring:

- **a co-author trailer whose value names the tool or its vendor.** The line must *be* a trailer —
  it starts with the key — and the value must name `anthropic` or `claude`;
- **the generated-with footer, by its bracketed name or by its link.** `claude.com/claude-code` is
  checked on its own, because the emoji, the spacing and the bracket text are cosmetic and the
  link is the thing this directory is named after.

The other half of being right is what it lets through, and on this repository that half is
load-bearing:

- **the 13 `Co-authored-by: dependabot[bot]` trailers on the trunk.** There is **no allowlist**:
  `dependabot` is not named anywhere in the rule, and its trailer passes for the same reason a
  human co-author's does — the value names neither the vendor nor the tool. An exemption would be
  a hole with a name on it. A guard that blocks the next dependency bump is switched off that
  afternoon;
- **upstream release notes that credit the tool for somebody else.** Three of those 13 embed
  `<strong>Claude Opus 4.8</strong>` and six embed `This PR was generated with [Release Please]`.
  A substring scan accuses all nine;
- **the word, where it is this product speaking.** `which: 'claude'` is a value this product
  produces, and `plugin/` documents a host plugin. **The rule is over the footer, never over the
  word.**

## Using it

```
pnpm the-link-cannot-come-back --range <base>..<head> --commits-only
```

On a runner it needs neither: the range and the description both come out of the event payload
the runner wrote, read as a **file**. Nothing is interpolated into a shell — a description is text
a stranger wrote, and on a public repository `${{ github.event.pull_request.body }}` inside a
`run:` hands that stranger the runner.

`--commits-only` is the honest way to run half the rule by hand, and the page says out loud that
the description was not examined. CI never passes it, and a case fails if it ever does.

| it prints | it means | exit |
|---|---|---|
| `NO ATTRIBUTION FOOTER` | neither footer appears, on either surface | 0 |
| `ATTRIBUTION FOUND` | these lines credit the tool, each named with its surface and line | 1 |
| `RULER BROKEN` | it could not tell, and says which reason | 2 |

## The refusals

A scan that examined **zero commits** is the dangerous one: a shallow checkout, a base that was
never fetched, or a range written backwards all read as *the trunk is clean*, because zero commits
carry no footer. This bench has been bitten by that shape three times, so zero commits is a
refusal with a phrase of its own — `THE_CANARY`, exported so a case pins it rather than a quoted
substring. So are *no pull request at all*, *no range*, and *git could not read the range*.

## In CI

A job of its own in [`../workflows/ci.yml`](../workflows/ci.yml), and three of its lines are the
mechanism rather than detail:

- **`if: github.event_name == 'pull_request'`.** The guard exists to refuse the footer *before* it
  reaches the trunk. On `push` the commit is already in, so a red there repairs nothing and blocks
  every merge behind it until the history is rewritten — which is the state this repository was in
  for seven weeks. The description half does not exist on that event at all;
- **`fetch-depth: 0`.** The scan reads `<base.sha>..<head.sha>`, and a default checkout on a
  `pull_request` is depth 1: the base is not there and `git rev-list` exits non-zero. That is a
  refusal rather than a green, which is the canary working — but a guard whose normal state is
  `RULER BROKEN` is a guard nobody reads. Measured here: 16.43 MiB packed and 601 commits on the
  trunk, a full clone against a depth-1 one is **0.59 s against 0.25 s** and 13 MB against 4 MB of
  `.git`, with no network in either;
- **`node` and not `pnpm`.** The scan imports nothing but `node:` builtins, so there is nothing to
  install, and a guard that can redden because a package manager failed to set itself up is a
  guard switched off for a reason that has nothing to do with what it guards.

It is a **job** rather than a step of the matrix because it wants the whole history and the matrix
does not; it runs in parallel and adds nothing to the wall clock. The test reads `ci.yml` and
fails if the condition goes away, if the checkout stops being deep, or if the step ever passes
`--commits-only`.

## What it does not cover

- **the 68 merged branches** that still carry the footer in their pre-squash commits. They are
  public and they are outside a pull request; deleting them is the owner's operation, not a check;
- **a footer written into a file** rather than into a message or a description. The universe here
  is the record of the change, not its content;
- **a quoted trailer inside an embedded release note.** A line that reads exactly
  `Co-authored-by: Claude …` inside somebody else's changelog would be accused. Measured across
  every commit body on this trunk: **zero** such lines. The reading stays the strict one, because
  a false positive costs one red build and an amend, and a false negative cost 194 rewritten
  commits;
- **the message typed into the squash box at merge time.** GitHub composes that body out of the
  pull request and its commits, both of which this reads, so the default is covered — but a
  maintainer who types a footer into the box at the moment of merging is past every pre-merge
  check there is. The thirteen generated-with lines on this trunk arrived as squash bodies
  composed from what the guard now reads, which is why the default being covered is worth
  something;
- **who wrote the change.** It says the record does not credit the tool. It does not say who did
  the work, and it is not trying to.

Pinned by `packages/code/tests/the-link-cannot-come-back.test.ts`, whose six central cases are the
three that must go red and the three that must stay green.
