# Skills, memories and observations

Agents working through Mnema have three places to record persistent
knowledge in addition to the existing decision (ADR) channel:

| Kind | When to record | Storage | Mirror file? |
|---|---|---|---|
| **skill** | A procedure I will reuse N times (e.g. "how to roll a migration safely") | SQLite `skills`, versioned by `(slug, version)` | yes, `.mnema/skills/{default,authored}/<slug>.md` (tool-shipped seeds vs. human/AI-authored) |
| **memory** | A durable project fact asserted as truth (e.g. "client requires PCI-DSS") | SQLite `memories`, upserted by `slug` | yes, `.mnema/memory/<slug>.md` at the root, or `.mnema/memory/<scope-folder>/<slug>.md` when scoped |
| **observation** | An ephemeral signal that may inform a memory or skill later | SQLite `observations`, append-only | yes, `.mnema/observations/<id>.md` |
| **decision** | A formal ADR with a proposed→accepted/rejected/superseded cycle | SQLite `decisions` | yes, `.mnema/roadmap/<key>.md` (`.mnema/memory/decisions/` holds only human-curated notes) |

Skills and memories live **both** in SQLite and on disk, but the two
paths are not symmetric: the agent records through the MCP tool, and
the `.md` mirror is written for humans (and git) to read. For these
two kinds **the database is authoritative** while it is populated — a
hand-edited mirror over a live row does not overwrite it.

`mnema sync` **does** re-ingest the skill and memory mirrors into an
empty database, so a fresh clone recovers its knowledge from the
committed `.md` (the same clone-survival the backlog entities have).
The ingest is idempotent — over a populated database it inserts
nothing and does not touch `updated_at` — and the following fields are
**not carried by the mirror**, so a clone-rebuilt row loses them:

- **memory `scope`** — the scope→folder mapping is lossy by design
  (the slug, not the folder, is the key), so a rebuilt memory is
  scopeless. Persisting scope in the frontmatter to recover it is
  tracked separately.
- **skill version history** — only the latest version is mirrored, so
  a rebuilt skill is a single row at its current version (no prior
  versions, no `change_rationale`).
- **`created_by` / provenance edges** — not in the mirror; a rebuilt
  memory is attributed to `unknown`, a skill under `default/` to the
  `system` seed handle and under `authored/` to `unknown`.

`mnema doctor` reports mirror-file drift as a `⚠ warning` (it does not
fail the diagnostic), and re-running `*_record` with the **same
content** for a slug whose mirror went missing rewrites the file from
the SQLite row without bumping `updated_at` (the no_op path
self-heals).

## How agents use them

Recording is via the universal MCP tools, all of which require an
active agent run:

```
skill_record(slug, name, description, content, tools_used?, mode?)
skill_show(slug, version?)
skill_use(slug)                 # increment counter, no content returned
skills_list()

memory_record(slug, title, content, topics?, derived_from_decision?, derived_from_observation?)
memory_show(slug)
memories_list({ topic? })
memory_archive(slug)

observation_record(content, topics?, related_task_key?)
observations_list({ topic?, related_task_key?, since?, limit?, include_archived? })
observation_archive(observation_id)
```

### Skill versioning

`skill_record` takes a `mode` argument:

- `mode='update'` (default): if the slug exists, overwrite the latest
  version in place. If content is byte-equal to the latest row, the
  call is a **no-op** — `action` comes back as `'no_op'`, the audit
  event is still emitted (so the agent's intent is logged), and the
  SQLite row is **not** touched (so `updated_at` stays at the real
  last-change timestamp). The mirror file is left alone unless it
  went missing, in which case it gets rewritten from the row.
- `mode='new_version'`: bump version (latest + 1). Use this when the
  change is disruptive enough that callers should be aware (e.g. the
  set of `tools_used` changed, the steps got rewritten).

**Counters reset on `new_version`.** The new row starts at
`usage_count: 0` and `last_used_at: null` — by design, since each
version is a fresh procedure whose adoption is worth measuring on its
own. The previous version retains its counters and stays queryable.
If you bumped by accident and want the counters back, call
`skill_use(slug)` to restamp the latest version. There is no API to
copy counters forward (the asymmetry is intentional).

History is immutable: older versions stay queryable via
`skill_show(slug, version=N)` and `skills_list` shows the latest only.

### Memory upsert

`memory_record` always upserts on `slug`. There is no version history
because a memory is asserted as the **current** truth — if the truth
changes, the agent rewrites the row. `updated_at` advances **only**
when content actually changes; calling `memory_record` with byte-equal
fields returns `action: 'no_op'` and leaves the row untouched. This
means "memories updated since X" is a reliable filter.

### Observation lifecycle

`observation_record` has no slug. Each call is a fresh row, and content
is never edited — the audit trail of observations stays honest. Use
`topics` to make them queryable later.

Two lifecycle moves exist, both leaving the row (and its audit trail)
intact:

- **Archive** (`observation_archive`): a soft, one-way retirement. An
  archived observation drops out of the default `observations_list` and
  of search, but the row survives; pass `include_archived: true` to see
  it. Unlike a memory (which reactivates when its slug is re-recorded),
  an observation has no slug, so archival is not reversible.
- **Promote to memory** (`memory_record(..., derived_from_observation)`):
  graduate a live signal into a durable fact, recording a navigable
  `observation → memory` provenance edge. An archived observation
  cannot be promoted — it is retired.

## How `context_bootstrap` surfaces them

Every session starts with `context_bootstrap`, which now includes:

```
{
  "skills_inventory":   [{ slug, name, version, description, usage_count, last_used_at }, ... up to 20],
  "memories_inventory": [{ slug, title, topics }, ... up to 30],
  "recent_observations":[{ id, content, topics, related_task_key, at }, ... up to 5],
  "memory_index":       <truncated string from .mnema/memory/INDEX.md OR null>,
  "decisions_index":    <truncated string from .mnema/memory/decisions/INDEX.md OR null>
}
```

The new inventories are deliberately enxutos — slug + a one-liner. The
agent calls `skill_show` / `memory_show` to pull the full body only
when needed. This keeps the bootstrap payload bounded and lets the
agent treat skills/memories as "tools" it discovers.
`recent_observations` includes the row `id` so an agent can reference
an observation later (e.g. "consolidate observation X into a memory")
without needing a follow-up `observations_list` call;
`related_task_key` resolves the internal task UUID back to the human
key the agent already knows.

### Memory hierarchy — DB is source of truth

`context_bootstrap` exposes three memory surfaces with a clear
precedence:

1. **`memories_inventory`** (SQLite, **source of truth**): the
   agent-authoritative list backed by the `memories` table. Mutated
   only through `memory_record`. The agent should read from here
   first and write only here.
2. **`recent_observations`** (SQLite, **source of truth** for
   ephemeral notes): append-only via `observation_record`.
3. **`memory_index`** + **`decisions_index`** (file-based,
   **human-curated supplement**): truncated content of
   `.mnema/memory/INDEX.md` and `.mnema/memory/decisions/INDEX.md`,
   regenerated by `mnema memory consolidate` from the on-disk
   markdown trees. **Optional** — `null` when the file doesn't
   exist. Agents **must not** write to these.

Why two surfaces coexist:

- The DB-backed surfaces are how the agent records and recalls its
  own context across sessions; they're the system of record.
- The file-based indexes are how a human curates a narrative wrapper
  for the agent ("here's our ADR landscape", handwritten prose). They
  ride on top, never replace.

If `memory_index` is `null` it just means no one ran
`mnema memory consolidate`. The agent keeps working using
`memories_inventory` + `recent_observations`. If both are populated
the agent should read the indexes for context (they're the human's
voice) and rely on the inventory for state.

### Note → ADR promotion

When an agent's free-form `note_add` matures into a decision worth
recording formally, use `decision_promote_from_note(note_id, title,
decision, …)`. The note stays put; promotion adds a
`decision_promoted_from_note` audit event linking the new ADR back
to the note via `task_key`, so a single `audit query --task-key X`
surfaces the trail. The full ADR body still comes from the caller —
promotion is a provenance marker, not a content transform.

## Worked flow

1. Session starts. `context_bootstrap` returns one skill, two memories.
2. Agent calls `skill_show('safe-migration')` because the task at hand
   needs that procedure.
3. Agent calls `skill_use('safe-migration')` after applying it —
   `usage_count` ticks from 5 to 6, `last_used_at` is now.
4. During the work, the agent notices the build pipeline is flaky:
   `observation_record(content='build is flaky on Fridays',
   topics=['ci'], related_task_key='WEBAPP-42')`.
5. After three more sessions notice the same thing, the agent decides
   it is a durable fact: `memory_record(slug='friday-ci',
   title='Friday CI is unreliable', content='See observations from ...',
   topics=['ci', 'risk'])`.
6. The agent learns a new procedure during the work and records it
   for next time: `skill_record(slug='retry-failed-job', ...)`.

The CLI side (humans) reads via `mnema {skill,memory,observation}
list/show`. Decisions stay in their own track — formal ADRs that go
through a review cycle.
