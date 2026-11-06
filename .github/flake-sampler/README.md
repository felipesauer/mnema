# The flake sampler

`ci.yml` answers **did it pass once**. This answers **how often does it pass**, and the two turned
out not to be the same question: two merges onto this trunk went red on a runner within
twenty-four hours (`6ce26119`, `9e06ab08`), both green on their pull request at the identical
tree, and neither a regression of the change that carried it.

It is **not a gate**. It blocks no merge, it is not a required check, it re-runs nothing until
green, and it repairs no flake it finds. It produces a **rate**.

## What runs

[`../workflows/flake-sampler.yml`](../workflows/flake-sampler.yml) runs the suite five times in
each of nine jobs (three runtimes times three shards) for **N=15 per runtime** a night, and hands every
report to [`summarize.mjs`](summarize.mjs), which publishes one row per case: how many of those
runs it failed in.

Five and not ten because of the time limit: one run of the suite takes about 13.6 minutes on a
runner (757 test files, measured on 2026-11-06), so five runs are about 70 minutes against the 90
a job may take, and ten were about 136, which cancelled every scheduled night from 2026-10-21. The
runners are shared by the organization that owns the repository, so a night holds nine of them for
about 70 minutes.

Three shards rather than one job of fifteen, because fifteen repetitions in one job sample one
virtual machine, and one job would not fit the limit. The split costs a little runner time
(setup on this repository is 15-21 s, since the pnpm cache hits), because the shards run at the
same time.

A pull request that touches the sampler runs it once per job: that run proves it counts, and it
opens no issue. A night asked for by hand takes the number typed, which wins over both.

## Reading a night

**A green night is not evidence that there is no flake.** With `p` the rate of a flake, N runs
find it with probability `1-(1-p)^N`:

| rate | N=5 | N=15 (a night) | N=105 (a week) |
|---|---:|---:|---:|
| 1 in 10 | 41% | 79% | 100% |
| 1 in 20 | 23% | 54% | 100% |
| 1 in 100 | 5% | 14% | 65% |

The detection is in the **accumulation** across nights. One night at 15 misses a one-in-a-hundred
flake six times out of seven.

And a row reading **every** run is a case that is broken at that commit, not a flake. The rate is
what tells them apart.

## Who is told

A night on the `schedule` that finds a case failing opens an issue for the case, or adds a comment
to the one that is open, with that night's rate and the link to the run. The title ends in a token
that is a hash of the file and the case name, and the job looks for an open issue by that token so
that the next night comments instead of opening a second. That is the intent: the shell loop that
does it has not yet run against GitHub, and whether the search finds an issue by a token with a
hyphen in it is for the first real night to show. A night whose ruler broke (a shard that did not report, a short count, or no tally at all) opens
one issue of its own, titled `Flake sampler: the ruler broke [sampler-ruler-broken]`, with the run
and what was short, or comments on it when it is open; it quotes no rate. A clean night says
nothing. The job that does this
(`tell-somebody`) runs on `schedule` only, so neither a pull request that touches the sampler nor
a night asked for by hand opens an issue, and an issue is still not a gate: it blocks nothing.

## RULER BROKEN

A counter that returns zero when it in fact read nothing is worse than no counter. So the
summariser refuses, by name, on a short count, on a label that carries the wrong number of runs,
on a report it cannot name or parse, and on a report whose `numTotalTests` is zero, which is what
vitest writes when it matches no test file at all, report file and everything.

It prints **no rate table** when it refuses, and it exits `2` rather than the `1` a flake gets.

## Asking for a night

```
gh workflow run flake-sampler.yml --ref <branch>
```

Works from any branch that carries the file (probed, not assumed): run `32556614503` was
dispatched against a branch that is not the default one. The nightly `schedule` is the half that
does **not** work from a branch: scheduled workflows fire from the default branch only, which is
`main`. Until this file reaches `main`, every night has to be asked for, or arrives because a
pull request touched the sampler.

## Reading a night by hand

Over artifacts downloaded from a run:

```
gh run download <run-id> --pattern 'flake-reports-*' --dir reports
node .github/flake-sampler/summarize.mjs \
  --reports reports --root "$PWD" --per-label 5 --expect 45
```

`--root` is stripped from the absolute paths the reports carry, so the rows name files the way
this repository does.

Its own suite is `packages/code/tests/the-sampler-counts-or-refuses.test.ts`, which runs in
`ci.yml` on every pull request and is exercised sixty more times by every night the sampler runs.
