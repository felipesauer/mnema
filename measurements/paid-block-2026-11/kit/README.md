# ab-paid-block: the kit of the paid block of the comparison after 0.1.4 (block 2.1 of ADR-119)

Private. Claude Code 2.1.311 (Sonnet 5.5, xhigh) on the maintainer's PERSONAL account (its login, copied in and back per session), on the **Pro subscription, never on the API**. Four arms (A rules in
CLAUDE.md, A-agentsmd, B mnema 0.1.4 whole, C no plugin), size S+Q4 as ADR-175 settled it (49 sessions: the AGENTS.md arm joins the neutral parity cell at ten repetitions; two stages a week apart, parity first, then D and Q; the one fallback is D at one repetition if the smoke measures a Pro week below 27.5 USD-equivalent). No counted session has run; the smoke sessions have not run (the token is not in place).

## What the maintainer does

The credential is the LOGIN of the personal Pro account in `secrets/login` (a config folder of the kit; already made with `claude auth login`).

```sh
cd /home/[USER]/Documents/Personal/Me/.projects/.[PRIVATE]/mnema/ab-paid-block
./install.sh                          # once
node account/enroll.mjs from-login    # hashes of the account and the plan name, from the login's own files; no API call
node account/enroll.mjs forbid <sha256>   # optional: the ACCOUNT hash of an account the block must never run on
node account/enroll.mjs check         # {"ok":true,"reason":"match"}
```
`secrets/claude-oauth.token` (the dropped setup-token) is never read; the maintainer deletes it. Use the account for nothing else while the block runs
(the room rule assumes it). Then tell the orchestrator; it runs `node smoke/smoke.mjs <runsDir> --live`.

## Layout

| Path | What |
|---|---|
| `kit.json`, `install.sh` | the pins (Claude Code binary sha256, mnema 0.1.4, tag v0.1.4) |
| `lib/login.mjs` | the credential: copy-in of the login's two files, copy-back of a refreshed one, the lock, identity as hashes |
| `lib/token.mjs` | `holdsToken`, `scanFolder` (numbers only) |
| `lib/subscription.mjs` | the subscription-only enforcement: forbidden environment, settings, offline `claude auth status`, proof from the stream |
| `lib/quota.mjs` | rate_limit_event windows, `wasCut`, the ledger, the window size, the room rule (with a cost fallback) |
| `lib/redact.mjs` | the redactor and `redactFolder` (ADR-166/167) |
| `account/` | the account check (from the login's files) and `enroll.mjs` |
| `contain/` | bubblewrap argv, the allow-list proxy, `netbridge.py` (unchanged from the 27 October kits) |
| `session/` | `protocol.mjs`, `session.mjs` (one session), `fake-anthropic.mjs` (the fake model endpoint for dry runs) |
| `seed/` | the synthetic parity repository per arm; `build-real-bases.sh` for the two real repositories |
| `plan/` | `cells.mjs`, `pro.mjs`, `budget.mjs`, `calibration.json` |
| `smoke/` | the 3 uncounted capability sessions |
| `analysis/` | the CODE readers (`labels.mjs` for the parity sessions, `q-readers.mjs` for Q1 to Q3), the stream reader and the second (LLM) reader with its prompt; fixed by hash in the manifest before the first counted session; `node analysis/read27.mjs` runs them on the 27 October streams |
| `freeze/` | `make-prereg.mjs`, `verify-prereg.mjs`, `prereg.json` |
| `legacy/`, `legacy-provenance.json`, `tasks/prompts/` | files copied unedited from the 27 October kits, with the sha256 of each |

## Tests (no network, no token, no model)

```sh
ABP_TMP=<folder> node --test --test-force-exit --test-concurrency=1 lib/*.test.mjs account/*.test.mjs contain/*.test.mjs plan/*.test.mjs analysis/*.test.mjs freeze/freeze.test.mjs session/*.test.mjs smoke/*.test.mjs
node plan/budget.mjs        # the schedule and the cuts
node freeze/verify-prereg.mjs
```
The session tests run the pinned Claude Code binary inside bubblewrap against a fake endpoint over the bridge (no network namespace is shared).
Heavy runs go behind `flock <suite.lock> systemd-run --user --scope -p MemoryMax=4G -p CPUQuota=200%`.
