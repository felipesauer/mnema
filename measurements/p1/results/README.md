# P1 results

**The pilot and TWO rounds have run.** `2026-08-17-pilot/` holds four cells — one task, four arms,
one run — `2026-08-18-full/` holds round 1's 112, `2026-08-18-mechanism/` holds eight cells of a
fifth arm that are a mechanism check and not a measurement, and `2026-08-20-full/` holds round 2's
208. What each one is, and why their counts do not add up to each other, is named in
[the index](../../README.md). This directory was committed empty on purpose: the pre-registration
beside it is worth what the order is worth, and the order is visible here.

*(This paragraph has now been wrong twice, in the same way, and the second time is recorded
because the first one's apology did not prevent it. It said **"The pilot has run; the round has
not"** until 18 Aug 2026, when round 1 landed. It then said **"The pilot and the first round have
both run"** and named three directories — and stayed that way after 20 Aug, when round 2 landed a
fourth beside it. Found on 20 Aug by sweeping the committed tree for the AFFIRMATION rather than
for a symbol, while round 3 was being pre-registered: no grep of an identifier reaches a sentence
like this one, which is the whole reason the sweep is written that way. The premise is rewritten
rather than deleted: a folder whose own README contradicts the data inside it is the one thing a
reader cannot check around.)*

A run lands one directory named for its date and mode — `2026-08-14-pilot/`,
`2026-08-20-full/` — holding:

| | |
|---|---|
| `cells.jsonl` | **one line per cell** — two for a re-run cell, below. The result |
| `raw/` | the agent's own output per cell, as it arrived. Evidence, not data |
| `diffs/` | what the agent wrote, per cell, excluding the record itself |

**`raw/` and `diffs/` show the code a cell produced, and code about a task describes the task.**
For a development task that costs nothing — those are open by design. For a **held-out** task it
would reveal, before the reveal, what [`fixtures.sha256`](../fixtures.sha256) deliberately keeps to
a digest. So a run over held-out tasks commits `cells.jsonl` **and the development tasks' raw output
and diffs**, and holds the held-out ones' back until the tasks themselves are published — the same
order, for the same reason.

**The consequence for `2026-08-18-full/`, spelled out because its own report says otherwise.**
That capture's `report.md` closes on *"`cells.jsonl` only"*, which was true of it the day it landed
and stopped being true when the rule above was applied to it: `a3-idempotency` is a development task,
so its 32 raw files and 16 diffs are committed, and the six held-out tasks' are not. The report is a
**capture** and captures are not edited — so the correction lives here and in the index, where a
reader can check it against the directory listing rather than against a promise.

A second run is a second directory. Nothing here is edited after it lands.

**And a re-run cell leaves both of its lines.** [`reading.md`](../reading.md) allows a cell that
came back `harness_error` or `ruler_broken` — the instrument failing, never the agent choosing —
to be run again exactly once. The failed attempt is **not** removed: it stays in the file with
its status, and the reading takes the line whose `status` is `ok`. That is the only case in
which the trio `fixture` · `arm` · `run` appears twice, and the status is what tells them apart.

## The line

One JSON object per cell, one line each, every key written every time — a missing key and a
null key say different things.

**Which cell it was:** `schema` · `fixture` · `axis` · `arm` · `run`. The schema number moves when
the key set moves, so lines from two runs can be joined without guessing which keys a given line
could have carried: `mnema-bench/cell/1` is the pilot, `/2` adds the memory columns below, `/3` the
mnema arm's channel, `/4` the hooked arm's, `/5` the reason a cell came back `BROKEN`, `/6` the
per-edit channel's `channel.served`, and `/7` **which build the cell executed**.
**Lines are never re-run to gain a column** — a result is not redone because a later question got a
better instrument. The absent key is what says a line is from before, and that is the whole job of
the number. The 332 lines committed here are 4 at `/1`, 32 at `/2`, 80 at `/3`, 8 at `/4` and 208
at `/6`; none is at `/5`, none is at `/7`, and none will be.

**What produced it:** `model` · `cli_version` · `mnema_version` · `mnema_build_sha256_16` ·
`mnema_build_files` · `mnema_build_probe` · `permission_mode` · `system_prompt_sha256_16`. The
build and the model are *in the line*, so a result that is contradicted later can be told apart
from a result taken against a different product.

**And the VERSION could not say which build, which is why the digest is there.** From `/7` on,
`mnema_build_sha256_16` is a sha256 over every `.js` file under `packages/*/dist` of the workspace
the cell's own binary comes from, each file hashed with its path — the bytes a node process loads,
not the `.d.ts` and not the source maps. `mnema_build_files` is how many of them there were, so a
digest that moved because a file appeared reads differently from one that moved because a file was
rewritten, and `mnema_build_probe` says what the digest covered or why it is `null`.

It exists because of what nearly happened to the round of 2026-08-20: another process rebuilt
`packages/code/dist` — the artefact every cell executes — during that round's preflight, and the
round had to be moved into a dedicated worktree. A person noticed. Nothing in the data could have:
all 208 of that round's lines carry `mnema_version` `0.0.0`, which is what a `package.json` says,
and it is `0.0.0` on both sides of any rebuild. **A round split in half by somebody else's build
would have measured two products, published one number, and looked exactly like a clean capture.**
Two cells whose digests differ executed different products. The digest is sampled once per cell,
before the cell seeds anything, so it says which build the cell *started* on — a rebuild landing
inside a single cell is not something it can see.

**What the discriminant said:** `verdict` (`CONFORMS` / `VIOLATES` / `BROKEN`) · `exit` ·
`status` · `error` · `ruler_detail` · `broken_detail` · `truncated`.

`broken_detail` is the discriminant's **own sentence** when it refused the code — its first line,
as printed — and `null` on every cell whose code ran. It exists because of one reading this
directory could not support: `a5-no-retry` came back with four `BROKEN` cells in one arm, which is
an arm with no rate at all, and nothing in those four lines could say whether the agents wrote
unworkable code or the task's own happy path was unreachable. The answer was the task, and getting
it meant opening a diff by hand. The sentence had been printed every time and thrown away every
time. It scores nothing.

`status` is the field that separates a result from a defect, and it is the reason the run can
be believed: a missing CLI, a half-applied seed, an authentication failure and a discriminant
that cannot load are **not** an agent choosing anything, and every one of them would land as
`VIOLATES` if cells were scored on exit codes alone. The arm most likely to be scored that way
is the one *without* the record, whose violations are the expected outcome — so the error would
have confirmed the hypothesis. Anything that is not the agent's choice is `harness_error` or
`ruler_broken`, and neither is a result.

**What it cost:** `cost_usd` · `input_tokens` · `output_tokens` ·
`cache_read_input_tokens` · `cache_creation_input_tokens` · `duration_ms` · `duration_api_ms` ·
`num_turns` · `permission_denials` · `result_subtype` · `missing_result_fields`.

Every one of these is copied from the vendor's own result message. **A field that did not
arrive is `null` and is named in `missing_result_fields`** — never estimated. An estimate that
looks like a measurement is the one thing this protocol exists not to produce.

**What the agent wrote:** `files_changed` · `added_lines` · `removed_lines`, from the diff,
with the record excluded — it is the tool's writing, not the agent's code.

**Whether the three mechanisms moved:** `memory_changed` · `memory_writes` · `memory_read` ·
`memory_reads` · `memory_read_probe` · `memory_files_after` · `records_after` · `mcp_asked` ·
`mcp_calls` · `mcp_tools` · `mcp_probe`. None of them scores anything and all of them are free.

The pilot is why seven of them exist and not two. Its `host` cells read `memory_files_after = 2`
and the other three arms read 0 — and the seed writes **exactly two files** into the host's
directory, so all four numbers were the seeded state untouched. A count cannot tell a memory
nobody opened from a memory the agent rewrote in place. What answers now is a content digest of
the directory taken before and after the cell (`memory_changed`, and `memory_writes` naming what
was added, modified or removed) and the files' access time (`memory_read` / `memory_reads`).

**And the third mechanism is the one the first two are blind to.** The `mnema` arm's record is not
a directory the client loads — it is a server the model has to *choose* to call. A wrapper in front
of that server records the JSON-RPC that **arrives** at it, so `mcp_asked` says whether a
`tools/call` was made and `mcp_tools` names each tool as `name:count`. Three silences get three
different answers: an arm that declares no server is `null`, a server that never started is `null`
*with the reason*, and a server that ran and was never called is **`false` with `mcp_tools` empty**
— which is an answer, and the one a `null` would slander. It is here because the first held-out
block read `a2-due-day` 0/4 in that arm with `records_after: 1`, and those four lines cannot tell
"never consulted" from "consulted and ignored" — opposite conclusions about the product.

**What they still do not say** is in `mechanism_note`, in the line: the digest sees writing and
nothing about reading; the access time says a file was *opened*, never that the model used what
it read, and it is `null` — never `false` — where `memory_read_probe` reports a filesystem that
does not record access. `num_turns` and `cache_read_input_tokens` separated `host` from `base` in
the pilot, and they are **indirect**: neither is evidence that anything was recalled. And a
`tools/call` is the agent putting a **question**: it does not say the answer was read, believed or
obeyed.

Lines written before the fix carry `schema` `mnema-bench/cell/1` and hold `memory_files_after`
alone; lines at `/2` hold the memory columns and nothing about the channel; lines at `/6` and
before hold nothing about which build the cell ran. That is what the schema number is for.

**Whether the cell was in the state it claimed:** `seed_ok` · `seed_detail`, and
`started_at` / `ended_at`.

**The caveat, riding in the line:** `model_note` · `scoring_note` · `cost_source` ·
`axis_note` · `mechanism_note`. Whoever opens this file without the report still reads which
model, how it was scored, where the cost came from, what each axis means, and what the mechanism
columns cannot answer. A qualification in the prose beside the data is a qualification that
travels one copy and then stops.
