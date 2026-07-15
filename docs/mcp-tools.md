# MCP tools — the risk vocabulary

Every tool Mnema advertises over MCP carries **risk annotations** from the
SDK's four-hint vocabulary in `tools/list`, so a client can judge a tool's
blast radius *before* calling it — surface a confirmation for a destructive
write, safely retry an idempotent one, or auto-allow a read. (A read-only tool
carries only the hints that apply to it — see the table below.) The classification is local
and static: it collects nothing, it is the same on every machine, and it
lives in one reviewed table ([src/mcp/tool-risk.ts](https://github.com/felipesauer/mnema/blob/main/src/mcp/tool-risk.ts)).

> **A hint, not a wall.** These are advisory. A client must not treat them as
> a security boundary — the MCP spec says so, and Mnema does not enforce a
> tool's behaviour against its own annotation. They describe intent; the real
> guarantees are the workflow gates and the audit trail.

## The four hints

| Hint | Meaning |
|---|---|
| `readOnlyHint` | The tool does **not** modify state — no DB write, no mirror write, no audit event. Reads, lists, queries, computed reports. When true, the other three are not meaningful and are omitted. |
| `destructiveHint` | (writes only) The write can **lose or overwrite** prior state — delete, archive, replace, cancel, or an in-place overwrite. A purely additive write (create, record, append) is `false`. |
| `idempotentHint` | (writes only) Repeating the call with the same arguments leaves the world in the **same state**. See the policy below. |
| `openWorldHint` | The tool reaches an **external** system (network, remote service). Almost every Mnema tool is local-only; `pr_status` (GitHub API) is the notable `true`. |

## The idempotency policy

`idempotentHint` is annotated by **end state**, not by whether a repeated call
returns an error. Re-closing an already-closed epic changes nothing in the
world, so it is `idempotent: true` — even though the second call is refused
with an `*InvalidState` error. The hint exists to tell a client *"a retry is
safe"*, and a retry that no-ops (or errors without changing state) is safe.

By contrast, **additive** writes are `idempotent: false` — each call adds
more: `task_create`, `*_record`, `note_add`, `observation_record`, and the
counters/leases that climb on every call (`skill_use` bumps a usage count,
`task_claim` extends a lease).

## Two name-vs-behaviour traps

A couple of tools read as safe but write:

- **`task_claim`** and **`skill_use`** sound read-only but are `readOnly:
  false` — each writes an audit event and mutates a lease / usage counter, so
  they are also `idempotent: false`.
- **`context_bootstrap`** and **`snapshot_generate`** sound heavy but are
  `readOnly: true` — they only read and compute.

## Transition tools

The `task_<action>` tools are generated per workflow, so their annotation is
**derived at registration** rather than tabled. A transition always mutates
(`readOnly: false`) and is `idempotent: true` (the handler no-ops when the
task is already in the target state). It is `destructive: true` only when it
**rewinds** a terminal task (`reopen`) or **abandons** it (`cancel`); a
forward move (`start`, `submit`, `approve`) loses nothing and is
`destructive: false`.

## Keeping it honest

A completeness test fails the build if a registered tool has no entry in the
risk table (or an entry points at no tool). A new tool therefore cannot ship
unclassified — the vocabulary stays exhaustive without anyone remembering to
update it.
