# The sieve of 24 Aug 2026 — aborted, and published aborted

**This run did not produce a number and nothing here is read as one.** It is committed because
the directory's rule is that nothing is overwritten, a broken evaluation mode is published
broken, and because what stopped it was a defect in the instrument rather than in the tasks.

| | |
|---|---|
| what was planned | round 4's sieve: 16 candidates × `mnema-doc` × 8 runs = **128 cells** |
| what ran | **55 cells** before it was stopped by hand |
| what is usable | **22 cells.** The other **33** are the vendor refusing to run |
| spent | **$1.2947** |
| pre-registration | [`round-4/sieve.md`](../../round-4/sieve.md), unchanged by this run |

---

## What happened, and it is one field

Partway through the second run the account hit its session limit. The agent CLI answered every
cell after that with this, and the harness read it as a cell:

```json
{ "subtype": "success", "is_error": true, "api_error_status": 429,
  "terminal_reason": "api_error", "total_cost_usd": 0, "num_turns": 1,
  "result": "You've hit your session limit · resets 5:50pm (UTC)" }
```

**The gate that classifies a cell read `subtype` and nothing else.** `subtype` says `success`, so
33 cells in which the agent never ran were written with `status: ok`. The starting repository was
untouched in every one of them, so each task's own discriminant correctly reported `BROKEN` — and
the line therefore said *the code the agent wrote does not run*, about code no agent had written.

| run | cells | refused by the vendor |
|---|---|---|
| 1 | 16 | **0** |
| 2 | 16 | 13 |
| 3 | 16 | 16 |
| 4 | 7 (stopped) | 4 |

**A vendor refusing to run is not an agent that disobeyed**, and it is the same class of failure
as the surface arm that was never delivered — which this bench already had a rule for. What it did
not have was a way to see it.

## What was changed, and what was not

- **the gate reads the vendor's own error field** as well as its subtype, and a refused session is
  `harness_error`, which the round's reading rule already handles. `error_max_turns` is excluded
  deliberately: a truncated session carries `is_error: true` and it did work;
- **the line carries `result_is_error`, `api_error_status` and `terminal_reason`** from schema 8.
  Schema 7 carried `result_subtype` alone, so this run could only be diagnosed by opening `raw/` —
  which is not published for a held-out task, and therefore not available to anybody else;
- **the case that should have caught it already existed and was passing for the wrong reason.**
  `tests/verdict.test.mjs` has carried *"a result the CLI itself calls an error is a harness
  error"* since the harness was built, driving it with `subtype: 'error_during_execution'` **and**
  `is_error: true` at once. Only the first was ever read. It is three cases now, one per signal
  plus the truncation that must survive;
- **nothing about the tasks, the split or the sieve's rule was touched.** The sieve that selects
  round 4's headline is the complete one, run afterwards on the fixed instrument.

## And the published record is unaffected, checked rather than assumed

Every one of the **492 cells** committed under this directory before schema 8 was examined for the
shape above — `cost_usd` of zero, or a raw result carrying `is_error` or `api_error_status`. **None
of them carries it.** Rounds 1, 2 and 3 are unaffected and none of their numbers moves.

## What this run does say, and it is not a rate

**Run 1 is intact** — 16 cells, none refused — and it is one observation per candidate, which is
not a rate and is not used as one. It is recorded here because it exists:

13 of the 16 candidates came back `CONFORMS` on their single clean cell, 2 `VIOLATES`, and 1
`BROKEN`. **One cell per task cannot separate a task at 0.6 from a task at 0.95**, which is the
whole reason the sieve declares eight runs. The complete sieve is what selects, and it selects on
its own cells.
