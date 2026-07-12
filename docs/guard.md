# `mnema guard` — require a task before editing

A recurring wish for an agent-driven workflow is: *an edit should only be
allowed when there is a task in progress.* That keeps code tied to a plan
and stops "ghost work" — commits and edits no task ever claimed.

Mnema **cannot enforce that by itself.** It does not sit between your
editor (or your agent's `Edit`/`Write` tool) and the filesystem — only the
client does. So Mnema offers the honest half of the deal: a fast,
read-only check you can wire into the place that *can* block an edit.

## The command

```
mnema guard
```

- **exit 0** — a task is in progress; the edit is tracked. Prints
  `✓ task in progress: <KEY>`.
- **exit 1** — nothing is in progress; the work would be untracked. Prints
  an actionable message naming the command to become compliant.

`--json` emits `{ ok, focus, active_task }` for programmatic use.
`--actor <handle>` scopes the check to a specific identity.

The check is the same focus logic behind `mnema focus`: a task is "in
progress" when it is in the workflow's in-progress state and (preferably)
assigned to the acting identity.

## Wiring it into Claude Code (`PreToolUse`)

Claude Code can run a command before a tool executes and block the tool if
that command exits non-zero. Add a `PreToolUse` hook in your project's
`.claude/settings.json` that runs `mnema guard` before `Edit`/`Write`:

```jsonc
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit",
        "hooks": [
          { "type": "command", "command": "mnema guard" }
        ]
      }
    ]
  }
}
```

With that in place, an attempt to edit a file while no task is in progress
is blocked, and the agent sees the guard's message — which tells it exactly
how to get compliant (`mnema task ... start`). Remove the hook, and Mnema
goes back to advising rather than blocking.

## The honest caveat

This is a **client-side** integration. Mnema provides the query and the
exit code; the *blocking* is done by the client's hook. Mnema never
intercepts an edit on its own, and a client without such a hook is
unaffected. If you want the rail to be hard, you opt into it here — Mnema
will not pretend to enforce something it cannot see.

For the softer, always-on version — a nudge rather than a wall — see
`mnema focus`, which reports the current focus without failing anything.

`guard` is one step of a fuller client integration (session bootstrap →
periodic focus → pre-edit guard). See
[client-integration.md](client-integration.md) for the whole contract and
the exit-code / JSON convention.
