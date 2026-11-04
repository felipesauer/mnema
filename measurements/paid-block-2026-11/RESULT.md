# The paid block of the comparison after 0.1.4: result

Claude Code 2.1.311 (claude-sonnet-5-5, effort xhigh) run headless on one person's own Pro subscription, never an API key, with the same rule handed over in four ways: in `CLAUDE.md` (arm A), only in `AGENTS.md` with no `CLAUDE.md` (arm A-agentsmd), through mnema 0.1.4 whole (arm B) and through mnema 0.1.4 without its plugin (arm C). The pre-registration is `prereg.json` here (SHA-256 `e285a00514e432f757d86451ead40d7bdcc602593afc2ed523c1025b15cf2042`, ADR-176); it fixed the cells, the two readers and the rules for discarding and redoing before the first counted session. 49 counted sessions ran on 3 and 4 November 2026, one at a time: stage 1 (34 parity sessions) and stage 2 (15 decision sessions). Every session ended on its own; none was cut by a limit, redone or interrupted.

## The numbers the release notes may cite

- **Stage 1, the rule is followed in every arm.** The parity task needs a change in two packages; the rule, recorded or written, says to make it in both. In the neutral cell, ten repetitions per arm: the arm with the rule only in `CLAUDE.md` obeyed 10 of 10, the arm with the rule only in `AGENTS.md` (no `CLAUDE.md`) obeyed 10 of 10, and mnema whole obeyed 10 of 10 (an exact 95% lower bound of 0.69 for each). The four scoped sessions (two in A, two in B) also obeyed, so 34 of 34 sessions obeyed. A rule that lives only in `AGENTS.md` was read by Claude Code and followed as often as one in `CLAUDE.md`.
- **Stage 2, with the plugin the agent linked its decisions to code.** In the decision tasks (two repetitions per cell, so counts, not rates), mnema whole recorded 11 decisions and attached a path to 11 of them; mnema without the plugin, through the command line, recorded 12 and attached a path to 0. In 6 of 6 sessions the reply of the record call in B offered a path; through the command line it did in 1 of 6. B superseded a draft 3 times and C 5 times.
- **Cost.** All 49 sessions together cost 23.6 USD-eq (the stream's price-of-API unit, only a unit on a plan): stage 1 6.39, stage 2 17.24; the 34 calls of the second reader cost 1.84 more. The seven-day window moved from 0.26 to 0.38.
- These are one model, one synthetic repository in stage 1 and two real repositories in stage 2: they say what happened in these 49 sessions, not a rate for other tasks, models or versions.

## Stage 1: the parity sessions

34 sessions in a synthetic repository of two small packages (a JavaScript one and a PHP one) with one recorded rule: a behavior change in one package is made in the other in the same pull request. The neutral prompt does not name the PHP package; the scoped prompt names the JavaScript one.

| arm and cell | sessions | CODE outcomes | LLM reader outcomes | how the rule first showed in the stream | requests (mean) | USD-eq | minutes (mean) |
|---|---|---|---|---|---|---|---|
| B parity-scoped | 2 | {"obeyed": 2} | {"obeyed": 2} | {"hook_event": 2} | 9 | 0.494 | 1.4 |
| A parity-scoped | 2 | {"obeyed": 2} | {"obeyed": 2} | {"not_seen_in_stream": 2} | 7 | 0.299 | 0.9 |
| A parity-neutral | 10 | {"obeyed": 10} | {"obeyed": 10} | {"not_seen_in_stream": 10} | 7.9 | 1.652 | 1 |
| A-agentsmd parity-neutral | 10 | {"obeyed": 10} | {"obeyed": 10} | {"not_seen_in_stream": 10} | 7.4 | 1.634 | 1 |
| B parity-neutral | 10 | {"obeyed": 10} | {"obeyed": 10} | {"hook_event": 10} | 8.2 | 2.308 | 1.2 |

`obeyed` is the governed edit and the PHP companion both made in the same session, with `export` in what was added there (read from the repository's diff against the starting commit). No session reported, asked or stayed silent instead: the three-outcome split has nothing in it beyond `obeyed`, so the hypotheses of the pre-registration (the scoped request beating the rule; the rule failing in B with delivery at the edit) were not borne out here. In B the rule reached the model by a hook at the session start (12 of 12); in A and A-agentsmd it is a file the host loads, which the stream does not carry. In the A-agentsmd session that was inspected the agent cites the rule from its first message, before any tool result holds its text.

### The two readers

CODE (`kit/analysis/labels.mjs`) and the frozen second reader (Claude Sonnet 5.5 through Claude Code, one call per session, an answer refused and not repaired when malformed; 34 of 34 answers valid) agree on which edits were made, on `obeyed` and on the outcome in all 34 sessions. They disagree on one field of one session, `rule_arrival` of `A-agentsmd/parity-neutral-r01`: CODE says `not_seen_in_stream`, the reader says `tool_result`.
- CODE's evidence: no tool result of the session holds the rule's text, and the agent's first message already states the rule.
- The reader's evidence: it quotes the agent's message 16 and says the text "appears to have come from a tool result in the cut portion of messages 7-15"; its own note flags this as a guess about a part of the transcript cut for length.
CODE's reading stands. The side-by-side file is `results/stage1/readers-side-by-side.json`.

### Cost and windows

6.387 USD-eq over 267 model requests; the five-hour window went from 0.01 to 0.5 and the seven-day window from 0.26 to 0.3 (the account had 26% of its week used before the block). Aggregate size of a Pro window by the sum of USD-eq over the sum of the movement, with the range the two decimals allow: 13 USD-eq per five-hour window (12.8 to 13.3) and 159.7 per week (127.8 to 212.9). Stage 2 alone gave 22.2 (21.6 to 22.8) and 277.1 (237.5 to 332.6); the unit differs between a session that reads little and one that reads and writes through caches.

### The checks, every session

Account check `match` before and the session's own config naming the same account after: 34 of 34; subscription proof (apiKeySource `none`, a rate-limit event of the subscription's windows, `claude auth status` offline reporting a claude.ai login on the Pro plan): 34 of 34; no credential renewed or written back, none found in a run folder; endings {"exited": 34}.

## Stage 2: the decision sessions (counts only)

15 sessions in two real repositories of the person who ran the block, B and C only (the plugin against the command line). The tasks: add a cache, parse an environment file, add retries, and a question about a past decision; for the first three a scripted follow-up in a second round settles two choices that should be recorded. CODE reads each session (`kit/analysis/q-readers.mjs`): q1 whether the answer names the current rule, what it replaced and why, and whether mnema returned the predecessor; q2 the decisions recorded, with a path (a `governs` link), superseded drafts and whether the reply of the record call offered a path; q3 (arm C) whether `--help` was read before the first record and a `format:check` that went red on a file the agent had not written. The manifest froze CODE as the reader of these tasks; no second reader was frozen for them, so there is none.

| arm and task | sessions | what CODE read (sums over the sessions of the cell) | requests (mean) | USD-eq |
|---|---|---|---|---|
| B d-cache | 2 | q2: 3 records, 3 with a path, 1 supersedes, a path offered in 2 of 2 sessions | 25 | 1.692 |
| C d-cache | 2 | q2: 4 records, 0 with a path, 2 supersedes, a path offered in 1 of 2 sessions; q3: --help before the first record in 2 of 2, format:check red on 1 unwritten files | 28.5 | 3.113 |
| B d-env | 2 | q2: 4 records, 4 with a path, 0 supersedes, a path offered in 2 of 2 sessions | 29.5 | 3.259 |
| C d-env | 2 | q2: 4 records, 0 with a path, 1 supersedes, a path offered in 0 of 2 sessions; q3: --help before the first record in 2 of 2, format:check red on 2 unwritten files | 42 | 3.854 |
| B d-retry | 2 | q2: 4 records, 4 with a path, 2 supersedes, a path offered in 2 of 2 sessions | 25 | 2.446 |
| C d-retry | 2 | q2: 4 records, 0 with a path, 2 supersedes, a path offered in 0 of 2 sessions; q3: --help before the first record in 2 of 2, format:check red on 2 unwritten files | 29 | 2.472 |
| B q-codes | 2 | q1: named the current rule 2, what it replaced 2, why 2, predecessor returned by mnema 2 | 4.5 | 0.27 |
| C q-codes | 1 | q1: named the current rule 1, what it replaced 0, why 1, predecessor returned by mnema 0 | 6 | 0.129 |

Two repetitions per D cell and three q-codes sessions: these are counts. Stage 2 cost 17.235 USD-eq; the room rule made the runner wait once, 892 seconds for the five-hour reset. Its checks are the stage's own: 15 of 15 with account `match` before and after and the subscription proved, no credential renewed or found, endings {"exited": 15}.
**The traffic of stage 2 is not published.** Those sessions ran in two of the person's own repositories, and a redaction replaces names but not source code, so the streams, which carry excerpts of that code, stay private; this page and `results/stage2/counts.json` carry the counts and the method.

## Deviations from the pre-registration, declared

1. **The window-size rule never fired.** The manifest replaces the assumed size of a window (9.8 USD-eq per five hours, 55 per week) with the ledger's measured ratio after three sessions that each moved a window by at least 0.03; at these session sizes (about 0.01 each) it never did, so the room rule used the assumed, conservative size throughout. The aggregate sizes above are the reading used for the threshold at which the decision tasks would have dropped to one repetition (27.5 USD-eq per week): every reading clears it, so they ran at two (15 sessions).
2. **Stage 2 started before the week between the stages** that ADR-175 set: the person released it early (ADR-180). The queue and the cells did not change.
3. **The runner is not in the manifest.** The loop that walks the queue, waits for a window to reset and stops on a stop condition, and the writer of the result tables, were added after the manifest's kit commit (`kit/run/`); they decide no measurement and call the frozen runner and readers.
4. **Extra redaction.** The traffic copies carry two redaction passes beyond the manifest's: the names of other projects, an account name and the session folder names were replaced, and the em dash, which the model's own text carries, was replaced by a hyphen-minus. `REDACTION.md` lists every rule, its count and the SHA-256 of every original and copy.
5. **Parts of the kit are withheld.** `kit/WITHHELD.md` lists, with the SHA-256 the manifest holds, the files of the kit that are specific to the two real repositories (the rules and design files copied from an earlier kit and the stage 2 prompts) and the script that builds their bases.
6. **The uncounted smoke sessions.** Three sessions on the subscription, run before the last freeze, proved the account check, the subscription proof and the redaction. They found two defects of the kit (the environment of the process that starts the sandbox, and a redaction that missed a folder name); both were fixed and the pre-registration refrozen before any counted session (the manifest's `change_note`).

## Probes that are not results

Before the next block, three uncounted probes ran on the same subscription (3 live sessions, 0.5 USD-eq): `/compact` runs in headless mode when sent as a message through `--input-format stream-json` in one process and a rule given before it still held after; `--resume` fires `SessionStart` again and reloads `CLAUDE.md`; and a scripted answerer can stand in for a person at mnema's ask gate through `--permission-prompt-tool stdio`. They are probes of how to measure, one session each, not measurements; their evidence is not part of this folder.

## What is here

- `prereg.json`, the pre-registration; `README.md`; this page.
- `results/stage1/`: `table.json`, `readers-side-by-side.json` and `traffic/<session>/` (per session the redacted stream, proxy log with hosts and bytes, meta, CODE labels, repository diff and the reader's answer). `results/stage2/counts.json`: the counts.
- `kit/`: the kit as the manifest's kit commit holds it (without installed binaries, run folders, secrets, key files or compiled caches), through the redaction in `REDACTION.md`, plus `kit/run/` added afterwards.
- `REDACTION.md`: the rules, their counts, and the SHA-256 of each original and each published copy.
