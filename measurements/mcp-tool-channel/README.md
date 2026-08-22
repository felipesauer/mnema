# mcp-tool channel

**Whether the host injects at all, and what the injection costs.** The channel this
product's first per-edit hook rides on had never been run by anybody — the type existed in
the host's schema and nothing was known about what it does with a tool's result. Two
questions, in this order, because the second one is worth nothing if the first answers no:

1. does a hook of `type: "mcp_tool"` on `PreToolUse` put text into the session, in what
   form, and under what name can it reach the server its own plugin declares?
2. what does the work behind it cost per firing, and over a session?

The probes live on the local workbench, the arrangement [`channel-cost/`](../channel-cost/)
already keeps. *(This sentence named [`p1/`](../p1/) too, and p1 left that list: its runner is
committed at [`p1/harness/`](../p1/harness/), because a pre-registered instrument that has
produced three rounds is a thing a stranger should be able to read. A one-off probe is not.)* This directory holds the captures, each
stamped with the commit, the host version, the node, the machine and its load. **Read every
number beside the build it came from, never beside this prose.**

## 1 · No model was called, and the host is real

The difficulty is that only the HOST dispatches a hook, and a hook fires on a tool call
that only a model emits. So the model was replaced and nothing else was:

- the real `claude` binary, 2.1.228, the one installed on this machine;
- a real stdio MCP server, answering `initialize` / `tools/list` / `tools/call` and logging
  every call it received;
- a **stand-in for the model API** on `127.0.0.1`, which answers the first request with a
  canned `tool_use` for `Write` and captures every request the host makes.

That last part is what makes the answer evidence rather than an impression: **the request
the host sends AFTER the hook ran is the ground truth for what reached the session.** Text
in its `messages` is text the model would read; text absent from it did not arrive,
whatever a transcript shows a person.

Config, credentials-shaped env vars and the installed plugin all live inside a per-run
sandbox (`CLAUDE_CONFIG_DIR`), so nothing here touched the machine's own setup.

## 2 · Twelve cases, and four of them are the ones that matter

[`results/2026-08-19/channel-exists.json`](results/2026-08-19/channel-exists.json) holds
all of them with the host's own words. Read as a table:

| the hook | tool called | injected | edit went through |
|---|---|---|---|
| `PreToolUse`, tool returns the hook-response JSON | yes | **yes** | yes |
| `PreToolUse`, tool returns prose | yes | **no** | yes |
| `PreToolUse`, tool names the wrong `hookEventName` | yes | no | yes |
| `PreToolUse`, tool answers `isError` | yes | no | yes |
| `PreToolUse`, tool returns `{}` | yes | no | yes |
| `PreToolUse`, hook names a server that does not exist | **no** | no | yes |
| `SessionStart`, same hook | **no** | no | yes |

**The form is not a choice.** A tool that returns prose is called and its text is thrown
away, with no error and no warning. What reaches the model is
`{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"…"}}`, and the
host wraps it as `PreToolUse:Write hook additional context: …`. That was the competing
hypothesis, and a product built on it would have looked installed and injected nothing.

**Where it lands.** In the request after the edit, as a message of its own — **after** the
tool result, not before it. So the rule arrives with the outcome of the edit that triggered
it: in time for every later edit of the session and for a correction of that one, and not
in time to shape the first one's bytes. It stays in the conversation afterwards, so a
per-edit push spends its bytes once and then carries them.

**Every failure is non-blocking**, four ways: a tool error, a wrong event name, an
unreachable server, an event with no MCP client at all. In each case the tool call went
through, the edit went through, the session continued, and the host exited 0. That is the
doctrine the plugin's other handler writes by hand, held by the host instead.

**`mcp_tool` is not available on every event.** On `SessionStart` the tool is never called,
and the host says why in its own transcript: *"mcp_tool hooks are not available for the
'SessionStart' hook event (no MCP client context)"*. The opening context stays a `command`
hook because it has to.

## 3 · The name of the server, which is the finding that would have shipped broken

A hook must name the MCP server it calls. For a server declared by the plugin's own
`plugin.json`, **the name is `plugin:<plugin>:<server>`** — and a hook that gets it wrong
is never called, injects nothing, and reports nothing.

Four names were tried against an installed plugin whose manifest declares a server as
`probe`:

| name in the hook | called | what the host said |
|---|---|---|
| `probe` — as the manifest declares it | no | `MCP server 'probe' not connected` |
| `plugin_probeplug_probe` — as the TOOL namespace spells it (`mcp__…`) | no | `… not connected` |
| `probeplug:probe` | no | `… not connected` |
| `probeplug_probe` | no | `… not connected` |
| **`plugin:probeplug:probe`** — as `claude mcp list` prints it | **yes** | — |

The server was connected the whole time in all five runs; its tools were in the request the
host sent to the API. This is a naming rule, not a connection problem, and it is documented
nowhere — it was found by asking the host to list its own servers. For this product the
name is therefore **`plugin:mnema:mnema`**.

Because it fails silently, it is guarded from both ends: the plugin's two files are checked
against each other (`the-rule-reaches-the-writing.test.ts`, `the-record-arrives-unasked.test.ts`),
so renaming the plugin or its server is a failing test rather than a plugin that looks
installed and does half of what it says. **What no test in this repository can hold is that
the host still spells it this way** — that is what this capture is for, and it expires when
the host changes.

## 4 · What the work costs

[`edit-hook-cost.json`](results/2026-08-19/edit-hook-cost.json) and
[`edit-hook-cost-run-b.json`](results/2026-08-19/edit-hook-cost-run-b.json) — **two runs, both
published**, because one of the three figures moves between them and a point value would have
hidden that.

Decomposed the way `channel-cost/` was: the **floor** belongs to the channel and was measured
there (1.24 ms per warm firing); what is measured here is the **work** on top of it. Each figure
is the p50 of 2,000 timings after 300 warm-up calls, and every pair was timed forward and
reversed. The baseline is `read_record`, a read that already existed, on the same warm session.

| record | work, a rule matches | work, nothing matches | `read_record` beside it | bytes injected |
|---|---|---|---|---|
| empty | 0.24–0.25 ms | 0.23–0.24 ms | 0.28 ms | — |
| realistic (16 in force, 25 patterns, 30 tasks, 8 addresses) | **0.79–0.83 ms** | 0.77–0.81 ms | 0.13–0.15 ms | **586** |
| large (101 in force, 50 addresses) | **3.2–4.3 ms** | 3.4–4.3 ms | 0.13 ms | 2,706 |

Every cell is the range across the two runs and both orders. The forward and reverse terms agree
within 5% in every regime, so the figures are the work's and not the order's. **The large regime
is a band and not a point**: it moved ~30% between two runs at comparable load (2.96 and 3.39),
and the spread is wider than the difference between its two columns — which is itself the third
finding below.

Three things this says that a single total would have hidden.

**The cost is the RECORD's size, not the addresses'.** It grows ~14× from an empty record to 101
decisions in force, because the reading asks the two derivations that decide what is in force on
every call. That is deliberate — deciding it a second time is how two readers come to obey
different sets — and it is the obvious lever if this ever matters: the in-force set is a property
of the session's warm caches, and nothing caches it yet.

**Silence is not cheaper in time, only in bytes.** A path no rule addresses costs the same as one
where four rules match, within the run-to-run spread — in one run it came out *higher*. The work
is the walk, not the composition, so the argument for staying silent was always about bytes and
context and stays exactly that.

**It is more work than any read that came before it.** `read_record` on the same warm session is
0.13 ms; this is 6× that on a realistic record and ~25× on a large one. It is the first read of
this product whose cost scales with the whole record on every call, and it is the one to watch.

**Over a whole session**, at the measured edit counts (p50 34, p90 121, max 3,424), floor plus
work, across both runs:

| record | p50 | p90 | max |
|---|---|---|---|
| empty | 0.05 s | 0.18 s | 5.1 s |
| realistic | 0.07 s | 0.25 s | **7.1 s** |
| large | 0.16–0.17 s | 0.55–0.60 s | **15.7–17.1 s** |

Nothing is prorated: those are the measured per-firing figures times the measured counts, at all
three points, because a hot microbench understates at scale and the tail is the session that
decides. For comparison, the same hook as a `type: "command"` process would cost
**5.8 s / 20.8 s / 9 min 47 s** before doing any work at all.

## Which of these numbers expire, and what invalidates each

| number | expires when |
|---|---|
| every answer in §2 and §3 | **the host changes.** They are facts about `claude` 2.1.228 and about nothing else. The naming rule of §3 is the one to re-check first, because getting it wrong is silent |
| the 1.24 ms floor | the host changes when it connects a declared server, or the server's start-up work changes. It is `channel-cost/`'s number, not this directory's |
| the work terms in §4 | the reading changes, or the record's shape does. They scale with decisions in force, so a project's own figure is its own. The large regime is a band across two runs; a third run should be expected inside it, and a figure outside it is news |
| the session totals | the edit counts do — they are a snapshot of one machine in Aug 2026, and biased toward editing (see `channel-cost/`) |
| the bytes | the pushed text changes shape. It is 586 bytes for 4 rules and 2,706 for 25, so the slope is the rule count and not the record's |

## What is here

| | |
|---|---|
| [`results/2026-08-19/channel-exists.json`](results/2026-08-19/channel-exists.json) | §2, §3 — twelve cases against the real host, with the host's own diagnostics |
| [`results/2026-08-19/edit-hook-cost.json`](results/2026-08-19/edit-hook-cost.json) | §4 — the work term at three record sizes, order alternated |
| [`results/2026-08-19/edit-hook-cost-run-b.json`](results/2026-08-19/edit-hook-cost-run-b.json) | §4 again, a second run — published so the spread of the large regime is data rather than a claim |
