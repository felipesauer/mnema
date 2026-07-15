# CLI command reference

You drive Mnema from the terminal; agents drive the same model through MCP
tools. The commands group by what you're doing — run `mnema <command> --help`
for full flags and examples.

## Set up & adopt

| Command | What it does |
|---|---|
| `mnema init` | Create the full layout (`--minimal` for adoption, `--profile audit-only` for a core-only surface) |
| `mnema identity set <handle>` | Persist your default actor handle (`add` / `list` / `whoami` manage the roster) |
| `mnema adopt <component>` | Add `skills`, `memory`, `roadmap`, `commands`, `templates` (or `all`) later — adopting skills records the seeds as rows, so a later `upgrade` keeps them |
| `mnema import markdown --from PATH` | One-shot import: each `##` heading becomes a task (title taken verbatim; headings are not parsed into workflow states) |
| `mnema import github-issues --repo OWNER/REPO` | One-shot import from GitHub Issues |

## Track work

| Command | What it does |
|---|---|
| `mnema task create / list / show / move` | Manage tasks (`create` takes `--estimate`, `--context-budget`, `--priority`, `--label`) |
| `mnema focus` | One-line focus: the in-progress task to resume, or the next to start — re-pullable at any point in a session |
| `mnema guard` | Exit 0 if a task assigned to you is in progress, non-zero otherwise — wire into a client `PreToolUse` hook to keep edits on the rails (`--json` for the full verdict payload, `--quiet` for a silent gate-only hook) |
| `mnema task assign <key> --to <handle>` | Set or clear a task's assignee (`--clear`); an unknown handle is rejected |
| `mnema task label <key> [labels...]` · `mnema task labels` | Set a task's transversal labels (omit to clear); list the label catalogue with counts |
| `mnema sprint plan / start / close / cancel / show / add` | Manage sprints (one active per project) |
| `mnema sprint add-tasks <key> <task...>` | Attach several tasks at once (best-effort, reports per-task failures) |
| `mnema sprint metric <key> --name --target` | Add a measurable metric (baseline/unit/due optional) |
| `mnema epic create / show / add / close` | Group tasks; `show` includes the derived lifecycle |
| `mnema decision record / accept / reject / supersede` | Manage ADRs (`record` takes `--impact`) |
| `mnema note add` · `mnema attach add <task> <file>` | Annotate a task; attach a file deduped by SHA-256 |

## Trace & verify

| Command | What it does |
|---|---|
| `mnema task depends <key> <blocksKey>` · `mnema task ready` | Declare a task↔task dependency; list tasks whose blockers are all done |
| `mnema graph [--epic\|--sprint]` | Dependency graph: cycles, the ready/blocked frontier, and the critical path |
| `mnema snapshot [--epic\|--sprint] [--out FILE]` | Executive snapshot (coverage + graph + inbox) as Markdown or HTML |
| `mnema query [--state --epic --sprint --label --since --until --text]` | Aggregate backlog query — counts + lists across any combination of filters |
| `mnema task evidence <key> [--criterion --kind --ref]` | List or attach evidence for acceptance criteria (a `--kind commit` ref is checked against git) |
| `mnema drift` | List commits on this branch not tied to any task — the a-posteriori "is this work tracked?" signal |
| `mnema sprint coverage <key>` · `mnema epic coverage <key>` | Report % of tasks in a terminal state |
| `mnema lint sprint <key>` · `mnema lint epic <key>` | Integrity checks (incomplete tasks, subagent-bypass, broken deps) |
| `mnema decision impacting <ref>` | Which ADRs affect a given artefact |
| `mnema search <query>` | Full-text search across tasks, decisions, notes, skills, memories and observations |

## Inspect & operate

| Command | What it does |
|---|---|
| `mnema doctor` | Read-only diagnostic — re-verifies the audit chain and machine attestation offline. Or run `--rebuild-mirrors` (a recovery pass that replaces the regular checks) to recreate missing `.md` from the database |
| `mnema audit verify [--verify-anchors]` | Verify the chain + attestation; with `--verify-anchors`, also check the temporal anchors (layer 3) online |
| `mnema history --since=today` · `mnema watch` | Compact activity view; live tail of mutations. `mnema watch --git` also runs the opt-in, read-only git observer that links the in-progress task to its branch + commits |
| `mnema inbox` | Tasks awaiting your review or blocked, plus review-SLA breaches |
| `mnema serve` | Live local dashboard on `localhost`, read-only, loopback-only |
| `mnema stats [--since]` | Derived flow metrics from the audit log (throughput, lead/cycle time, reopen rate, velocity) |
| `mnema metrics [--json]` | Local adoption report (time-to-first-done, feature activation, doctor use, skill adoption) — derived locally, no telemetry |
| `mnema eval [--since]` | Guided-vs-unguided flow-metrics diff from the audit log — correlational, not causal (`--json` for raw) |
| `mnema evolve` | Read-only evolution-candidate report — skills, reopen reasons and observation topics ranked by rework, with evidence (a prompt, not a verdict) |
| `mnema agent inspect <run_id>` · `mnema agent diff <run_id>` | One run with its plans + mutations; a grouped diff of everything that run changed |
| `mnema agent close-orphans [--apply]` · `mnema audit query [filters]` | Find (and abort) runs left open past the threshold; raw log access |
| `mnema sync` | Rebuild the SQLite cache from the markdowns |
| `mnema commit -m "…"` | Commit the `.mnema/` trail and your code as two separate commits (trail first) |
| `mnema skill lint / links / refs` · `mnema memory consolidate` | Validate skills & wikilinks; regenerate memory `INDEX.md` |
| `mnema skill diff <slug>` | Diff two versions of a skill, with the recorded change rationale |
| `mnema skill review` | Skills applied in a run whose task later reopened — the structured "reconsider this" signal (task, run, reopen count + reason) |
| `mnema memory archive <slug>` | Archive a stale memory — hidden from listing and search, kept in the record |
| `mnema commands list / show` | Discover the versioned slash-command flows under `.mnema/commands/` |

## Keep current after a package upgrade

| Command | What it does |
|---|---|
| `mnema upgrade` | Detect everything out of date (pending migrations, stale AGENTS.md, missing mirrors, old `mnema_version`), show the plan, and apply it after confirmation (`--yes` to skip) |
| `mnema update check` | Check the npm registry for a newer published Mnema (on demand, regardless of the `update_check` flag; fail-open when offline) |
| `mnema agents sync` | Regenerate only the Mnema-managed block of AGENTS.md (with `@path` imports expanded, e.g. the live memory index), preserving your own content |

## Integrate (MCP)

| Command | What it does |
|---|---|
| `mnema mcp serve` | Start the MCP server on stdio (called by your AI client) |
| `mnema mcp install-instructions <client>` | Print the right config snippet |
