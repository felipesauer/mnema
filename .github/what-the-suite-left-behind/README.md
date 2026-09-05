# What the suite left behind

A run of this suite makes sandboxes under the machine's temp directory — **187 distinct prefixes**,
every one of them beginning `mnema-`. When one outlives the run it costs nothing anybody looks at,
which is how **47.237** of them accumulated before an audit counted them in August 2026.

Two things already ask about this, and neither can ask it of the machine:

- `packages/code/tests/every-sandbox-is-removed-where-it-was-made.test.ts` reads source and
  follows the created name to the removal that reaches it. It answers what a **file says**;
- `packages/copilot/tests/the-bench-leaves-nothing-behind.test.ts` names the directory `makeBench`
  created and asks the filesystem whether it went. It answers for **one** prefix of the 187, and
  only because that helper hands back a root the sandbox can be derived from.

This covers the other 186, from outside the suite.

## Why it is not a test

The obvious test — list the temp directory before a call and after it, and require exactly one new
entry — was written, shipped, and measured being a race. Vitest runs several files at once and
every one of them builds under this same family, so another worker's sandbox appearing inside the
window is attributed to this call: **six of six** runs of the copilot package alone went red, and
**two of three** full-suite runs.

**The race is the window, not the diff.** Two listings taken while workers are alive can disagree
for reasons that are nobody's defect. Two listings taken while *no* worker is alive cannot: what
appeared between them is what the run left, because nothing else was writing. So the before is
taken with the suite stopped, the after with the suite stopped, and anything that cannot prove
that is a refusal rather than an answer.

## Using it

```
pnpm what-the-suite-left-behind --record     # before the suite, with nothing of ours running
pnpm test
pnpm what-the-suite-left-behind              # after the LAST run of the suite
```

`--tmp <dir>`, `--prefix <p>`, `--baseline <path>`, `--summary <path>` and `--json <path>` are
all optional; the defaults are the machine's temp directory, `mnema-`, and
`what-the-suite-left-behind.json` (gitignored — it is a fact about one machine at one instant).

| it prints | it means | exit |
|---|---|---|
| `NOTHING LEFT BEHIND` | no new `mnema-*` directory survived the run | 0 |
| `LEFT BEHIND` | these appeared while the suite ran and outlived it, named in full | 1 |
| `RULER BROKEN` | it could not tell, and says which of the three reasons | 2 |

The three refusals are a live suite, no recorded baseline, and an unreadable temp directory or
process list. None of them is ever reported as a clean sweep — a ruler that cannot say it broke is
worse than no ruler, which is the rule `.github/why-it-went-red/` was built on and this follows.

## In CI

Two steps, and their **order is the mechanism**: the record runs before the first `pnpm test` and
the report after the coverage gate, which is a *second* run of the suite. A report between the two
would read a temp directory the second run is about to write. Placed wrongly it would refuse
rather than answer, and `packages/code/tests/what-the-suite-left-behind.test.ts` reads `ci.yml`
and fails if the record is not before every run of the suite and the report after all of them.

## What it does not cover

- it names what survived and **not who made it**. 187 prefixes narrow it to a package, and the
  source-reading guard is what says which file;
- a sandbox made and leaked **outside** a run of the suite is attributed to the run, because the
  only thing between the two listings is the run;
- it does not run inside `pnpm test`, so a leak introduced locally is seen on the next CI run
  rather than in the loop of whoever introduced it. That is the price of not racing;
- the process list is Linux's `/proc`. Elsewhere it cannot be read, and the sweep refuses.

Pinned by `packages/code/tests/what-the-suite-left-behind.test.ts`, including the one mistake this
instrument has already made: excluding its own process **by name** filtered out a real vitest run
whose command line named that test file.
