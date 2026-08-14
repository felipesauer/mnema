# P1 results

**Empty.** No cell of this protocol has run — not the pilot, not one cell. The directory is
committed empty on purpose: the pre-registration beside it is worth what the order is worth,
and the order is visible here.

A run lands one directory named for its date and mode — `2026-08-14-pilot/`,
`2026-08-20-full/` — holding:

| | |
|---|---|
| `cells.jsonl` | **one line per cell** — two for a re-run cell, below. The result |
| `raw/` | the agent's own output per cell, as it arrived. Evidence, not data |
| `diffs/` | what the agent wrote, per cell, excluding the record itself |

A second run is a second directory. Nothing here is edited after it lands.

**And a re-run cell leaves both of its lines.** [`reading.md`](../reading.md) allows a cell that
came back `harness_error` or `ruler_broken` — the instrument failing, never the agent choosing —
to be run again exactly once. The failed attempt is **not** removed: it stays in the file with
its status, and the reading takes the line whose `status` is `ok`. That is the only case in
which the trio `fixture` · `arm` · `run` appears twice, and the status is what tells them apart.

## The line

One JSON object per cell, one line each, every key written every time — a missing key and a
null key say different things.

**Which cell it was:** `schema` · `fixture` · `axis` · `arm` · `run`

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

**Whether the two mechanisms moved:** `memory_files_after` · `records_after`. Neither scores
anything and both are free. If `memory_files_after` is 0 in every cell of every arm, the `host`
arm was a directory nobody used, and its column has to be read that way.

**Whether the cell was in the state it claimed:** `seed_ok` · `seed_detail`, and
`started_at` / `ended_at`.

**The caveat, riding in the line:** `model_note` · `scoring_note` · `cost_source` ·
`axis_note`. Whoever opens this file without the report still reads which model, how it was
scored, where the cost came from, and what each axis means. A qualification in the prose beside
the data is a qualification that travels one copy and then stops.
