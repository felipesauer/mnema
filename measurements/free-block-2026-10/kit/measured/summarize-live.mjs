// Gathers what the LIVE part left (the Codex cost probe and the edit check of each host) into ONE compact file for the manifest. It reads no key
// and makes no request: the counter's course is read off the runs' own records (what each saw before, and settled after).
//   node measured/summarize-live.mjs <resultsDir> <ranUnderCommit> > <resultsDir>/live-checks/summary.json
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const [resultsDir, ranUnder] = process.argv.slice(2);
const kit = join(import.meta.dirname, '..');
const git = (...a) => execFileSync('git', a, { cwd: kit, encoding: 'utf8' }).trim();
const json = (...p) => JSON.parse(readFileSync(join(resultsDir, ...p), 'utf8'));
const tally = (records) => records.reduce((t, g) => ({ ...t, [`${g.model} | ${g.provider_name}`]: (t[`${g.model} | ${g.provider_name}`] ?? 0) + 1 }), {});

const probe = json('codex-cost', 'cost.json');
const verifiedOf = (dir) => tally(json(dir, 'served-verified.json'));
const hosts = ['qwen', 'copilot', 'opencode', 'codex'];
const checks = hosts.map((h) => {
  const dir = `${h}-edit-check`;
  const meta = json(dir, 'meta.json');
  const outcome = json(dir, 'outcome.json');
  const start = json(dir, 'start.json');
  const verdict = json(dir, 'editcheck.json');
  return {
    host: h,
    version: outcome.version,
    at: meta.at,
    label: verdict.label,
    passes: verdict.verdict,
    changed_files: verdict.changed_files,
    ended: outcome.ended,
    wall_ms: outcome.wall_ms,
    budget_requests: meta.budget_requests,
    requests: meta.forwarded,
    refused_by_relay: meta.refusedLocally,
    cost_per_request_measured: meta.cost_per_request_measured,
    account_units_spent: meta.account_units_spent,
    account_counter_before: meta.quota_before.apiUsed,
    account_counter_settled_after: meta.quota_after.account_used_when_settled,
    served_by_the_stream: meta.served,
    served_by_the_generation_records: verifiedOf(dir),
    key_scan: outcome.key_scan,
    prompt_sha256: start.prompt_sha256,
    final_message_of_the_loop: verdict.final_message,
  };
});
// The code the runs ran under is not always the code that is frozen afterwards: the files that differ between the two are listed.
const frozen = git('rev-parse', 'HEAD');
const files = git('diff', '--name-only', '--relative', ranUnder, frozen, '--', '.', ':!results', ':!freeze').split('\n').filter(Boolean);
console.log(
  JSON.stringify(
    {
      what: 'The LIVE part of 30 October 2026: the Codex cost probe (3 requests) and the edit check of each host, on nvidia/nemotron-3-ultra-550b-a55b:free, in that order, one host at a time, no counted session.',
      ran_under_kit_commit: ranUnder,
      code_files_changed_since_the_runs: files,
      day_counter: { start: probe.steps[0].counter_before, after_the_probe: probe.steps.at(-1).counter_after, after_each_edit_check: Object.fromEntries(checks.map((c) => [c.host, c.account_counter_settled_after])), stop_at: 40 },
      codex_cost_probe: { requests: probe.requests_sent, deltas: probe.steps.map((s) => s.delta), conclusion: probe.conclusion, served_by_the_generation_records: verifiedOf('codex-cost'), invalid: probe.invalid },
      edit_checks: checks,
    },
    null,
    2,
  ),
);
