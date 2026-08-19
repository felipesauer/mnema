# asks a person

**Can this product make the host stop and ask a PERSON, under what spelling, and what does
deciding to cost?** The grade of force that hands a decision back to a human had never been
run by anybody here: the plan for it named a mechanism, and the mechanism did not exist.

Three questions, in this order, because the second and third are worth nothing if the first
answers no:

1. does a hook of `type: "mcp_tool"` on `PreToolUse` reach the host's permission system —
   and by what name?
2. what does the decision cost on a path that fires before every file is written, and what
   does the path that does **not** charge cost?
3. how often would a gate actually fire — is this usable governance or friction wearing its
   clothes?

The probes live on the local workbench, the arrangement [`p1/`](../p1/),
[`channel-cost/`](../channel-cost/) and [`switch-cost/`](../switch-cost/) already keep. This
directory holds the captures, each stamped with the commit, the host version, the node, the
machine and its load. **Read every number beside the build and the LOAD it came from, never
beside this prose.**

## 1 · The plan named a mechanism this host does not have

The plan for this channel wrote the grade as `permissionDecision: "escalate"`, in the
foundation document and in the study, throughout. The binary's own schema lists **`allow`,
`deny`, `ask`** — and `defer` under the event's own key. **The grade is `ask`.**

Getting it wrong is not an error, and that is the finding rather than the spelling:

> `Hook JSON output validation failed — (root): Invalid input`

The host records that as `hook_non_blocking_error` **in the transcript**, discards **the whole
reply** — the `additionalContext` of the grade that already worked goes with it — lets the
edit through, and exits zero. A delivery written against the plan would have looked installed,
charged nothing, and silently stopped injecting the thing it already injected.

`defer` exists and does not serve: it is print-mode only, and the host says so in its own
words when a session is interactive.

## 2 · No model was called, and the host is real

Only the HOST enforces a permission decision, and a permission decision happens on a tool call
that only a model emits. So the model was replaced and nothing else was:

- the real `claude` binary, 2.1.228, the one installed on this machine;
- a real stdio MCP server whose reply is the case under test, logging every call it received;
- a **stand-in for the model API** on `127.0.0.1`, which answers with a canned `tool_use` for
  `Write` and captures every request the host makes.

**The observable is the file on disk plus the request the host sends next.** `Write` is
pre-approved in the run's settings, so an edit that does **not** happen is a decision that
reached the permission system; and the tool result in the next request is what the model read.

*(The server is declared through `--mcp-config` and the hook through `--settings`, so it
carries the SIMPLE name. The `plugin:<plugin>:<server>` rule for a server a PLUGIN declares is
[`mcp-tool-channel/`](../mcp-tool-channel/)'s finding and is not re-proved here — that would
only add a way for this probe to fail for a reason that is not its question.)*

**The instrument was wrong twice before it was right, and both were the same mistake.** The
canned turn was keyed off *how many* requests had arrived. The host asks `/api/hello` first,
and its first `/v1/messages` is a preflight carrying **no tools at all** — so the edit was
answered into a request that could not accept it, no tool call happened, and the control case
failed for a reason that looked like the subject. It is keyed off what a request **carries**
now (does it offer `Write`, does it already hold a result). A count is not a predicate.

## 3 · Eight cases against the real host

[`results/2026-08-19/the-door-exists.json`](results/2026-08-19/the-door-exists.json) holds all
of them with the host's own words. Read as a table:

| the reply | edit happened | what the model read |
|---|---|---|
| `additionalContext` only — the grade already shipped | **yes** | the context, as a message after the tool result |
| `permissionDecision: "ask"` + reason | **no** | the reason, **verbatim**, as the tool result, `is_error: true` |
| `permissionDecision: "escalate"` + reason | **yes** | nothing — the whole reply failed the schema |
| `ask` **and** `additionalContext` together | **no** | both: the reason as the error, the context as its own message |
| `{}` | **yes** | nothing, and no diagnostic |
| `ask`, session `--permission-mode acceptEdits` | **no** | the reason |
| `ask`, session `--permission-mode bypassPermissions` | **no** | the reason |
| `permissionDecision: "deny"` + reason | **no** | the reason |

Four things this says, and three of them changed the design.

**THE REASON IS THE TEXT A MODEL READS.** `permissionDecisionReason` comes back as the tool
result of the refused call, byte for byte, marked as an error. It is not a diagnostic for a
person. So it is pushed text on the same channel class as everything else this product puts in
front of a model, and it is framed: it says what it is before it says anything else.

**ASKING OVERRIDES EVERY PERMISSION MODE**, `bypassPermissions` included. There is no
host-side way around it. That makes the product's own switch the **only** escape from a gate
somebody inherited with a clone — which is why the gate ships with a switch of its own, separate
from the one that stops the rules arriving: a single switch would charge whoever needed the way
out the information as well.

**IN A HEADLESS SESSION, `ask` AND `deny` ARE THE SAME OBSERVABLE.** With nobody to ask, the
host refuses the call and hands the model the reason as an error — the same shape `deny`
produces. So the ordering "grade 3 before grade 4" buys a person at a terminal a choice and
buys an unattended agent nothing. It is still the right order, because the person is who the
tie is about; what does not survive is the claim that escalating is gentler than refusing, said
without saying to whom.

**EVERY FAILURE STAYS NON-BLOCKING**, including the schema failure. The edit went through, the
session continued, and the host exited zero in every one of the eight runs.

## 4 · What the decision costs — and the finding is the WRITE, not the reading

[`results/2026-08-19/ask-cost.json`](results/2026-08-19/ask-cost.json), load 3.87 on 16 cores.
Each term timed on its own over the session's own warm caches, order alternated, three record
regimes. **Every cell is p50, and the two columns are the two orders.**

| record | the gate's switch, alone | the hook, nothing asks | the hook, a rule ASKS | gate off, push on | both off | `read_record` beside it |
|---|---|---|---|---|---|---|
| empty | **0.038–0.045** ms | 0.48–0.52 ms | — | 0.36 ms | **0.20 ms** | 0.30–0.32 ms |
| realistic (16 in force, 25 patterns, 30 tasks, 8 addresses, 2 gates) | **0.041–0.044** ms | 1.34–1.39 ms | **413–420 ms** | 0.87–0.89 ms | **0.19 ms** | 0.14–0.15 ms |
| large (101 in force, 50 addresses, 4 gates) | **0.049–0.062** ms | 5.1–6.8 ms | **1,717–1,749 ms** | 3.3–3.6 ms | **0.17 ms** | 0.16–0.21 ms |

**The second switch is flat, like the first.** 0.04 ms on an empty record and 0.05 ms on one
with 101 decisions in force, because it is an indexed lookup per tree over a warm projection.
The gate's guard is about **1%** of the realistic reading term.

**With both switches off, nothing runs** — 0.17–0.20 ms in every regime, which is the tool's
own floor and *cheaper than `read_record`*. The escape from a gate is not merely available, it
is free.

**The path that does NOT charge is the common one and it is not cheaper in time than the silent
one** (1.34 against 1.39 ms realistic; the two agree inside the spread). The work is the walk,
not the composition — the same finding the first capture made about the informing channel, now
true of two walks instead of one. The reading term roughly **doubled** against
[`mcp-tool-channel/`](../mcp-tool-channel/)'s 0.79–0.83 ms, which is what a second walk of the
graph costs and is the honest price of the gate having its own relation.

### The 400 ms is not the signing. It is the warm cache the write destroys.

A charging figure 300× the reading figure is either the instrument or a defect, and which one
decides what anybody would do about it. So it was split
([`results/2026-08-19/where-the-write-goes.json`](results/2026-08-19/where-the-write-goes.json),
realistic regime, load 3.0):

| | p50 | first | max |
|---|---|---|---|
| the READ, warm, nothing writing between calls | **1.11 ms** | 0.96 | 1,613 |
| **one signed APPEND alone** (`channel.served`: one event, one checkpoint) | **0.64 ms** | 0.60 | 1.80 |
| **an APPEND and then a READ** — the pair the hook actually does | **16.46 ms** | 13.44 | 490 |
| the READ, warm again, afterwards | 1.09 ms | 0.82 | 1,227 |

**Signing costs 0.64 ms.** It is not the term. What costs is that **a write marks the session's
projections stale, so the next read of a channel built on warm caches rebuilds them over the
whole record** — 16.5 ms against 1.1 ms, **15×**, on a record at its declared size.

And that is where the 413 ms comes from, because **the rebuild scales with the record and the
charging grows the record**: the realistic run added **404 KB over 211 firings**, so the p50 is
a p50 over a record several times the one the regime declares. **Charging is self-amplifying** —
each charge appends events, which makes the next rebuild dearer, which makes the next charge
slower.

**So the number to quote for one gate firing on a realistic record is ~13–17 ms, not 413 ms.**
The 413 ms is what charging two hundred times in a row costs, which is a real property of doing
that and is not the per-firing cost of a gate that fires a handful of times in a session.

### What that means joined with §5

| a gate addressed at | firings in a p90 session | at ~17 ms each |
|---|---|---|
| `packages/code/src/mcp` | 5.3 | **0.09 s** — free |
| `packages/code/src` | 53.8 | ~0.9 s, and climbing as the record grows |
| `packages` | 114.9 | ~2 s at the start, **far more by the end** — the self-amplification is what makes this row worse than the arithmetic |

**This is a real defect and this delivery does not fix it.** Naming it is the deliverable; the
lever is visible and is not taken here — the in-force set and the address graph are properties
of the session's warm caches, and nothing narrows what a write invalidates. What holds today is
that a gate deep enough to be worth recording is also cheap enough to be free, and the two
thresholds are the same threshold.

*(The `max` column on the two read rows is 1.2–1.6 s and it is stamped rather than hidden: this
machine ran a full test suite alongside the probe more than once. The p50 and the ratio are
within-run and survive that; a single maximum does not.)*

## 5 · How often a gate would fire — and this is the number that decides usability

[`results/2026-08-19/how-often-it-asks.json`](results/2026-08-19/how-often-it-asks.json).
The timing says what one decision costs; it does not answer the question a person recording a
gate actually has. So: the files changed by the last **200 commits of this repository** — 2,918
file touches over 650 distinct files — against a prefix-by-segments match, which is the
product's own rule.

Per occurrence and not distinct, because the hook fires per **edit**: a file touched in forty
commits is forty moments at which a gate on it would have stopped somebody.

| a gate addressed at | covers | pauses in a p50 session (34 edits) | p90 (121) | the largest seen (3,424) |
|---|---|---|---|---|
| `.` (the whole repository) | 100% | 34 | 121 | 3,424 |
| `packages` | 94.9% | 32.3 | 114.9 | 3,250 |
| `packages/code` | 65.7% | 22.3 | 79.5 | 2,248 |
| `packages/code/src` | 44.5% | 15.1 | 53.8 | 1,523 |
| `packages/code/src/mcp` | **4.4%** | **1.5** | **5.3** | 151 |
| `packages/chain/src/events` | 2.4% | 0.8 | 2.9 | 81 |
| `packages/core/src/content` | 0.7% | 0.2 | 0.8 | 22 |
| `docs` | 0% | 0 | 0 | 0 |

**The cliff is one segment wide, and it is the whole answer.** From `packages/code/src`
(44.5%) to `packages/code/src/mcp` (4.4%) is a **10× drop for one more segment of depth**. A
gate four segments down stops **one or two edits in a median session** — that is governance
somebody can live with. A gate at the repository root, or at `packages/`, stops **essentially
every edit**: 121 pauses in a p90 session, and over three thousand in the largest measured one.

So the honest answer to *"is this usable or is it friction disguised as governance"* is: **it
depends entirely on how deep the address is, and the product gives no warning about that.**
Somebody who records their first gate at `packages/` gets a session that stops on every write,
and nothing in the reading they used to record it tells them so in advance. That is a real gap
this delivery does **not** close, and closing it would take a reading that counts a candidate
address against the working tree's own history — which means asking `git`, which no reading of
this product does today.

**What travels from this table and what does not.** The absolute fractions are this
repository's: a monorepo with a deep `packages/` tree, and one habit of committing. A flat
project would give a completely different number for the same address depth. What travels is
the **shape** — a gate near the root stops nearly everything, a gate three or four segments
down stops a slice, and the fall-off between them is steep.

## Which of these numbers expire, and what invalidates each

| number | expires when |
|---|---|
| every answer in §1 and §3 | **the host changes.** They are facts about `claude` 2.1.228 and about nothing else. The schema's value list is the one to re-check first, because getting it wrong is silent and costs the injection as well as the charge |
| the session-mode rows (`acceptEdits`, `bypassPermissions`) | the host changes how a hook's decision composes with a session's mode. It is the row that most constrains the design, so it is the row to re-run |
| the reading terms in §4 | the reading changes, or the record's shape does. They are two walks of the graph now, so a project's own figure is its own |
| the 0.64 ms append and the 15× rebuild | the write path changes what it invalidates. That ratio is the one to re-measure if anybody narrows it, and it is the number a fix would have to move |
| the 413 ms / 1,717 ms charging figures | **they expire on being read as per-firing costs.** They are p50s over two hundred consecutive charges on a record that grew under the measurement; the per-firing figure is the 13–17 ms pair above |
| the coverage fractions in §5 | **this repository's history does.** They are a snapshot of 200 commits in Aug 2026 over one tree shape; the fall-off survives, the percentages do not |
| the pauses-per-session columns | the edit counts do. They are [`channel-cost/`](../channel-cost/)'s numbers, from one machine in Aug 2026 |

## What is here

| | |
|---|---|
| [`results/2026-08-19/the-door-exists.json`](results/2026-08-19/the-door-exists.json) | §1, §3 — eight cases against the real host, with its own diagnostics and the request it sent next |
| [`results/2026-08-19/ask-cost.json`](results/2026-08-19/ask-cost.json) | §4 — every term at three record sizes, order alternated, with the record growth of the charging path reported |
| [`results/2026-08-19/where-the-write-goes.json`](results/2026-08-19/where-the-write-goes.json) | §4 — the append split from the rebuild it causes, which is what says the cost is not the signing |
| [`results/2026-08-19/how-often-it-asks.json`](results/2026-08-19/how-often-it-asks.json) | §5 — how many edits of a session a gate at each address would stop, on this repository |
