# Skills, memories and observations

Agents working through Mnema have three places to record persistent
knowledge in addition to the existing decision (ADR) channel:

| Kind | When to record | Storage | Mirror file? |
|---|---|---|---|
| **skill** | A procedure I will reuse N times (e.g. "how to roll a migration safely") | SQLite `skills`, versioned by `(slug, version)` | yes, `.mnema/skills/<slug>.md` |
| **memory** | A durable project fact asserted as truth (e.g. "client requires PCI-DSS") | SQLite `memories`, upserted by `slug` | yes, `.mnema/memory/<slug>.md` |
| **observation** | An ephemeral signal that may inform a memory or skill later | SQLite `observations`, append-only | no |
| **decision** | A formal ADR with a proposed→accepted/rejected/superseded cycle | SQLite `decisions` | yes, `.mnema/memory/decisions/<key>.md` |

The point of skills and memories living **both** in SQLite and on disk
is symmetry: the agent records through the MCP tool, the human edits
the `.md` file, and either path is the source of truth depending on who
touched it last. SQLite is authoritative — `mnema doctor` reports
mirror-file drift as a `⚠ warning` (it does not fail the diagnostic),
and re-running `*_record` with the **same content** for a slug whose
mirror went missing rewrites the file from the SQLite row without
bumping `updated_at` (the no_op path self-heals).

## How agents use them

Recording is via the universal MCP tools, all of which require an
active agent run:

```
skill_record(slug, name, description, content, tools_used?, mode?)
skill_show(slug, version?)
skill_use(slug)                 # increment counter, no content returned
skills_list()

memory_record(slug, title, content, topics?)
memory_show(slug)
memories_list({ topic? })

observation_record(content, topics?, related_task_key?)
observations_list({ topic?, related_task_key?, since?, limit? })
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

### Observation append-only

`observation_record` has no slug. Each call is a fresh row. There is
no update/delete via MCP — the audit trail of observations stays
honest. Use `topics` to make them queryable later.

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

### `memory_index` / `decisions_index` vs `memories_inventory`

Two memory surfaces coexist in `context_bootstrap`:

- **`memories_inventory`** (added in 0.3.0): the agent-authoritative
  view sourced from the SQLite `memories` table. Updated automatically
  when an agent calls `memory_record`.
- **`memory_index`** + **`decisions_index`** (pre-existing): the
  human-curated `INDEX.md` files under `.mnema/memory/` and
  `.mnema/memory/decisions/`, regenerated by `mnema memory consolidate`.
  These are free-form markdown — useful for prose context the human
  wants every agent to read on session start, including handwritten
  ADR overviews.

They do not duplicate each other: agent memories live in
`memories_inventory`, ADRs live in `decisions_index` (the formal
proposed→accepted cycle has its own track), and `memory_index` is the
human-written narrative wrapper. If both are populated they
complement each other; if `memory_index` is `null` it just means no
one ran `mnema memory consolidate` — agents should still trust
`memories_inventory` as the authoritative agent-recorded list.

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
