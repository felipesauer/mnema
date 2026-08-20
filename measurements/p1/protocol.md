# P1 — does the record change the work?

**Pre-registered, and measured once.** This file says what is measured and under what
conditions; [`reading.md`](reading.md) says how each possible outcome of the FIRST round is to
be read; [`split.json`](split.json) says which of that round's tasks were free to iterate on and
which were touched once; [`fixtures.sha256`](fixtures.sha256) fixes those tasks themselves. Further
rounds, each with its own tasks and its own reading, are pre-registered in
[`round-2/`](round-2/) and [`round-3/`](round-3/) — see
[what a further round is](#further-rounds-of-the-same-promise) below.

*(The line that stood here said **"No number from this protocol exists yet."** It was true when
it was written, on 13 Aug 2026, and the first round falsified it on the 18th: the pilot's four
cells, then 112 more, are committed under [`results/`](results/) with a reading that says the
first promise did not survive as written. The premise is rewritten rather than deleted, because
what this file claimed before the number is part of why the number can be believed.)*

## The promise being measured

The product's first promise used to be *"an agent works better with mnema than without"*.
That sentence has no unit, and therefore no scorer: a run of it in an earlier round produced
the honest conclusion that the control *"reasoned as well or better"*, which the experiment had
no way to contradict, because no criterion of correctness had been defined in advance.

What is measured here is narrower, and it has a scorer that runs on the machine of whoever
doubts it:

> **When a recorded decision exists that the code does not reveal, the agent WITH the record
> respects it and the agent WITHOUT the record violates it — at a rate this experiment
> measures, with a test that executes the code that was produced.**

**The limit, declared up front:** this measures **conformance to the record**, not better
work. A record holding a *wrong* decision produces high conformance and worse work, and the
experiment does not tell the two apart. That is correct and intended: the product never
promised the decision is right; it promised the decision is known, attributed and provable.

**And a metric this protocol refuses.** "The agent consulted the record" is an input, not a
result — a product that forces the consultation would score 100% and prove nothing. The
scorer never looks at whether the record was read. It looks at what the produced code does.

## The four arms

| arm | what it holds | what it isolates |
|---|---|---|
| `base` | no record, no memory, no decision file | the floor |
| `prosa` | the same decision, verbatim, in a `DECISIONS.md` committed at the repository root | **the knowledge without the product.** If this arm ties with `mnema`, the value is the proof and not the retrieval, and the promise is the wrong one |
| `host` | the same decision in the coding agent's own automatic memory, seeded before the cell | **the alternative that is already installed** |
| `mnema` | the record with the decision written and accepted, MCP on | the product |

`prosa` is the important one and the uncomfortable one. Comparing a product against *nothing*
conflates the product with the knowledge it happens to carry; the honest delta is against the
cheapest thing that carries the same knowledge.

**The mechanism stays on in all four arms; only the content changes.** Every arm gets a fresh
per-cell automatic-memory directory, and the `mnema` arm founds its record on the negative
control too — empty. Without that, *"the record changed the work"* and *"the tool was
installed"* would be the same variable.

**The three seeded arms carry the same knowledge, and this is asserted rather than assumed.**
The three shapes are compared after removing exactly their packaging (frontmatter, the title
marker, the labels, whitespace). If one arm carried a paragraph another did not, a difference
in the result would be a difference in what was said to the arms, and no number of repetitions
would separate the two.

## The tasks: two axes

**Axis A — a decision the code does not reveal.** The repository satisfies its tests and does
not state the rule; the rule exists only in the record (or the file, or the host memory,
according to the arm). The ticket asks for an extension whose natural implementation
**violates** the rule. Both implementations are defensible and they agree on the common case —
that is what makes the decision unrecoverable from the code.

**Axis B — negative control.** An ordinary ticket, no relevant recorded decision. **The four
arms have to tie.** An arm that scores higher here is not better; the run is contaminated, and
no number from it counts.

| axis | tasks |
|---|---|
| A | `a1-rounding` · `a2-due-day` · `a3-idempotency` · `a4-collation` · `a5-no-retry` · `a6-partner-code` |
| B | `b1-csv-quotes` · `b2-moving-average` |

Each task carries a starting repository, a frozen ticket that contains no word of the rule, the
decision text, a conforming reference, a violating reference, and its own discriminant. The
tasks are withheld until they have been used; what is committed now is
[their hashes](fixtures.sha256).

## The scorer

1. **A deterministic gate, and it is the headline number.** One vector per axis-A task, which
   runs the produced code and returns `CONFORMS` or `VIOLATES`. No judge, no model, no opinion.
   **The headline is that rate over the four held-out axis-A tasks** — the set is `headline` in
   [`split.json`](split.json), and what counts as a difference between two arms is fixed in
   [`reading.md`](reading.md), before the first cell runs.
2. **A correctness gate.** The produced code has to work on the happy path, or conformance
   means nothing — a function that does not run violates nothing. This gate belongs to axis A
   and only to it: on axis B there is no second reading, so code that runs and gets the answer
   wrong is simply wrong.
3. **No LLM judge is used.** If some axis ever needs one, it arrives with a fixed model,
   temperature 0, a published rubric, mandatory citation of the construct being judged, and its
   own calibration against a good and a bad reference before any paid call.
4. **Cost, duration and turns** are copied from the vendor's own result message. A field that
   did not arrive is written `null` and named in `missing_result_fields`. Nothing is estimated.

## What a cell holds fixed


**Every future round captures the tool sequence.** `--output-format stream-json` instead of `json`,
so the transcript says which doors an agent went through and in what order. The first three rounds
did not, and the question they could not answer — *which door does the agent enter by* — was only
half closed later, by a wrapper that sees calls to this product's own server and nothing else.
Measuring the result without the path leaves the design of the door unmeasured. This is a rule for
rounds that happen, not a reason to run one.

Every cell is a fresh sandbox outside the working tree, with its own `HOME`, its own record and
its own identity.

- `--setting-sources project,local` — the machine's user settings and plugins do not load
- `--strict-mcp-config` — no MCP server outside the per-cell file
- `--model claude-haiku-4-5-20251001` — fixed, and written into every result line
- an automatic-memory directory **inside the cell**, identical in all four arms; in `host` it is
  seeded, in the other three it is born empty — so the *mechanism* is on in all four and the
  *content* is the only difference
- an appended system prompt identical in all four arms: it says how to work, never what to consult
- one permission mode for every arm, with denials recorded in the line
- no session persistence — no transcript survives the cell
- `HOME`, `XDG_DATA_HOME` and `TMPDIR` inside the sandbox; the environment is an **allowlist**,
  never a denylist, because an allowlist is not defeated by a variable that does not exist yet
- `TZ=UTC` pinned — one task's discriminant *is* a timezone
- a fresh copy of the task per cell, `git init`, one commit, and a clean tree asserted before
  the agent runs
- **a fresh record and a fresh identity per cell.** This tool *writes while it serves*, so a
  decision recorded by cell *k* would be readable by cell *k+1*: two cells that share a record
  are not independent

The command line is **identical in all four arms**. The only thing that differs is the content
of the per-cell MCP configuration. That is not elegance — a published benchmark elsewhere was
nearly invalidated because its baseline was running the treatment in secret through a global
hook, and this is the shape of the correction.

## Size

**n=4 per (task, arm).** Below that, effect is not distinguishable from variation of the model;
above it, cost grows linearly and the gain is marginal for a product decision.

8 tasks × 4 arms × 4 runs = **128 cells**.

**Cost is not estimated here.** A pilot of one task × 4 arms × 1 run measures it on this
machine, and the sizing becomes arithmetic afterwards. The pilot runs the task named by
`pilot` in [`split.json`](split.json), which is a development task by rule — a pilot over a
held-out task would touch it twice.

## The discipline

- **Development / held-out split, frozen before the number.** Development tasks are free to
  iterate the harness and the vectors against; held-out tasks are **touched once**, and any
  iteration after seeing a held-out result contaminates them. Both axis-B tasks are held out by
  rule: they are the contamination detector, and iterating on them after seeing a result is the
  power to soften the very signal that would invalidate the run.
- **A result per cell, committed**, with the caveat in the line.
- **Captures coexist**, one file per date, nothing overwritten.
- **A preflight before any spending.** For every axis-A task the conforming reference must pass
  and the violating one must be caught. If the preflight does not go red on the bad reference,
  the vector does not discriminate and the task does not enter the protocol. The preflight also
  refuses a run whose split does not cover the tasks on disk, or whose hashes do not match this
  directory.

## Further rounds of the same promise

**The promise above does not change, and the tasks do.** The first round's four held-out axis-A
tasks are spent — the rule in [`split.json`](split.json) says a held-out task is touched once —
and its two development tasks were iterated against, so both classes are contaminated for a new
measurement. A second round therefore needs its own tasks, and they were frozen **before** the
product surface that round would measure was built: choosing a task after seeing what a
mechanism does is the bias a pre-registered split exists to prevent.

That second pre-registration lives in [`round-2/`](round-2/) and is complete on its own terms:
ten tasks fixed by [digest](round-2/fixtures.sha256), the
[split and the headline set](round-2/split.json), [five arms declared](round-2/arms.md) — the
four that ran the first round, plus `mnema+`, the record served unasked and charged for — and
[the reading of every outcome](round-2/reading.md), which closes the three gaps the first round
found in its own rule. Nothing of the first round's pre-registration is edited to make room for
it: those files are the record of an order, and the order is what they are worth.

*(Until 19 Aug 2026 the sentence above said the fifth arm "does not exist in code yet", and that
was the point of freezing the round before it. It exists now — the harness seeds all five, and
the mismatch that stopped round 2 lifted on its own, because what stopped it was a comparison
between the arms the round declares and the arms the harness can seed, never a switch. The
premise is rewritten rather than removed: the tasks are the ones that were frozen before the
surface, which is the only thing that had to be true.)*

**And a third round, for the same reason and with one honest difference.** Round 2 ran on 20 Aug
2026 and answered two things at once: the product's charged surface beats our own uncharged arm by
**73.6 points**, and it is **`≈`** with the memory the coding agent already ships. The whole of
that second gap is **one task** — `a14-tie-break`, where the charged arm scored 0.50 and the host's
memory 1.00 — and there is a measured hypothesis about why: a capture of 19 Aug in
[`../mcp-tool-channel/`](../mcp-tool-channel/) shows that the text this product pushes lands
**after** the tool result of the edit that triggered it, so on a task settled by the first write it
arrives late. Round 3 measures the answer to that, and its pre-registration is in
[`round-3/`](round-3/): ten more new tasks fixed by
[digest](round-3/fixtures.sha256), a [split](round-3/split.json) whose development pair is chosen
by a criterion the file states, [five arms](round-3/arms.md) — the four that ran round 2 minus
`mnema`, which has now answered `≈ base` twice, plus `mnema++`, the rule put in front of the model
before its first write — [the reading of every outcome](round-3/reading.md), which closes the two
gaps round 2's own capture found, and [a prediction](round-3/prediction.md).

**The honest difference is stated in the pre-registration rather than here.** Round 2's tasks were
frozen by somebody who could not know what the mechanism would do, because it did not exist. Round
3's were written by somebody who knew round 2's result and had already formed the hypothesis above.
No digest fixes that; what was done about it, and why the answer is to PREDICT rather than to
select, is in [`round-3/prediction.md`](round-3/prediction.md) and in the header of
[`round-3/fixtures.sha256`](round-3/fixtures.sha256).

## Status

| step | state |
|---|---|
| tasks calibrated | done, **all three rounds** — each of the twenty-eight tasks catches its bad reference and passes its good one, checked by one calibrator that each round's directory symlinks. *(This row said "both rounds" while there were two.)* |
| harness | built; every isolation item above is a flag or a file |
| pre-registration, round 1 | **this directory** |
| pilot | run 17 Aug 2026 — 4 cells, [`results/2026-08-17-pilot/`](results/2026-08-17-pilot/) |
| full run, round 1 | run 18 Aug 2026 — 112 cells, [`results/2026-08-18-full/`](results/2026-08-18-full/) |
| pre-registration, round 2 | [`round-2/`](round-2/) — frozen 18 Aug 2026, **before** the surface it measures |
| fifth arm, in code | built 19 Aug 2026 — the harness seeds all five, and the refusal keyed on the round's declared arms lifted by itself |
| pre-registration, round 3 | [`round-3/`](round-3/) — frozen 20 Aug 2026, **before** the mechanism it measures. Ten new tasks, five arms (`mnema` out, `mnema++` in), a reading, and a prediction |
| fifth arm of round 3, in code | not built. `--round 3` is refused by the harness at the argument, and the round's declared arms do not match the arms it can seed — the same refusal that stopped round 2 and lifted by itself |
| full run, round 3 | not run. No cell of it exists, and no verb of the harness can reach its tasks |
| full run, round 2 | run 20 Aug 2026 — **208 cells** (200 planned + the 8 re-runs the frozen reading rule requires), [`results/2026-08-20-full/`](results/2026-08-20-full/). *(This row read **"not run. The harness plans its 200 cells and stops"**, and it was true while the size of the round was an open spending decision. What falsified it is that the decision was taken at `n = 4` and the round ran.)* |
