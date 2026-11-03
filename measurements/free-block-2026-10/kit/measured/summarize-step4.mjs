// Gathers what the LIVE part of the 4th step left (the Codex cost probe with web search disabled and, when the probe says Codex fits, the Codex edit check of that
// configuration) into ONE compact file for the manifest. It reads no key and makes no request: the counter's course is read off the runs' own records.
//   node measured/summarize-step4.mjs <resultsDir> <ranUnderCommit> > <resultsDir>/live-checks/summary-step4.json
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const [resultsDir, ranUnder] = process.argv.slice(2);
const kit = join(import.meta.dirname, '..');
const git = (...a) => execFileSync('git', a, { cwd: kit, encoding: 'utf8' }).trim();
const json = (...p) => JSON.parse(readFileSync(join(resultsDir, ...p), 'utf8'));
const tally = (records) => records.reduce((t, g) => ({ ...t, [`${g.model} | ${g.provider_name}`]: (t[`${g.model} | ${g.provider_name}`] ?? 0) + 1 }), {});

const probe = json('codex-cost-no-web-search', 'cost.json');
const probeOf = {
  requests: probe.requests_sent,
  web_search: probe.web_search,
  deltas: probe.steps.map((s) => s.delta),
  counter: probe.steps.map((s) => [s.counter_before, s.counter_after]),
  tools_in_each_body: probe.steps.map((s) => s.tools.length),
  any_body_offers_web_search: probe.steps.some((s) => s.offers_web_search),
  body_sha256: probe.steps.map((s) => s.body_sha256),
  conclusion: probe.conclusion,
  served_by_the_generation_records: tally(json('codex-cost-no-web-search', 'served-verified.json')),
  invalid: probe.invalid,
};
const dir = 'codex-edit-check-no-web-search';
let edit = null;
if (existsSync(join(resultsDir, dir, 'editcheck.json'))) {
  const meta = json(dir, 'meta.json');
  const outcome = json(dir, 'outcome.json');
  const verdict = json(dir, 'editcheck.json');
  edit = {
    host: 'codex',
    web_search: 'disabled',
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
    served_by_the_generation_records: tally(json(dir, 'served-verified.json')),
    key_scan: outcome.key_scan,
    prompt_sha256: json(dir, 'start.json').prompt_sha256,
    final_message_of_the_loop: verdict.final_message,
  };
}
const frozen = git('rev-parse', 'HEAD');
const files = git('diff', '--name-only', '--relative', ranUnder, frozen, '--', '.', ':!results', ':!freeze').split('\n').filter(Boolean);
console.log(
  JSON.stringify(
    {
      what: 'The LIVE part of the 4th step (30 October 2026): Codex configured without its web_search tool, 3 requests with the account\'s counter read before and after each, and, if it fits, its edit check; on nvidia/nemotron-3-ultra-550b-a55b:free, one host at a time, no counted session.',
      ran_under_kit_commit: ranUnder,
      code_files_changed_since_the_runs: files,
      day_counter: { start: probe.steps[0].counter_before, after_the_probe: probe.steps.at(-1).counter_after, after_the_edit_check: edit === null ? null : edit.account_counter_settled_after, stop_at: 40 },
      codex_cost_probe_without_web_search: probeOf,
      codex_edit_check_without_web_search: edit,
    },
    null,
    2,
  ),
);
