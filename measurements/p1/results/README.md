# P1 results

**The pilot has run; the round has not.** `2026-08-17-pilot/` holds four cells — one task, four
arms, one run — and nothing else of this protocol has been spent. This directory was committed
empty on purpose, and that sentence stood here until the pilot landed: the pre-registration
beside it is worth what the order is worth, and the order is visible here.

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
a digest. So a run over held-out tasks commits `cells.jsonl` and holds `raw/` and `diffs/` back
until the tasks themselves are published — the same order, for the same reason.

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
could have carried: `mnema-bench/cell/1` is the pilot, `/2` adds the memory columns below and
`/3` the mnema arm's channel. **Lines are never re-run to gain a column** — a result is not redone
because a later question got a better instrument. The absent key is what says a line is from
before, and that is the whole job of the number.

**What produced it:** `model` · `cli_version` · `mnema_version` · `permission_mode` ·
`system_prompt_sha256_16`. The build and the model are *in the line*, so a result that is
contradicted later can be told apart from a result taken against a different product.

**What the discriminant said:** `verdict` (`CONFORMS` / `VIOLATES` / `BROKEN`) · `exit` ·
`status` · `error` · `ruler_detail` · `truncated`.

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
alone; lines at `/2` hold the memory columns and nothing about the channel. That is what the schema
number is for.

**Whether the cell was in the state it claimed:** `seed_ok` · `seed_detail`, and
`started_at` / `ended_at`.

**The caveat, riding in the line:** `model_note` · `scoring_note` · `cost_source` ·
`axis_note` · `mechanism_note`. Whoever opens this file without the report still reads which
model, how it was scored, where the cost came from, what each axis means, and what the mechanism
columns cannot answer. A qualification in the prose beside the data is a qualification that
travels one copy and then stops.
