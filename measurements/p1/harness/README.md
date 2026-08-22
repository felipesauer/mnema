# The P1 instrument — one cell for each arm

This is the runner that produced every number under [`../results/`](../results/). It is here for
one reason: the directory above it publishes results and a reading of them, and a result whose
instrument is not published is *our word* about how it was obtained. The
[pre-registration](../protocol.md) fixes what was promised before the number existed; this fixes
what actually ran.

**No model is called by anything in this directory until `--yes` is passed.** `--selftest` is
free, and nothing that spends starts before it is green.

---

## The limit, and it comes before the promise

**You cannot reproduce our rounds, and that is by design rather than by omission.** The tasks are
held out: [`../fixtures.sha256`](../fixtures.sha256) publishes a digest per task precisely so that
nobody has to publish a task, because a task published before it is used is a task the thing being
measured may already have read. While a round is pending, a third party can check that the tasks
did **not change** between the freeze and the result, and cannot yet check what they say.

So *"runnable by somebody else"* means exactly one thing here:

> **Another team runs the METHOD on their own tasks.** It does not reproduce our numbers; it
> installs the same discipline and produces theirs.

Any reading stronger than that is false, and this file says so before it says anything else.

**And two things in this code are still ours.** They are named rather than hidden:

- the pre-registration is read from `measurements/p1/` of the workspace this runner finds by its
  marker (`pnpm-workspace.yaml`), so a stranger's own freeze has to live at that path. It is not a
  parameter, and the reason is in `lib/selftest.mjs`: *"a caller free to point the freeze somewhere
  else is a caller free to move it"*;
- the arms that measure a product measure **this** product — `mnema init`, its MCP server, its
  plugin declarations. The three that do not (`base`, `prosa`, `host`), and the shape all six
  share, are the transferable part.

## What it is, in one page

A **cell** is one (task, arm, run). The harness makes a sandbox outside the working tree, plants
the task's starting repository in it, seeds one arm, spawns the agent CLI, scores what the agent
left behind with the task's own discriminant, appends one JSON line to the round's capture, and
destroys the sandbox.

```
node run.mjs --selftest              refuse or clear the run. Every round. No model is called.
node run.mjs --pilot --yes           the split's pilot task x the round's arms x 1
node run.mjs --full --yes            the round's tasks x the round's arms x --runs
node run.mjs --cell a1-rounding mnema 1 --yes
node run.mjs --full --round 3 --yes
node --test "tests/*.test.mjs"       the instrument's own suite
node mutate.mjs                      41 mutations against that suite. None may come back green
```

Six arms exist in code (`ARMS` in `lib/seed.mjs`); a **round** declares which of them it runs, and
the harness refuses a round that declares an arm it cannot seed — by name, saying which
(`refuseUnrunnableRound`, asserted both ways in `tests/rounds.test.mjs`).

## Where the tasks come from

**From outside, in `MNEMA_BENCH_TASKS`, and the runner refuses when nobody says.**

```
$MNEMA_BENCH_TASKS/
  fixtures/            round 1's tasks
  selftest.sh          the calibrator
  round-2/fixtures/    round 2's tasks
  round-2/selftest.sh  a SYMLINK to the one above — one calibrator, never a copy
  round-3/…
```

This used to be one `..` out of this directory, which was true while the runner lived *inside* the
task tree and false the moment it was published away from it. It is not fixed by a deeper count:
where the tasks are is a fact about whoever runs the protocol, and ours are on a local workbench
git ignores. `tasksRoot` in `lib/root.mjs` throws instead of guessing, and the preflight's **first**
check is `tasks found` — first because every path after it is built from that answer, and a wrong
one is reported by the later checks as a broken calibrator, a broken split and a missing task,
which are three diagnoses of a defect that is none of them. `tests/root.test.mjs` and
`tests/selftest-refuses.test.mjs` hold both halves.

## What a task has to be

```
<id>/
  repo/          the starting point. What the agent sees. It passes its own tests and does
                 NOT state the rule
  ticket.txt     the frozen prompt. It contains no word of the rule
  decision.md    the decision. It goes to the seeded arms and never to `base`
  refs/good/     the implementation that RESPECTS the decision   -> CONFORMS, exit 0
  refs/bad/      the lazy-but-plausible one that VIOLATES it     -> VIOLATES, exit 1
  verify.<ext>   the discriminant: it runs the produced code and prints one of three verdicts
```

- **The id decides the axis**: `a…` carries a decision the code does not reveal, `b…` is a negative
  control that carries none and that every arm has to **tie** on. Anything else is refused rather
  than scored on a guess (`carriesDecision`, `lib/fixtures.mjs` — one reading of what the axes mean,
  after a delivery in which it had five and a hole).
- **`verify.<ext>`** may be `.php`, `.py`, `.js` or `.rb`, and it must print `CONFORMS`, `VIOLATES`
  or `BROKEN` as its first word with exit 0, 1 or 2. The word is read and not just the code: a
  runtime that fails to load the verifier also exits 1, which would read as `VIOLATES`. Anything
  else is `RULER BROKEN` — the instrument saying it broke instead of returning a number.
- **The starting `repo/` must come back `BROKEN`.** A task whose starting point already conforms is
  a task that measures nothing, and `selftest.sh` requires all three references to land where they
  claim before the task may enter the protocol.

## What a cell holds fixed, and where

The protocol's own §*"What a cell holds fixed"* is the promise; this is the implementation, and
**something outside both holds them together.**
`packages/code/tests/the-ruler-runs-in-another-hand.test.ts` reads the flags the protocol names,
runs the argument vector this code builds, and goes red when they disagree in either direction —
so a flag dropped from the code while the document still asserts it is a failing test rather than a
paragraph nobody re-read.

| item | where |
|---|---|
| `--setting-sources project,local` | `claudeArgv` — the machine's own settings and plugins do not load |
| `--strict-mcp-config` | `claudeArgv` — no MCP server outside the per-cell file |
| `--model claude-haiku-4-5-20251001` | `MODEL`, and written into every result line |
| `--append-system-prompt` | `APPEND_SYSTEM_PROMPT` — identical in every arm; it says how to work, never what to consult |
| `--permission-mode bypassPermissions` | one mode for every arm; denials ride in the line |
| `--no-session-persistence` | no transcript survives the cell |
| an auto-memory directory per cell | `writeCellConfig` — the same key in every arm, a path inside the cell; seeded in `host`, born empty in the others |
| `HOME` / `XDG_DATA_HOME` / `TMPDIR` | inside the sandbox. The environment is an **allowlist**, never a denylist, because an allowlist is not defeated by a variable that does not exist yet (`sandboxEnv`, `lib/sandbox.mjs`) |
| `TZ=UTC` | pinned — one task's discriminant *is* a timezone |
| a fresh copy of the task, `git init`, a clean tree | `plantRepo` + `assertCleanTree`, before the agent runs |
| a fresh record and a fresh identity | per cell. This product **writes while it serves**, so two cells sharing a record are not independent observations |

**The command line is identical in every arm.** `claudeArgv` returns the same bytes for all of
them, and `tests/four-arms.test.mjs` compares four of them against a golden frozen before the
fifth arm existed. What differs is the *content* of the cell's MCP configuration and, in the arms
that carry the product's unasked surface, one further key in the cell's settings — the same key
with the same bytes in both of them. That is not tidiness: a published benchmark elsewhere was
nearly invalidated because its baseline ran the treatment in secret through a global hook, and
this is the shape of that correction.

## What it refuses

**Thirteen checks, all of them before the first model call.** A refusal costs nothing; a run that
discovers the same thing halfway through has spent the budget to learn it. In order:

`tasks found` · `toolchain` · `every pre-registered round is runnable` · `fixtures calibrated` ·
`fixtures readable` · `knowledge parity` · `seeding` · `sandbox isolation` ·
`mnema answers over MCP` · `the surface arms' context arrives` ·
`the surface arms' rules reach the writing, or correctly do not` · `split frozen` · `auth`

Three of them are worth naming for what they cost to learn:

- **`knowledge parity`** — the seeded arms are compared after removing exactly their packaging.
  If one arm carried a paragraph another did not, a difference in the result would be a difference
  in what was *said* to the arms, and no number of repetitions would separate the two.
- **`seeding`** — every (task, arm) pair is seeded and then *proved*, including the **absences**
  that define the floor. A `base` arm that finds a decision file in the task's own repository is
  not a floor.
- **`split frozen`** — the tasks on disk are checked against the committed pre-registration:
  each on exactly one side of that round's development/held-out split, the pilot on the
  development side, no negative control there, each at the digest the freeze fixed, and **no task
  in the split of two rounds at once** — which is the one contamination a per-round check is blind
  to by construction, because each round keeps its tasks in its own directory.

`tests/selftest-refuses.test.mjs` breaks a writable copy of a bench seven ways and requires both
the refusal and the **name** of the check that refused. The names are asserted in order, not
counted: a count would still be thirteen if two of them swapped places.

**And the instrument is expected to say when it broke.** `RULER BROKEN` is a verdict of the
calibrator, `status: harness_error` is a field of every result line, and `mutate.mjs` reports
`RULER BROKEN` rather than zero when it cannot find the suite's own summary. This bench has twice
had a mutation matrix that was born vacuous — the runner died before running a test and the parser
read *"0 failures"* — and both times it was caught only because a mutation that **had** to go red
came back zero. An instrument that cannot say it broke is worse than no instrument.

**`mutate.mjs` is published with the runner, and it is not our deliveries' battery.** Every one of
its 41 mutations targets a file of THIS runner — `lib/seed.mjs`, `lib/selftest.mjs`, `lib/root.mjs`,
`run.mjs` and nine others, each resolved from its own directory — and it runs this directory's own
suite. It is the instrument proving that its own guards can go red, which is the only evidence that
the suite above is worth its green. Nothing in it touches `packages/`.

## What it does not promise

- **It is not a standard.** It is one project's method, published so the numbers beside it can be
  argued with.
- **It does not reproduce our rounds** — see the limit at the top.
- **No LLM judge is used.** The headline is a deterministic gate that runs the produced code. If
  some axis ever needs a judge, the conditions are fixed in advance in the protocol's §*"The
  scorer"*: a fixed model, temperature 0, a published rubric, mandatory citation of the construct
  being judged, and calibration against a good and a bad reference before any paid call.
- **It does not measure whether the model READ what arrived.** Five columns say a mechanism *ran*
  — the record was asked, the handler produced a document, the channel spoke — and none of them
  says it was read, believed or obeyed. Asking is not using, and producing is not reading. This is
  written in `lib/mechanism.mjs` beside each column, with what each one does not answer.
- **It measures conformance to the record, not better work.** A record holding a *wrong* decision
  produces high conformance and worse work, and this experiment does not tell the two apart.

## Dependencies

**None outside `node:`.** 10,089 lines of `.mjs` in 33 files, no `package.json`, no lockfile, no
build step —
node and the runtimes a discriminant needs (`php`, `python3`, `node`, `ruby`, plus `git` and
`bash`), which the `toolchain` check names on the way out if one is missing. That is what makes it
runnable in another hand, so it is a guard and not a habit:
`packages/code/tests/the-ruler-runs-in-another-hand.test.ts` reads every import specifier in this
directory and fails on anything that is neither `node:*` nor a relative path.

## Where the rest of it is

The engineering log of this instrument — every premise it fell for, what falsified it, the arms
that were withdrawn, the alternatives that were refused and why — is on the workbench that built
it, in Portuguese, and it is not published: it is a private notebook, and a notebook maintained
against nothing is a document that lies slowly. What is published is this file, the code beside
it, and its own suite.
