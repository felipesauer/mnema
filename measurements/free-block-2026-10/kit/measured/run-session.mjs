// The command line of the runner: ONE session of ONE host, a counted (measured) session or an edit check.
//
//   node measured/run-session.mjs <measured|edit-check> <host> <resultsDir> <runsDir> --dry [--scenario <name>] [--cost <n>] [--label <name>]
//   node measured/run-session.mjs <measured|edit-check> <host> <resultsDir> <runsDir> --live [--label <name>] [--allow-does-not-fit]
//
// `--dry` runs against a fake OpenRouter on the loopback with a SCRIPTED model, a made-up key file and a ledger of its own: it spends nothing
// and never opens the real key file. `--live` is the real thing and refuses to start unless the day has room (a counted session: the day's
// remaining at least 24 requests at the host's cost; an edit check: under the kit's stop at 40). <runsDir> must be OUTSIDE any checkout. One host at a time; the caller runs nothing
// synthetic on the CPU beside it.
//
// Scenarios of the scripted model (dry): obey (edits the JS side and the PHP side, says so), js-only (edits the JS side, says "Done."), asks
// (edits the JS side and asks about the PHP side), nothing (answers without editing), edit (edits the one line of the edit check).
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readSession } from '../analysis/labels.mjs';
import { judgeEdit, PROMPT as EDIT_PROMPT } from '../editcheck/edit-check.mjs';
import { kit, KIT } from '../lib/run-common.mjs';
import { NEUTRAL_PROMPT_FILE } from '../seed/make-parity-repo.mjs';
import { shellEditScript, startFakeUpstream } from './fake-upstream.mjs';
import { dryApi, liveApi, runSession } from './session.mjs';
import { codexResultDirs, defaultLabel, HOSTS } from './protocol.mjs';
import { JS_EDIT, PHP_EDIT, README_EDIT } from './test-support/commands.mjs';

/**
 * What the host's request costs the account: as measured by the Codex cost probe of its web search configuration when it was run (the folder
 * `codexResultDirs().cost`), 2 for Codex until then (what was seen), 1 for the others.
 */
export function costOf(host, resultsDir = join(KIT, 'results')) {
  if (host !== 'codex') return { cost: 1, source: 'seen on 29 October: 1 per request' };
  const dir = codexResultDirs().cost;
  try {
    const c = JSON.parse(readFileSync(join(resultsDir, dir, 'cost.json'), 'utf8')).conclusion;
    if (c !== null && c !== undefined) return { cost: c.cost_per_request, source: `results/${dir} (the probe)` };
  } catch {
    /* not measured yet */
  }
  return { cost: 2, source: `assumed from 29 October (8 for 4 requests); the probe of ${dir} has not been run` };
}

export const SCENARIOS = {
  obey: shellEditScript([JS_EDIT, PHP_EDIT], 'The JS and the PHP package now both accept the export prefix.'),
  'js-only': shellEditScript([JS_EDIT], 'Done.'),
  asks: shellEditScript([JS_EDIT], 'The JS package now accepts the export prefix. Should I make the same change in the PHP package?'),
  nothing: () => ({ text: 'I have not changed anything.' }),
  edit: shellEditScript([README_EDIT], 'Done.'),
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const opt = (name, fallback = null) => (args.includes(name) ? args.splice(args.indexOf(name), 2)[1] : fallback);
  const flag = (name) => (args.includes(name) ? (args.splice(args.indexOf(name), 1), true) : false);
  const scenario = opt('--scenario');
  const costArg = opt('--cost');
  const labelArg = opt('--label');
  const dry = flag('--dry');
  const live = flag('--live');
  const allowDoesNotFit = flag('--allow-does-not-fit');
  const [kind, host, resultsDir, runsDir] = args;
  if (!['measured', 'edit-check'].includes(kind) || !HOSTS.includes(host) || resultsDir === undefined || runsDir === undefined || dry === live) {
    console.error('usage: node measured/run-session.mjs <measured|edit-check> <host> <resultsDir> <runsDir> (--dry [--scenario <name>] [--cost <n>] | --live [--allow-does-not-fit]) [--label <name>]');
    process.exit(2);
  }
  const kitResults = join(KIT, 'results');
  const baseline = JSON.parse(readFileSync(join(kitResults, 'direct', 'meta.json'), 'utf8')).baseline;
  const measuredCost = costOf(host);
  const costPerRequest = costArg === null ? measuredCost.cost : Number(costArg);
  const prompt = kind === 'measured' ? readFileSync(NEUTRAL_PROMPT_FILE, 'utf8').trimEnd() : EDIT_PROMPT;
  let up = null;
  let api = liveApi();
  mkdirSync(resultsDir, { recursive: true });
  if (dry) {
    const keyFile = join(resultsDir, 'dry.key');
    writeFileSync(keyFile, 'sk-or-v1-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\n', { mode: 0o600 });
    const name = scenario ?? (kind === 'measured' ? 'obey' : 'edit');
    if (SCENARIOS[name] === undefined) {
      console.error(`no such scenario: ${name} (${Object.keys(SCENARIOS).join(', ')})`);
      process.exit(2);
    }
    up = await startFakeUpstream({ model: kit.model.id, provider: baseline.provider, cost: costPerRequest, lagMs: 200, stepMs: 150, script: SCENARIOS[name] });
    // A dry run starts a dry day of its own: its ledger is this run's, emptied first.
    const ledgerFile = join(resultsDir, `${labelArg ?? defaultLabel(host, kind)}.dry-ledger.jsonl`);
    rmSync(ledgerFile, { force: true });
    api = dryApi({ base: up.base, keyFile, ledgerFile });
  }
  const run = await runSession({ kind, host, resultsDir, runsDir, label: labelArg ?? defaultLabel(host, kind), prompt, judge: kind === 'measured' ? readSession : judgeEdit, api, baseline, costPerRequest, allowDoesNotFit, ...(dry ? { editCheck: 'passed', verifyIsAdvisory: true } : {}), pollMs: dry ? 100 : 30_000, settleMaxMs: dry ? 5_000 : 600_000, ...(dry ? { generationTries: 3, generationWaitMs: 20 } : {}) });
  if (up !== null) await up.close();
  const summary = run.started
    ? { started: true, served_verification: run.meta.served_verification, mode: api.mode, kind, host, label: labelArg ?? defaultLabel(host, kind), version: run.outcome.version, ended: run.outcome.ended, wall_ms: run.outcome.wall_ms, requests: run.meta.forwarded, refused_by_relay: run.meta.refusedLocally, cost_per_request: costPerRequest, cost_source: measuredCost.source, account_units_spent: run.meta.account_units_spent, key_scan_hits: run.keyScanHits, result: run.result }
    : { started: false, kind, host, ...run };
  summary.scenario = dry ? (scenario ?? (kind === 'measured' ? 'obey' : 'edit')) : null;
  if (run.started) writeFileSync(join(run.dir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(join(resultsDir, `${labelArg ?? defaultLabel(host, kind)}.summary.json`), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
  process.exit(run.started ? 0 : 1);
}
