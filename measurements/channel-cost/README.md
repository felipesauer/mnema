# channel cost

**What a governance hook would cost before one exists.** Three numbers the surface needs
in front of it, and a fourth that says how often each of them would be paid.

Nothing here was built. No hook was added, no tool, no verb; `packages/` was not touched
and no model was called. This directory holds the **captures** and the reading of them;
the probes that produced them live on the local workbench, the same arrangement
[`p1/`](../p1/) keeps with its harness.

The measurement is dated `results/2026-08-19/`, and every capture carries its own
`stamp`: the commit that produced it, the node version, the machine and its load. Read
the number beside the build it came from, never beside this prose.

## Why the floor and the work are two numbers

The work an injection hook will do — find the rules that govern a path — **does not
exist**. Timing "the hook" today would time a guess, and the figure would expire the day
the guess changed. So what was measured is the decomposition:

- **the floor of each channel** — what it costs to reach the product at all, and
- **the cost of a read that already exists**, beside it.

Added, they predict. Measured together, they would only have described today's design.

That the floor belongs to the **channel** and not to the read is not asserted: two
different reads were run through both channels, and the floor came out the same while the
work term moved by 4×.

| | `search` | `read_record` |
|---|---|---|
| the read itself, in process | 0.59 ms | 0.15 ms |
| the `command` floor left over | **170.9 ms** | **167.7 ms** |
| the warm `mcp_tool` floor left over | **0.65 ms** | **0.54 ms** |

## 1 · What each channel costs per firing

| | p50 | what it is |
|---|---|---|
| `node -e ''` | 20.5 ms | the runtime, beneath everything |
| `mnema --version` | 143 ms | the same runtime **plus this CLI's module graph** |
| `mnema search <term> --json`, spawn to exit | **171.5 ms** | one `type: "command"` firing |
| MCP connect + handshake + first call | **292 ms** | paid **once**, when the session opens |
| MCP call on a connection already open | **1.24 ms** | one `type: "mcp_tool"` firing |

**138×** between the two per-firing numbers on `search`, **241×** on `read_record` — and
the ratio differs between them only because it still carries the work. On the floors
alone it is **263×** and **310×** — the same channel, measured through two reads.

Two things the decomposition says that the totals hide. Of the `command` floor, only
20.5 ms is node: **123 ms is this CLI's own module graph**, paid in full on every firing,
including by `--version`, which reads nothing. And the 292 ms connect is not a per-firing
cost at all — it is one handshake per session, which the plugin's server declaration
already pays for.

## 2 · Closing a run against the `SessionEnd` budget

The host gives every `SessionEnd` hook a **shared 1.5 s**. `mnema run end` — process,
append, signature, checkpoint:

| record | bare | behind a wrapper that spawns it | worst seen | of the shared budget |
|---|---|---|---|---|
| empty | 157 ms | 183 ms | 192 ms | 12.8% |
| realistic (16 in force, 25 patterns, 30 tasks) | 162 ms | 187 ms | 197 ms | 13.1% |
| large (101 in force) | 168 ms | 197 ms | 207 ms | 13.8% |

**It fits, with room for about six more hooks of the same weight**, and the slack shrinks
slowly: going from an empty record to 101 decisions in force moved the close by 11 ms. The wrapper column is the honest one —
the plugin's one existing handler spawns the binary rather than being it, so a real
`SessionEnd` would pay two process starts.

## 3 · How big is what an injection pushes

**In bytes.** There is no tokenizer on this machine and this slice called no model, so no
token count is published. `chars` is reported instead as a **ceiling**: a byte-pair
vocabulary contains every single character, so it can never emit more tokens than there
are characters. That is a bound, not an estimate — a token figure divided out of bytes by
a rule of three is exactly the number this directory refuses.

| | bytes | chars (token ceiling) | lines |
|---|---|---|---|
| opening document, empty project | 1,149 | 1,137 | 25 |
| opening document, realistic | 4,145 | 4,061 | 68 |
| opening document, large (101 in force) | 12,566 | 12,227 | 153 |
| one decision served whole, envelope only | ~359 | — | — |
| one decision served whole, median body | 3,783 | 3,783 | — |

**99.1 bytes per rule in force** is the slope of the opening document. Serving one record
costs a **359-byte envelope plus whatever that record's rationale holds** — the 3,783
figure is the envelope plus a 3,427-character body, which is the measured median.

**Where that leaves us against what the market publishes.** The Agent Skills spec
declares ~100 tokens of metadata and under 5,000 of body per skill; the host shows a
plugin's projected per-session token cost before you install it. Our figures are bytes
and theirs are tokens, so they do **not** compare directly, and the honest statement is
the bound: the realistic opening document is at most 4,061 tokens, and one served record
at most 3,783 — each of them under one skill body's declared ceiling. Until a tokenizer
is in the loop, that is the whole of what can be said.

## 4 · How often each point would fire

Counted off this machine's Claude Code transcripts — the same store `mnema usage` reads,
under a stricter limit: line type, tool name, two booleans. **No content of any message
was read, and a guard walks the output before it is printed and refuses any string the
probe did not author.**

**The measured P1 round cannot answer this and was not used.** Its tasks are single-file
by design, so `files_changed` has a median of 1 over 112 cells; a multiplier taken from
there would be a floor that does not generalise, published as though it did.

Over **149 sessions in 640 transcripts**:

| hook point | p50 | p90 | p99 | max | sessions with none |
|---|---|---|---|---|---|
| `PreToolUse` on `Write\|Edit\|NotebookEdit` | 34 | 121 | 1,494 | **3,424** | 15 |
| `PreToolUse` on every tool | 144 | 741 | 9,789 | **15,684** | 3 |
| `UserPromptSubmit` | 1 | 24 | 541 | 574 | 0 |
| `PreCompact` / `PostCompact` | 0 | 0 | 11 | 18 | 136 |
| `SubagentStart` / `SubagentStop` | 0 | 2 | 25 | 87 | 120 |

**The distribution is published rather than the median because the tail is the case that
decides.** A session that edits 3,424 files is 100× the median one, and it is the session
a per-edit hook has to survive.

### What the two multiply to

| hook point | `command` p50 | `command` p90 | `command` max | `mcp_tool` p50 | `mcp_tool` p90 | `mcp_tool` max |
|---|---|---|---|---|---|---|
| `PreToolUse` on edits | 5.8 s | 20.8 s | **9 min 47 s** | 0.04 s | 0.15 s | 4.3 s |
| `PreToolUse` on every tool | 24.7 s | 2 min 7 s | **44 min 50 s** | 0.18 s | 0.92 s | 19.5 s |
| `UserPromptSubmit` | 0.17 s | 4.1 s | 1 min 38 s | 0.00 s | 0.03 s | 0.71 s |
| `SubagentStart` | 0 s | 0.34 s | 14.9 s | 0 s | 0 s | 0.11 s |

## The sample is biased, and here is which way

These are the sessions of **one machine doing one kind of work** — this project's own
reconstruction. It is not a population, and two directions of bias are known:

- **Edits are over-represented per session.** This is a codebase under continuous
  refactor; a session that reads and answers would edit far less. Restricted to the
  transcripts whose recorded `cwd` is **this project** (104 sessions, 397 files), edits
  come out at p50 **35** against 34 store-wide — so on this axis the two agree.
- **Prompts are under-represented.** Store-wide p50 is 1 and p90 is 24; within this
  project p90 is 3. Long autonomous runs answer one prompt and work for hours, which
  drags the per-session prompt count toward 1 and would **understate** a
  `UserPromptSubmit` hook for an interactive user.

## Which of these numbers expire, and what invalidates each

| number | expires when |
|---|---|
| `mnema --version` = 143 ms | the CLI's module graph changes. It is 123 ms of import over a 20.5 ms runtime, and one eager import in the wiring moves it |
| the 292 ms MCP connect | the server's start-up work changes, or the host changes when it connects a declared server |
| the 1.5 s `SessionEnd` budget | **the host changes it.** It is the host's number, not ours; nothing here would notice |
| the multipliers | the work changes. They are a snapshot of one machine in Aug 2026 |
| the opening document's 99.1 B/rule | the document's shape changes. It already moved: an earlier reading measured 21 / 63 / 148 lines where this one measures 25 / 68 / 153 |
| **nothing here** | depends on how a rule is bound to a path. That is deliberate — it is the next slice, and no number was allowed to assume its shape |

## What is here

| | |
|---|---|
| [`results/2026-08-19/channel-floor.json`](results/2026-08-19/channel-floor.json) | §1 — both channels, both reads, order alternated |
| [`results/2026-08-19/session-end-budget.json`](results/2026-08-19/session-end-budget.json) | §2 — the close at three record sizes |
| [`results/2026-08-19/injection-size.json`](results/2026-08-19/injection-size.json) | §3 — bytes, and the char ceiling |
| [`results/2026-08-19/host-multiplier-all.json`](results/2026-08-19/host-multiplier-all.json) | §4 — the whole store |
| [`results/2026-08-19/host-multiplier-this-project.json`](results/2026-08-19/host-multiplier-this-project.json) | §4 — restricted to this project, for the bias check |
| [`results/2026-08-19/composed.json`](results/2026-08-19/composed.json) | floor × multiplier, computed in one place rather than in prose |
| [`results/2026-08-19/selftest.txt`](results/2026-08-19/selftest.txt) | **14 injected faults, 14 `RULER BROKEN`; 4 clean runs, 4 quiet.** A probe that cannot say it broke is worse than no probe, and this bench has published a vacuous matrix twice |
