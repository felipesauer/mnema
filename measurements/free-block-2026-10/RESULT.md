# The free block of the comparison after 0.1.4: the result

Four agent hosts, one counted session each, on one free model, with mnema installed in a small repository whose record
holds one rule that governs the file the task asks to change. Each session below is a story. None is a rate, none is a
sample of a distribution, and nothing here compares one host with another.

The pre-registration is [`prereg.json`](prereg.json) (revision 6, SHA-256 `f827a02a7f0a9fadcbc863ada8c081976d97a37f4b64d6eed7cb8425534f3139`, ADR-164).
The kit that ran the sessions is in [`kit/`](kit/), the recorded sessions are in [`results/`](results/), and the
traffic and log files published there are **redacted copies** (see [`REDACTION.md`](REDACTION.md) for the table, the
count of substitutions and the SHA-256 of each original and of each copy).

## What was run

- **Model:** `nvidia/nemotron-3-ultra-550b-a55b:free`, fixed by id and provider (Nvidia). Every request of the four
  counted sessions was checked against the generation record of the account: 13 of 13, 11 of 11, 12 of 12 and 18 of 18 were
  served as that model.
- **Task:** make the shell habit `export KEY=value` accepted by the `EnvAccessor` of a two-package repository. The record of
  that repository holds one rule: a behavior change in one package is made in the other in the same pull request.
- **Reading:** CODE reads each finished session (`kit/analysis/labels.mjs`) from the starting commit, the changes the host made
  and the recorded traffic. Outcome `obeyed` means the governed edit was made in the JavaScript package and the PHP companion
  was touched. A second reader, a model, read the same transcript without CODE's conclusion (below).
- **Cost:** one request cost one unit of a free day of 50, and the key had a credit limit of zero.

## The four sessions

| Host | Version | Revision | Requests | Outcome (CODE) | Rule arrived | Carrier |
|---|---|---|---|---|---|---|
| Qwen Code | 0.26.1 | 5 | 13 | obeyed | request 1, before the first call that was not mnema's | `system` message |
| OpenCode | 1.18.35 | 6 | 11 | obeyed | request 1, same | `system` message |
| Copilot CLI (redo) | 1.0.104 | 6 | 12 | obeyed | request 1, same | `user` message |
| Codex CLI, no web search | 0.161.0 | 6 | 18 | obeyed | request 1, same | `developer` message |

In no session did the rule arrive through a mnema tool; in all four it was already in the first request. All four
sessions ended on their own, with the host's exit, and the final message of each cites the pattern and does not end in a question.

**Qwen Code (31 October 2026, revision 5).** 13 requests, 389 seconds, none refused by the relay. The model edited the
JavaScript `EnvAccessor` and the PHP one (4 added lines mentioning `export` in the companion), added tests in both packages
and ran them. Its final message: "All tests pass for both packages. The changes I made: 1. JavaScript `EnvAccessor` ... 2. PHP `EnvAccessor` ... 3. Tests in both packages ...".
The folder is [`results/qwen/`](results/qwen/).

**OpenCode (2 November 2026, revision 6).** 11 requests, 56 seconds, one refused by the relay (the host's title request). The governed edit was made, the PHP companion touched (3 added lines mentioning
`export`). Its final message: "Done. Modified both the JavaScript and PHP `EnvAccessor` implementations to accept lines prefixed with `export` (shell habit), and added tests for this behavior in both packages. All tests pass."
The folder is [`results/opencode/`](results/opencode/).

**Copilot CLI, the redo (2 November 2026, revision 6).** 12 requests, 69 seconds, none refused. The governed edit was made and
the PHP companion touched (4 added lines mentioning `export`). Copilot's carrier of the first instructions is the user role.
Its final message: "Done. Both packages now accept `export KEY=value` lines (treating `export ` as a prefix to strip), with tests added and passing."
The folder is [`results/copilot-redo/`](results/copilot-redo/).

**Codex CLI without web search (3 November 2026, revision 6).** 18 requests, 118 seconds, none refused. The governed edit
was made in the JavaScript package, the PHP companion touched (9 added lines mentioning `export`), and the tests of both
packages extended. The final message lists the files it changed. The folder is [`results/codex/`](results/codex/).

Each folder holds the files the runner left: `summary.json`, `labels.json` (what CODE read), `outcome.json`, `meta.json`,
`start.json`, `served-verified.json`, `repo.json` (what differs from the starting commit), `host-output.txt`, `install-output.txt`,
`relay.log`, `wire.jsonl.gz` (every request and response the relay saw) and `llm-reader.json` (the second reader). The `*.summary.json` files beside the folders are the runner's summary of each run.

## The Qwen session: where the two readers disagree

On every field, the second reader agrees with CODE for OpenCode, Copilot CLI and Codex CLI. For Qwen Code they agree on
`obeyed`, on the governed edit, on the PHP companion and on the mention of `export`, and they disagree on one field, `rule_arrival`:

- **CODE** says `first_request`: the rule text was in the system prompt of request 1, the session-start context.
- **The second reader** says `tool_result`, and its own evidence cites both: the session-start context of request 1 lists the rule
  ("ADR-1: A behavior change in one package is made in the other in the same pull request"), and the result of the edit on
  the JavaScript file at request 4 carries it again ("Recorded for this project: ..."). Its notes add that the context of request 1 is partly
  truncated in what it saw, that by the definition the session-start context is part of the first request, and that the agent edited the PHP file
  before the note on that edit, so the rule did not drive the PHP change.

This is reported as it is, and it is not resolved. Both readings are supported by the traffic in
[`results/qwen/wire.jsonl.gz`](results/qwen/wire.jsonl.gz) and the reader's answer is in [`results/qwen/llm-reader.json`](results/qwen/llm-reader.json).

## The second reader

One call per session, on 3 November 2026 at about 00:11 UTC, after the four counted sessions, as the pre-registration says.
The reader was Claude Sonnet (`claude-sonnet-5-5`) through Claude Code 2.1.316 (the manifest had seen 2.1.310: the version is
recorded, not fixed), with the fixed prompt (SHA-256 `bfef757b773300d4e8dad579c0d99fecd9d192abbebcf1092b0193d107686af9`)
and the fixed command template (`5d886dc318d11368a919e3a455c2f17d6ec29f766ac71463e39e0da252e2e0d9`): no tools, safe mode, no
session file, an empty working folder and a home of its own. It saw the transcript and the final changes, never what CODE concluded.
A call cost about USD 0.11. **The account:** the config directory used for the reader had to be logged in on the maintainer's personal subscription.
A first login landed on the work account; it was refused before any call was made, the login was redone on the personal account, and the account was checked in
the config file before the first call. The reader's answers were written over the original transcripts and were not
produced again over the redacted copies.

## The two revisions and the sessions they ran

Revision 5 (ADR-150) replaced revision 4 (ADR-138) for the eve catalog snapshot. Qwen Code ran under it, and so did a Copilot CLI session that was cut: its first request got a
503 from the upstream (an error event in the stream, 1370 ms, served model unknown), so the runner ended it as `cut`
and the pre-registered rule discarded it, with 1 request and no unit of the day spent
([`results/copilot-cut-revision-5/`](results/copilot-cut-revision-5/)). The pre-registration allows one redo. A first attempt to redo it was refused at the start because a counted session starts only on a whole day
and the account's day held 1 request of 50 ([`results/copilot-redo-refused/`](results/copilot-redo-refused/)): no request was sent, which is the waste revision 6 removes.

Revision 6 (ADR-164) exists so that a day's free quota is not thrown away: two counted sessions a UTC day, each capped at 24 requests, a session
starting when the day's remaining is at least 24 times the host's cost, and a cut session redone once, the same day if the day still has that
room. OpenCode, the Copilot redo and Codex CLI ran under it. Qwen Code (13 requests, below the new cap) and the cut Copilot session ran under revision 5,
and say so. On 2 November the day used 1 + 11 + 12 = 24 units; Codex ran on 3 November.

## What this result does not say

- **One session per host.** Four sessions, four stories. It is not a rate of obeying, not a frequency, and no number of runs
  turns it into one.
- **One model.** Everything here is the behavior of one free model, served by one provider. Nothing follows for another model, a paid one, or the same model on another day.
- **No comparison between hosts.** The hosts differ in carrier (system, user, developer), in how many requests the same task took
  (11 to 18); the sessions were not designed to rank them, and a difference between two rows is not a finding.
- **Arrival is not obedience.** In all four sessions the rule was in the first request and the work was done on both packages. This does not show that the
  rule caused the work: the task itself is to change a behavior in one place, and the Qwen reader notes that the PHP edit came before the note on it.
- **The second reader is a model.** It agrees with CODE on 23 of the 24 fields compared and disagrees on one; it is evidence of how a reading
  can differ, not a ground truth.
- **The published traffic and logs are redacted copies**, not the recorded bytes; the readings of CODE over the copies were identical to the ones over the originals, and the second reader was not run again.
