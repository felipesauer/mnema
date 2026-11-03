// THE CODEX COST PROBE (the maintainer's call of 29 October, observation 01a1899b-87e6): Codex seemed to cost 2 of the day's 50 per request sent
// (the account's counter moved by 8 for each of the two Codex runs of 4 requests; it moved by 1 for each request of the other three hosts and of
// the two single-request probes). A test of 3 requests, on a day with no other use, decides. If a Codex request costs 2, Codex is reported as
// "does not fit the free quota" (a session of about 40 requests is 80 units), keeping one session per day.
//
// What is sent: the first three request bodies of the recorded Codex run (results/codex-hooks-trusted), REPLAYED through the relay, one at a time.
// The relay forwards only the body of a host's request (it sets its own headers), so a replayed body is, to OpenRouter, the request Codex sent;
// and replaying lets the probe wait, between requests, for the account's counter, which lags by minutes and moves in steps, to stand still:
// a live Codex would not wait for it. The counter is read before each request (once it has stood still) and after it (once it has moved and
// stood still again, over `stableReads` reads). If the replayed bodies cost 1 each, the doubling is not in the bytes Codex sends, and the first
// live Codex session (the edit check, at its 3 requests) is what shows it.
//
// THE WEB SEARCH TEST (the maintainer's call of 30 October, observation 01a18ab5-a181): the first probe measured 2 with a tool of type web_search
// among the 13 the body offers, which no other host sends. The test is the same probe on the bodies Codex sends when it is configured without
// that tool (`web_search = "disabled"`, hosts/adapters.mjs): the three bodies come from a dry run of the real Codex with that configuration
// (`--bodies-from <runDir>`, a run folder with a wire), the probe refuses to send a body that carries a web_search tool, and the result
// records the tools of each body it sent. A cost of 1: Codex enters the rounds without web search (said in the result and the manifest); 2: it
// stays "does not fit the free quota".
//
//   node probe/codex-cost.mjs <resultsDir> --dry [--cost 2] [--lag-ms 3000] [--step-ms 1500] [--bodies-from <runDir>]   against a fake OpenRouter: spends nothing
//   node probe/codex-cost.mjs <resultsDir> --live [--bodies-from <runDir>]                                             the real one: refuses unless the day has room
import { createReadStream, createWriteStream, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { kit, readWireGz } from '../lib/run-common.mjs';
import { startRelay } from '../relay/relay.mjs';
import { assertApi, dayFacts, dryApi, liveApi, settleCounter } from '../measured/session.mjs';
import { CODEX_WEB_SEARCH, codexResultDirs, COST_PROBE_REQUESTS, DOES_NOT_FIT, fitsTheFreeQuota, STOP_AT_USED } from '../measured/protocol.mjs';

const sha = (text) => createHash('sha256').update(text).digest('hex');

/** The request bodies to replay: the first `n` forwarded requests of a recorded Codex run. */
export function recordedBodies(resultsDir, run = 'codex-hooks-trusted', n = COST_PROBE_REQUESTS) {
  const bodies = readWireGz(join(resultsDir, run))
    .filter((r) => r.forwarded === true && r.path === '/responses')
    .slice(0, n)
    .map((r) => r.request);
  if (bodies.length < n) throw new Error(`${run} holds ${bodies.length} Responses requests, ${n} needed`);
  return bodies;
}

/** The tools a request body offers, by type and name: what the probe records for each body it sends. */
export function toolsOf(body) {
  return (body.tools ?? []).map((t) => (t.type === 'function' ? `function:${t.name}` : t.type === 'namespace' ? `namespace:${t.name}` : t.type));
}

/** Whether a body offers the model a web search tool. */
export function offersWebSearch(body) {
  return (body.tools ?? []).some((t) => typeof t?.type === 'string' && t.type.startsWith('web_search'));
}

/** What the deltas mean: one cost per request when they agree, the larger when they do not (so that the day is never under-counted). */
export function conclude(deltas) {
  const consistent = deltas.length > 0 && deltas.every((d) => d === deltas[0]);
  const cost = Math.max(...deltas);
  return { deltas, consistent, cost_per_request: cost, fits_the_free_quota: fitsTheFreeQuota(cost), label: fitsTheFreeQuota(cost) ? null : DOES_NOT_FIT };
}

export async function probeCodexCost({ api, bodies, baseline, resultsDir, label = codexResultDirs().cost, webSearch = CODEX_WEB_SEARCH, bodiesFrom = null, now = () => new Date(), pollMs = 30_000, settleMaxMs = 540_000, stableReads = 4 }) {
  assertApi(api);
  const requests = bodies.length;
  // The configuration under test is the bodies': a body with a web_search tool is never sent as "without web search", nor one without it as "with".
  const wrong = bodies.map((b, i) => [i + 1, offersWebSearch(b)]).filter(([, has]) => has !== (webSearch !== 'disabled'));
  if (wrong.length > 0) return { started: false, label: 'bodies_not_the_configuration', reasons: [`web search is '${webSearch}' but body ${wrong.map(([i]) => i).join(', ')} ${webSearch === 'disabled' ? 'offers a web_search tool' : 'offers none'}; nothing was sent`] };
  // Until it is measured, a Codex request is taken at the cost it seemed to have: 2.
  const before = await dayFacts({ api, now: now() });
  if (before.status !== 200 || before.limit === null) return { started: false, label: 'account_not_expected', reasons: [`the quota could not be read (status ${before.status})`] };
  if (before.isFreeTier !== true) return { started: false, label: 'account_not_expected', reasons: ['the key is not on the free tier'] };
  if (before.used + requests * 2 > STOP_AT_USED) return { started: false, label: 'the_day_has_no_room', reasons: [`${before.used} of ${before.limit} used today (account ${before.apiUsed}, ledger ${before.ledgerRequests}); ${requests} requests at up to 2 each would pass the stop at ${STOP_AT_USED}`] };

  const dir = join(resultsDir, label);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const wireFile = join(dir, 'wire.jsonl');
  writeFileSync(wireFile, '');
  const lines = [];
  const relay = await startRelay({ model: kit.model.id, providerTag: kit.model.provider_tag, upstream: api.base, keyFile: api.keyFile, maxRequests: requests, wireFile, ledgerFile: api.ledgerFile, unitsPerRequest: 2, verifyGeneration: true, expectServed: baseline, onLine: (l) => lines.push(`${new Date().toISOString()} ${l}`) });
  const steps = [];
  try {
    let standing = await settleCounter({ api, atLeast: before.apiUsed ?? 0, pollMs, maxMs: settleMaxMs, stableReads });
    for (const [i, body] of bodies.entries()) {
      const counterBefore = standing.used;
      const res = await fetch(`${relay.url}/responses`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer not-a-key' }, body: JSON.stringify(body) });
      await res.text();
      await relay.settled().catch(() => {});
      standing = await settleCounter({ api, atLeast: (counterBefore ?? 0) + 1, pollMs, maxMs: settleMaxMs, stableReads });
      steps.push({ request: i + 1, body_sha256: sha(JSON.stringify(body)), tools: toolsOf(body), offers_web_search: offersWebSearch(body), http_status: res.status, counter_before: counterBefore, counter_after: standing.used, delta: standing.used === null || counterBefore === null ? null : standing.used - counterBefore, settled: standing.settled, polls: standing.polls });
    }
  } finally {
    await relay.settled().catch(() => {});
    await relay.close();
  }
  const unsettled = steps.some((s) => s.delta === null || !s.settled || s.http_status !== 200);
  const result = {
    kind: 'codex-cost-probe',
    web_search: webSearch === 'disabled' ? 'disabled (web_search = "disabled" in the config.toml of Codex; no web_search tool in any body sent)' : 'default (Codex offers its web_search tool)',
    mode: api.mode,
    at: new Date().toISOString(),
    requests_sent: relay.state.forwarded,
    served: relay.state.served,
    invalid: relay.state.invalid,
    steps,
    ...(unsettled ? { conclusion: null, why_not: 'a request was not answered with 200, or the counter did not move and stand still within the wait: nothing is concluded' } : { conclusion: conclude(steps.map((s) => s.delta)) }),
    bodies: bodiesFrom === null ? 'the first three request bodies of results/codex-hooks-trusted, replayed through the relay (see the top of probe/codex-cost.mjs)' : `the first three request bodies of ${bodiesFrom}, replayed through the relay (see the top of probe/codex-cost.mjs)`,
  };
  writeFileSync(join(dir, 'cost.json'), `${JSON.stringify(result, null, 2)}\n`);
  writeFileSync(join(dir, 'relay.log'), `${lines.join('\n')}\n`);
  await pipeline(createReadStream(wireFile), createGzip(), createWriteStream(`${wireFile}.gz`));
  rmSync(wireFile);
  return { started: true, dir, result };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const flag = (name) => args.includes(name);
  const opt = (name, fallback) => (args.includes(name) ? Number(args[args.indexOf(name) + 1]) : fallback);
  const from = args.includes('--bodies-from') ? args[args.indexOf('--bodies-from') + 1] : null;
  const resultsDir = args.find((a) => !a.startsWith('--') && Number.isNaN(Number(a)) && a !== from);
  if (resultsDir === undefined || flag('--dry') === flag('--live')) {
    console.error('usage: node probe/codex-cost.mjs <resultsDir> (--dry [--cost n] [--lag-ms n] [--step-ms n] | --live) [--bodies-from <runDir>]');
    process.exit(2);
  }
  const kitResults = join(import.meta.dirname, '..', 'results');
  const bodies = from === null ? recordedBodies(kitResults) : recordedBodies(dirname(resolve(from)), basename(resolve(from)));
  const baseline = JSON.parse((await import('node:fs')).readFileSync(join(kitResults, 'direct', 'meta.json'), 'utf8')).baseline;
  let up = null;
  let api = liveApi();
  if (flag('--dry')) {
    const { startFakeUpstream } = await import('../measured/fake-upstream.mjs');
    const keyFile = join(resultsDir, 'dry.key');
    mkdirSync(resultsDir, { recursive: true });
    writeFileSync(keyFile, 'sk-or-v1-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\n', { mode: 0o600 });
    up = await startFakeUpstream({ model: kit.model.id, provider: baseline.provider, cost: opt('--cost', 1), lagMs: opt('--lag-ms', 0), stepMs: opt('--step-ms', 0), script: () => ({ text: 'ok' }) });
    api = dryApi({ base: up.base, keyFile, ledgerFile: join(resultsDir, 'dry-ledger.jsonl') });
  }
  const run = await probeCodexCost({ api, bodies, baseline, resultsDir, ...(from === null ? {} : { bodiesFrom: from }), pollMs: flag('--dry') ? 20 : 30_000, settleMaxMs: flag('--dry') ? 20_000 : 540_000 });
  if (up !== null) await up.close();
  console.log(JSON.stringify(run.started ? run.result : run, null, 2));
}
