# Client integration — wiring an agent to the Mnema rail

Mnema is a rail, not a cage. It **advises** an agent and records what
happens; it does **not** sit between the agent's `Edit`/`Write` tool and the
filesystem. Only the client can do that. So a full integration is a
contract split in two halves:

- **Mnema's half (this repo):** cheap, read-only queries an agent or a hook
  can call — session context, current focus, a pre-edit gate — plus the
  audit trail that records every mutation.
- **The client's half (your agent runtime):** the loop that *calls* those
  queries at the right moments and *acts* on them — reinjecting context,
  and blocking an edit when the gate says the work is untracked.

This document is the contract: the three moments to wire, the exit-code /
JSON convention, and the honest boundary of what Mnema can and cannot
enforce. It is client-agnostic; a concrete Claude Code example is given at
each step.

## The three moments

### 1. Session start — orient with `context_bootstrap`

At the start of a session (or after a context reset), call the
`context_bootstrap` MCP tool once. It returns the project identity, the
active workflow, recent decisions, pointers into memory, the skills
relevant to the focus task (`relevant_skills`), a `next_action` telling the
agent what to do now (resume the in-progress task, start the top ready one,
unblock, or idle), and a `protocol` block restating the capture rules. Feed
its output into the agent's opening context so the session begins oriented
rather than guessing.

There is no CLI equivalent to wire here — bootstrap is an MCP-first
surface. If your client speaks MCP, this is a tool call; if not, the CLI
`mnema focus` (below) is the minimum viable orientation.

### 2. During the session — reinject focus with `mnema focus`

A long session drifts: the agent forgets it has a task open, or which one.
Mnema cannot push a reminder into the client's loop — so it makes focus
**cheap to re-pull** at any point:

```
mnema focus            # one line: resume this task, or start that one
mnema focus --json     # { focus, activeTask, nextTask, activeIsMine, line }
```

The client decides the cadence — before every edit, every N tool calls, or
on a timer. Mnema deliberately does not prescribe one; pick what fits your
runtime. The `line` field is a ready-to-inject reminder string.

*Claude Code:* a `PreToolUse` hook (or a periodic prompt) that runs
`mnema focus` and surfaces `line` to the model keeps the active task in
view without failing anything.

### 3. Before an edit — gate with `mnema guard`

The rail's one hard edge — optional and opt-in. `mnema guard` exits `0`
when a task is in progress for the acting identity and non-zero when the
work would be untracked, so a client hook can **block** the edit. The full
recipe (the `.claude/settings.json` `PreToolUse` block matching
`Edit|Write|MultiEdit`) lives in [guard.md](guard.md) — this contract just
places it in the loop: guard is step 3, after bootstrap (1) and alongside
focus (2).

## The exit-code / JSON convention

A client wires Mnema through two stable contracts, both client-agnostic:

| Surface | Contract |
|---|---|
| `mnema guard` | **exit 0** = a task is in progress for the actor → allow. **exit non-zero** = untracked → the client should block. `--json` → `{ ok, focus, active_task }`. |
| `mnema focus` | Never fails on state; always exit 0. `--json` → `{ focus, activeTask, nextTask, activeIsMine, line }`, where `focus` is `resume` / `start` / `idle`. |
| `--actor <handle>` | Both accept it to scope the check to a specific identity (defaults to the configured actor). Use it when one machine drives more than one identity. |

Parse the exit code for gating and the JSON for messaging. The exit-code
convention is the durable part — build the client hook against it, not
against the human-readable text.

*Claude Code example* (pre-edit gate; see [guard.md](guard.md) for the full
block):

```jsonc
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Edit|Write|MultiEdit",
        "hooks": [ { "type": "command", "command": "mnema guard" } ] }
    ]
  }
}
```

## The honest caveat

**Mnema advises; the client enforces.** Mnema never intercepts an edit on
its own — it has no hook between the agent's tool and the disk. `guard`
returns an exit code; the *blocking* is the client's hook acting on it. A
client that wires none of this is unaffected and Mnema falls back to pure
advice (bootstrap + focus + the a-posteriori `mnema drift` signal, which
lists commits tied to no task). If you want the rail to be hard, you opt
into it in the client — Mnema will not pretend to enforce what it cannot
see.

## Two different "hooks" — do not confuse them

The word "hook" appears in two unrelated places:

- **The client `PreToolUse` hook** (this document): lives in your agent
  runtime's config (e.g. `.claude/settings.json`), fires **before** a tool
  call in the client's loop, and can **block** it. Mnema neither owns nor
  sees this hook — it only supplies the `mnema guard` command the hook
  runs.
- **Mnema's internal domain-event hooks** (see
  [configuration.md](configuration.md) → `hooks`): configured in
  `.mnema/mnema.config.json`, they run a shell command **after** an audit
  event commits (`on_task_done`, `on_task_transitioned`,
  `on_decision_accepted`, `on_sprint_closed`, …). They are part of the
  audit trail (each firing is a `hook_ran` event) and are **inert until a
  human approves the block** with `mnema hooks approve`. They fire *after*
  the fact; they never gate an edit.

One is client-side and pre-emptive; the other is Mnema-side and
post-commit. A client integration uses the first; the second is a
project-automation feature and is out of scope here.

## Minimal viable integration

1. On session start: call `context_bootstrap`, seed the agent's context.
2. Periodically (client's cadence): run `mnema focus`, surface `line`.
3. Before edits (opt-in): wire the `mnema guard` `PreToolUse` hook
   ([guard.md](guard.md)).

Steps 1–2 make Mnema a useful copilot with zero enforcement. Step 3 turns
the advice into a wall — entirely at the client's discretion.
