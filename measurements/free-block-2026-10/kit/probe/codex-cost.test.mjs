// Tests of the Codex cost probe against the fake OpenRouter: it spends nothing, reads the counter before and after each of the 3 requests,
// waits for a counter that lags and moves in steps, and applies the maintainer's rule. No key, no model, no network beyond 127.0.0.1.
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { kit } from '../lib/run-common.mjs';
import { startFakeUpstream } from '../measured/fake-upstream.mjs';
import { dryApi } from '../measured/session.mjs';
import { DOES_NOT_FIT } from '../measured/protocol.mjs';
import { conclude, offersWebSearch, probeCodexCost, recordedBodies, toolsOf } from './codex-cost.mjs';

const TMP = process.env.ABFB_TMP ?? tmpdir();
const RESULTS = join(import.meta.dirname, '..', 'results');
const baseline = { model: kit.model.id, provider: 'Nvidia' };
const bodies = recordedBodies(RESULTS);
// The same three bodies without the web_search tool: what a Codex configured with `web_search = "disabled"` sends (the tools are otherwise the same).
const bodiesWithoutWebSearch = bodies.map((b) => ({ ...b, tools: b.tools.filter((t) => t.type !== 'web_search') }));
const roots = [];
const upstreams = [];
after(async () => {
  for (const u of upstreams) await u.close().catch(() => {});
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

async function run(fake, extra = {}) {
  const root = mkdtempSync(join(TMP, 'abfb-probe-'));
  roots.push(root);
  const keyFile = join(root, 'dry.key');
  writeFileSync(keyFile, 'sk-or-v1-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\n');
  const up = await startFakeUpstream({ model: kit.model.id, provider: 'Nvidia', script: () => ({ text: 'ok' }), ...fake });
  upstreams.push(up);
  const api = dryApi({ base: up.base, keyFile, ledgerFile: join(root, 'ledger.jsonl') });
  // The recorded bodies offer a web_search tool, so unless a test says otherwise the probe runs in the 'default' configuration they belong to.
  const r = await probeCodexCost({ api, bodies, baseline, webSearch: 'default', label: 'codex-cost', resultsDir: join(root, 'results'), pollMs: 8, settleMaxMs: 1500, stableReads: 12, ...extra });
  return { r, up, api, root };
}

test('the bodies replayed are the first three Responses requests of the recorded Codex run, on the fixed model', () => {
  assert.equal(bodies.length, 3);
  for (const b of bodies) {
    assert.equal(b.model, kit.model.id);
    assert.equal(b.stream, true);
    assert.ok(Array.isArray(b.input) && Array.isArray(b.tools));
  }
});

test('the rule: a Codex request that costs 2 of the day is "does not fit the free quota"; 1 fits; an inconsistent probe takes the larger cost', () => {
  assert.deepEqual(conclude([2, 2, 2]), { deltas: [2, 2, 2], consistent: true, cost_per_request: 2, fits_the_free_quota: false, label: DOES_NOT_FIT });
  assert.deepEqual(conclude([1, 1, 1]), { deltas: [1, 1, 1], consistent: true, cost_per_request: 1, fits_the_free_quota: true, label: null });
  const mixed = conclude([1, 2, 1]);
  assert.equal(mixed.consistent, false);
  assert.equal(mixed.cost_per_request, 2);
  assert.equal(mixed.label, DOES_NOT_FIT);
});

test('3 requests at a cost of 2, on a counter that lags and moves in steps: each delta is 2 and Codex does not fit', async () => {
  const { r, up, api } = await run({ cost: 2, lagMs: 25, stepMs: 40 });
  assert.equal(r.started, true);
  assert.equal(r.result.requests_sent, 3);
  assert.equal(up.seen.length, 3, 'exactly 3 requests reached the (fake) service');
  assert.deepEqual(r.result.steps.map((s) => [s.counter_before, s.counter_after, s.delta]), [[0, 2, 2], [2, 4, 2], [4, 6, 2]]);
  assert.deepEqual(r.result.conclusion, { deltas: [2, 2, 2], consistent: true, cost_per_request: 2, fits_the_free_quota: false, label: DOES_NOT_FIT });
  assert.equal(readFileSync(api.ledgerFile, 'utf8').split('\n').filter(Boolean).length, 3);
  assert.ok(r.result.steps.every((s) => s.body_sha256.length === 64 && s.http_status === 200));
  assert.deepEqual(up.seen.map((s) => s.body.provider), Array(3).fill({ order: ['nvidia'], allow_fallbacks: false }));
});

test('3 requests at a cost of 1: Codex fits and carries no label', async () => {
  const { r } = await run({ cost: 1, lagMs: 20 });
  assert.deepEqual(r.result.conclusion.deltas, [1, 1, 1]);
  assert.equal(r.result.conclusion.fits_the_free_quota, true);
  assert.equal(r.result.conclusion.label, null);
});

test('a counter read too early, in the middle of a step, would say 1: the reads must stand still long enough to be trusted', async () => {
  const early = await run({ cost: 2, stepMs: 200 }, { pollMs: 5, stableReads: 1 });
  assert.equal(early.r.result.conclusion.cost_per_request, 1, 'the guard: a single read after the first step is the wrong answer');
  const patient = await run({ cost: 2, stepMs: 200 }, { pollMs: 10, stableReads: 40, settleMaxMs: 4000 });
  assert.equal(patient.r.result.conclusion.cost_per_request, 2);
});

test('a counter that never moves concludes nothing', async () => {
  const { r } = await run({ cost: 0 }, { settleMaxMs: 150, stableReads: 3 });
  assert.equal(r.result.conclusion, null);
  assert.match(r.result.why_not, /nothing is concluded/);
});

test('it does not start where 3 requests at 2 would pass the stop at 40, and sends nothing', async () => {
  const root = mkdtempSync(join(TMP, 'abfb-probe-'));
  roots.push(root);
  const { r, up } = await run({ startUsed: 36 });
  assert.equal(r.started, false);
  assert.equal(r.label, 'the_day_has_no_room');
  assert.equal(up.seen.length, 0);
  const free = await run({ freeTier: false });
  assert.equal(free.r.label, 'account_not_expected');
  assert.equal(free.up.seen.length, 0);
});

test('a provider other than the baseline marks the probe invalid, and says so', async () => {
  const { r } = await run({ provider: 'SomeoneElse', cost: 1 });
  assert.match(r.result.invalid.reason, /SomeoneElse/);
});

// ---- the web search test (30 October: does the doubling come from the web_search tool only Codex offers?) ---------------------------------------
test('the recorded bodies offer a web_search tool and the same bodies without it offer none, the other tools unchanged', () => {
  assert.ok(bodies.every(offersWebSearch));
  assert.ok(bodiesWithoutWebSearch.every((b) => !offersWebSearch(b)));
  assert.equal(toolsOf(bodies[0]).length, 13);
  assert.deepEqual(toolsOf(bodiesWithoutWebSearch[0]), toolsOf(bodies[0]).filter((t) => t !== 'web_search'));
});

test('web search disabled: 3 bodies without the tool at a cost of 1 fit the quota, and the result records the tools of each body it sent', async () => {
  const { r, up } = await run({ cost: 1, lagMs: 20 }, { webSearch: 'disabled', bodies: bodiesWithoutWebSearch, label: 'codex-cost-no-web-search' });
  assert.equal(r.started, true);
  assert.deepEqual(r.result.conclusion.deltas, [1, 1, 1]);
  assert.equal(r.result.conclusion.fits_the_free_quota, true);
  assert.equal(r.result.conclusion.label, null);
  assert.ok(r.result.steps.every((s) => s.offers_web_search === false && s.tools.length === 12 && !s.tools.includes('web_search')));
  assert.match(r.result.web_search, /^disabled/);
  assert.ok(up.seen.every((s) => !offersWebSearch(s.body)), 'no body that reached the (fake) service offers a web_search tool');
});

test('web search disabled and still 2 per request: Codex stays "does not fit the free quota"', async () => {
  const { r } = await run({ cost: 2, lagMs: 20 }, { webSearch: 'disabled', bodies: bodiesWithoutWebSearch });
  assert.deepEqual(r.result.conclusion.deltas, [2, 2, 2]);
  assert.equal(r.result.conclusion.label, DOES_NOT_FIT);
});

test('a body that does not match the configuration is never sent: with the tool when it is disabled, without it when it is not', async () => {
  const withTool = await run({ cost: 1 }, { webSearch: 'disabled' });
  assert.equal(withTool.r.started, false);
  assert.equal(withTool.r.label, 'bodies_not_the_configuration');
  assert.equal(withTool.up.seen.length, 0);
  const without = await run({ cost: 1 }, { webSearch: 'default', bodies: bodiesWithoutWebSearch });
  assert.equal(without.r.started, false);
  assert.equal(without.up.seen.length, 0);
});

test('each ledger line of the probe says what the request was taken to cost (2 until it is measured)', async () => {
  const { api } = await run({ cost: 1 }, { webSearch: 'disabled', bodies: bodiesWithoutWebSearch });
  const lines = readFileSync(api.ledgerFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => l.units), [2, 2, 2]);
});

test('the probe starts on a day where 18 requests of three hosts and Codex already cost 25 units (the ledger used to read it as 36 of 40)', async () => {
  // The state of 30 October after the live part: 3 Codex probe requests (2 each), 11 requests of the other three hosts (1 each), 4 Codex requests (2 each).
  const root = mkdtempSync(join(TMP, 'abfb-probe-'));
  roots.push(root);
  const ledgerFile = join(root, 'ledger.jsonl');
  const now = new Date().toISOString();
  const legacy = (path, n) => Array.from({ length: n }, (_, i) => `${JSON.stringify({ t: now, seq: i + 1, path })}\n`).join('');
  appendFileSync(ledgerFile, legacy('/responses', 3) + legacy('/chat/completions', 11) + legacy('/responses', 4));
  const keyFile = join(root, 'dry.key');
  writeFileSync(keyFile, 'sk-or-v1-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\n');
  const up = await startFakeUpstream({ model: kit.model.id, provider: 'Nvidia', startUsed: 25, cost: 1, script: () => ({ text: 'ok' }) });
  upstreams.push(up);
  const api = dryApi({ base: up.base, keyFile, ledgerFile });
  const r = await probeCodexCost({ api, bodies: bodiesWithoutWebSearch, baseline, webSearch: 'disabled', resultsDir: join(root, 'results'), pollMs: 8, settleMaxMs: 1500, stableReads: 12 });
  assert.equal(r.started, true, JSON.stringify(r));
  assert.equal(r.result.steps[0].counter_before, 25);
});
