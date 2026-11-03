# ab-free-block: the kit of the free block of the comparison after 0.1.4 (ADR-119)

Private. Four hosts (Codex CLI, Copilot CLI BYOK, OpenCode, Qwen Code), one session each, arm with mnema only, on one free
OpenRouter model fixed by id and provider (`kit.json`). Everything a host sees is invented and public-safe: a free model's
provider may log or train on it. This holds the instruments, the capability check, the runner of a measured session, the analysis that reads
one, the edit check and the Codex cost probe. No measured session has run: the sessions start only after the maintainer accepts the pre-registration.

## The key

A free OpenRouter key (credit limit 0) sits in `~/.config/mnema-ab/openrouter.key` (mode 600). Nothing in this kit puts it in
a file, an argument, an environment variable, a log or a commit: the relay and the quota reader read the file at the moment
of each upstream request, and a host is handed a made-up key. `lib/scan-for-key.mjs <folder>` says whether the key is in any
file under a folder (booleans only). `GET /api/v1/key` has a `label` that can preview the key: `lib/quota.mjs` returns
numbers and booleans only. To revoke when the round closes: the maintainer, on the OpenRouter page.

## Layout

| Path | What |
|---|---|
| `kit.json` | the pins: model, reserve, host versions and binaries, mnema version and tag |
| `install.sh` | installs the hosts (`installed/<host>/`), mnema from npm (`mnema-pkg/`), and the plugin of the tag's commit (`plugin-tag/`); all gitignored, rebuilt by this |
| `relay/relay.mjs` | the relay: local OpenAI-compatible proxy; adds `provider: {order:[tag], allow_fallbacks:false}`, drops `models`, refuses another model, counts and bounds requests, records the wire, checks the model and provider served (stream, and OpenRouter's generation record) |
| `relay/relay.test.mjs` | its tests (fake upstream; the guards were mutated and each mutation is caught) |
| `lib/` | quota reader, generation lookup, a small MCP client, the run scaffolding, the key scan |
| `seed/make-repo.mjs` | the synthetic repository of the capability check: `src/index.js`, mnema's own `init`, one accepted decision `capcheck-7f3a`, in a HOME of its own |
| `hosts/adapters.mjs` | how each host is configured for OpenRouter through the relay, and its plugin |
| `hosts/codex-trust.mjs` | how Codex's plugin hooks are trusted by configuration in the session's own home (no bypass flag), checked against the pinned plugin tree, and its tests (they run the pinned Codex against a throwaway home, no model) |
| `seed/make-parity-repo.mjs` | the synthetic two-package repository of the MEASURED sessions (a JS and a PHP package with the same small API), with the parity rule `org-08` of the 0.1.4 comparison recorded, addressed and accepted in `.mnema/` |
| `seed/parity/` | what was copied from the 0.1.4 kits: `org-08.json`, the scoped prompt `inline.g.md`, the derived neutral prompt, `provenance.json` with the sources and sha256; `extract.py` redoes (`--check`: compares) the copy from the archive |
| `capcheck/` | the criterion in code (`criterion.mjs`, tested), the direct check (`direct.mjs`), the host runner (`run-host.mjs`, with `--label` and `--budget`), `finalize.mjs` (verdict from a recorded wire), `hook-proof.mjs` (did the plugin's hooks run, off the wire), `verify-served.mjs`, `probe-request-cost.mjs` |
| `measured/` | the runner of ONE session of ONE host, a counted session or an edit check: `protocol.mjs` (the argv of each host, the limits; `freeze/make-prereg.mjs` reads it, so the manifest and the runner cannot differ), `session.mjs` (preconditions, the throwaway HOME and working directory, the relay, the quota before and after, the stop and discard rules), `run-session.mjs` (the command line, `--dry` or `--live`), `fake-upstream.mjs` (a fake OpenRouter on the loopback for dry runs), `summarize-dry.mjs` and `summarize-live.mjs`, `rejudge.mjs` (reads a finished run again under the analysis as it stands), `test-support/` (a stand-in host and the scripted edit commands for the tests) |
| `analysis/` | CODE reads a finished session into the labels (`labels.mjs`, over `repo-facts.mjs`: what differs from the starting commit), `transcript.mjs` renders the wire for the LLM reader, `llm-reader-prompt.md` is that reader's prompt, `compare.mjs` prints the two readers side by side, `llm-reader.mjs` is the second reader's command and its one call per session (below) |
| `editcheck/` | the edit check of a host: change one line of one file and nothing else, the criterion in code (`edit-check.mjs`) |
| `probe/` | the Codex cost probe: 3 requests, the account's counter read before and after each (`codex-cost.mjs`) |
| `results/` | per run: gzip of the wire, `meta.json`, `verdict.json`, host output; and `ledger.jsonl`, every request this kit sent upstream |
| `freeze/` | the catalog snapshot, the endpoint lists, `freeze.json` (what can be read off the kit), `prereg.json` (everything the pre-registration fixes; its sha256 is what the public pre-registration cites; `make-freeze.mjs` then `make-prereg.mjs`) |

## Run

```sh
./install.sh                                   # once
node --test --test-force-exit --test-concurrency=1 relay/relay.test.mjs capcheck/*.test.mjs editcheck/*.test.mjs hosts/*.test.mjs seed/*.test.mjs analysis/*.test.mjs measured/*.test.mjs probe/*.test.mjs   # no network, no key, no model (ABFB_TMP=<folder> to choose where the tests make their throwaway folders)
node capcheck/direct.mjs results               # the model alone, <= 6 requests
node capcheck/run-host.mjs qwen results <runsDir>   # <runsDir>: a folder OUTSIDE any checkout (throwaway HOMEs and repositories go in it)
```

Every run reads the day's quota first and stops at 40 used (the larger of the account's counter, which lags by minutes, and
the ledger). One host at a time; nothing synthetic on the CPU.

## What the first run found (details in `freeze/freeze.json` and `results/*/verdict.json`)

- The criterion had to learn how three hosts name an MCP call: Qwen Code defers the server's tools (`tool_search`, then a
  `tool_call` bridge that takes the real name); Codex groups them in a namespace (`mcp__mnema`) and a Responses stream names
  the model but not the provider (hence the generation lookup); Copilot and OpenCode prefix the name. The ceiling of 6 of the
  design counts CALLS TO MNEMA (the maintainer's ruling of 29 October): the host's own `tool_search` and any other tool of
  the host are counted apart (`discoveryCalls`, `otherHostCalls`) and the number of every kind is kept beside
  (`toolCallsCountingDiscovery`).
- A request costs 1 of the day's 50 on both wires (chat completions and Responses, streamed or not).
- OpenCode asks for a title from another model (`google/gemini-3.8-flash`); the relay refuses it, no request is spent.
- Codex 0.161.0 offers this model no `apply_patch`. Its plugin hooks do not run until they are trusted; `hosts/codex-trust.mjs`
  trusts them by configuration in the session's own home (`[hooks.state."<key>"] trusted_hash`), and `results/codex-hooks-trusted/`
  is the capability check again with that, no bypass flag, proved by `hook-proof.json` (the first request carries the output of the
  session-start hook, the first Codex run's did not).

## The runner, the edit check and the cost probe

```sh
node measured/run-session.mjs measured   <host> <resultsDir> <runsDir> --dry   # a scripted model against a fake OpenRouter: spends nothing
node measured/run-session.mjs edit-check <host> <resultsDir> <runsDir> --dry
node measured/run-session.mjs measured   <host> <resultsDir> <runsDir> --live  # the real thing: refuses unless the day has at least 24 requests left at the host's cost (a session sends at most 24; two fit a day)
node measured/run-session.mjs edit-check <host> <resultsDir> <runsDir> --live  # at most 6 requests (counted at the host's cost), the day's stop at 40
node probe/codex-cost.mjs <resultsDir> --dry --cost 2 --step-ms 40             # the same, 3 requests replayed
node probe/codex-cost.mjs <resultsDir> --live
node freeze/verify-prereg.mjs                                                   # a counted session does not start unless this exits 0
```

`<runsDir>` must be outside any git checkout. A dry run cannot open the real key file or write the real ledger (`assertApi`); a live one refuses to
start on a day that has no room, so a call on such a day spends nothing. `results/dry-runs/` holds what the dry runs with the real host binaries found.

## What the live part of 30 October found (`results/live-checks/summary.json`, `results/codex-cost/`, `results/<host>-edit-check/`)

- A Codex request costs 2 of the day (three replays of Codex's own request bodies moved the counter by exactly 2 each; the live Codex edit check spent 8 for
  4 requests); the other three hosts cost 1. By the maintainer's rule Codex is "does not fit the free quota".
- All four hosts can edit: Qwen Code, Copilot CLI, OpenCode and Codex each changed the one line asked and nothing else (Codex with its own sandbox on).
- The relay's own generation lookup, two seconds after an answer, always got 404; the runner now looks every request up again after the session, and a
  Responses stream (Codex) never names the provider, so this is its only provider check.
- Qwen Code runs a memory pass after its answer, a helper agent with a prompt of its own: the final message is the last answer of the agent's own loop.

## Codex without web search, and the second reader (the 4th step, 30 October)

- `hosts/adapters.mjs` writes `web_search = "disabled"` into the config.toml of Codex's own throwaway home when `measured/protocol.mjs` `CODEX_WEB_SEARCH` says `'disabled'`
  (the key is a top-level one of Codex 0.161.0; nothing else changes: the body Codex then sends has the same instructions, settings and 12 tools, the 13th, of type
  `web_search`, gone). That setting also decides which results the runner reads for Codex (`codexResultDirs`: `results/codex-cost-no-web-search`,
  `results/codex-edit-check-no-web-search`) and what an edit check is called. `probe/codex-cost.mjs --bodies-from <runDir>` replays the first three bodies of a Codex run
  and refuses to send a body whose tools do not match the setting. `results/codex-no-web-search-bodies/` is the dry run (scripted model, fake OpenRouter) that made them.
- The ledger line of a request now carries `units`, what that request costs the account (`relay` `unitsPerRequest`); the day is the larger of the account's counter and the
  ledger's units. The day used to be counted as the ledger's requests times the cost of the host about to run, which read the 30 October ledger (18 requests, 25 units on the
  account) as 36 of 40 and refused a probe the day had room for.
- `analysis/llm-reader.mjs`: the second reader of every read session is Claude Sonnet (`claude-sonnet-5-5`) through Claude Code on the maintainer's own subscription, ONE call per
  session. `node analysis/llm-reader.mjs command` prints the exact command, with `<CONFIG_DIR>` as a placeholder: the config directory whose login is the maintainer's is made later, by
  whoever runs the readers after the sessions and checks the account; this kit never logs in and never copies a credential. `run <sessionDir> --config-dir <dir>` makes the call in an
  empty folder outside any checkout, with an environment built from nothing, and writes `<sessionDir>/llm-reader.json` (model, Claude Code version, prompt and input hashes, the answer
  or why it was refused, CODE and the reader side by side). A second call for a session is refused.

## What the live part of the 4th step found (`results/codex-cost-no-web-search/`, `results/codex-edit-check-no-web-search/`, `results/live-checks/summary-step4.json`)

- Codex 0.161.0 configured with `web_search = "disabled"` sends bodies with 12 tools (the 13th, of type `web_search`, is gone) and the same instructions and settings
  (`results/codex-no-web-search-bodies/`, a dry run of the real Codex). Those bodies, replayed one at a time with the account's counter read before and after
  each, moved it 25 to 26 to 27 to 28: **a Codex request costs 1** without the tool, 2 with it. Codex enters the rounds without web search (said in the result and in the manifest).
  The folder of the first probe (`results/codex-cost/`, with the tool, 2 per request) stays as the evidence of the doubling.
- The edit check of Codex without web search: "edits" (the line asked changed and nothing else, the sandbox on), 5 requests, 5 units (counter 28 to 33), 22.6 s, every request served by Nvidia.
- The probe's three ledger lines say `units: 2` (the cost it was taken at until measured), so `ledgerUnits` reads the day as 36 where the account says 33.

## Not here yet

The catalog snapshot of the eve of the first counted session, the maintainer's acceptance of the pre-registration, and the measured sessions themselves.
`freeze/prereg.json` says so in `not_done_yet`.
