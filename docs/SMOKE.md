# Manual smoke checklist

Automated tests cover the in-process MCP path via `InMemoryTransport`,
but the kit explicitly calls for a manual verification against a real
client before tagging a release.

This file is the canonical script. Run it before every `v*.0.0` bump.

## 1. CLI smoke (5 minutes)

In a clean tmpdir:

```bash
mkdir /tmp/mnema-smoke && cd /tmp/mnema-smoke
mnema init --yes --name "Smoke" --key SMK
ls -la                              # config + .app + .audit + workflows + …
mnema task create --title "Hello"
mnema task list
mnema task show SMK-1
mnema task move SMK-1 submit acceptance_criteria=Works,Tested estimate=1
mnema audit query --since=1h | head -5
mnema doctor                        # clean exit 0
```

Expected: each command runs in <300ms; the markdown mirror under
`backlog/<STATE>/SMK-1.md` is regenerated as the task moves.

## 2. MCP smoke against Claude Code

Pre-req: Claude Code installed and configured for MCP.

1. In the smoke project, run `mnema mcp install-instructions claude-code`
   and paste the snippet into your `~/.config/claude-code/mcp.json`.
2. Restart Claude Code so it picks up the new server.
3. From a Claude Code session in the same tmpdir:
   - Ask the agent to call `context_bootstrap`. Expected: workflow,
     project key, recent decisions echoed back.
   - Ask the agent to start a run and create a task:
     `agent_run_start({ goal: "smoke" })` then `task_create({ title: "via MCP" })`.
   - Ask the agent to call `decision_record({ ... })` and verify
     `mnema decision list` (in a separate terminal) shows the new ADR.
   - End the run with `agent_run_end({ status: "completed" })`.

Expected: `mnema watch` in a third terminal streams every mutation;
`mnema audit query --run <run_id>` shows the full sequence.

## 3. SIGTERM behaviour

In one terminal:

```bash
mnema mcp serve --agent-handle smoke-test &
PID=$!
sleep 1
kill -TERM $PID
wait $PID                           # exit code 0
```

Expected: the server logs `graceful shutdown started` then `complete`
on stderr, and exits with code 0. Buffer at `.app/buffer.jsonl` is
empty after exit.

## 4. Concurrent flush (two MCP servers)

```bash
# In separate terminals, both pointed at the same project:
mnema mcp serve --agent-handle a &
mnema mcp serve --agent-handle b &
# Drive both clients concurrently from their respective sessions.
# At the end, mnema audit query --since=10m should show no missing
# events; backlog markdowns should match SQLite state.
```

This exercises the cooperative file lock added in Phase C.1.
