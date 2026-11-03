// Tests of the protocol as data: the argv of each host (and that it is the one the verified adapters give), the limits, the window before
// 00:00 UTC, the budget in the account's units, the rule for the cost. Pure: no model, no key, no network.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { adapters } from '../hosts/adapters.mjs';
import { kit, KIT, readWireGz } from '../lib/run-common.mjs';
import { argvFor, argvTemplate, binaryArgs, CODEX_WEB_SEARCH, codexResultDirs, defaultLabel, DOES_NOT_FIT, EDIT_CHECK_MAX_REQUESTS, ENDINGS, fitsTheFreeQuota, HOSTS, isDailyLimit, MIN_BEFORE_MIDNIGHT_MS, msToMidnightUtc, relayBudget, SESSION_MAX_REQUESTS, startWindow, STOP_AT_USED, WALL_CLOCK_MS } from './protocol.mjs';

const PROMPT = 'Make `EnvAccessor` accept lines written as `export KEY=value`.';

test('the limits are the maintainer\'s: 30 minutes of wall clock, a start 35 minutes before 00:00 UTC, an edit check of at most 6, the stop at 40', () => {
  assert.equal(WALL_CLOCK_MS, 30 * 60 * 1000);
  assert.equal(MIN_BEFORE_MIDNIGHT_MS, 35 * 60 * 1000);
  assert.equal(EDIT_CHECK_MAX_REQUESTS, 6);
  assert.equal(SESSION_MAX_REQUESTS, 24);
  assert.equal(relayBudget({ units: SESSION_MAX_REQUESTS * 1, costPerRequest: 1 }), 24);
  assert.equal(STOP_AT_USED, kit.daily.stop_at_used);
  assert.deepEqual(HOSTS, kit.capability_order);
});

test('the argv of each host is the manifest\'s, with the prompt and the model put in', () => {
  assert.deepEqual(argvFor('qwen', PROMPT, 'm/x:free'), ['qwen', '-p', PROMPT, '--approval-mode', 'yolo', '-m', 'm/x:free']);
  assert.deepEqual(argvFor('copilot', PROMPT, 'm/x:free'), ['copilot', '-p', PROMPT, '--allow-all', '--no-color']);
  assert.deepEqual(argvFor('opencode', PROMPT, 'm/x:free'), ['opencode', 'run', PROMPT]);
  assert.deepEqual(argvFor('codex', PROMPT, 'm/x:free'), ['codex', 'exec', '--json', '--sandbox', 'workspace-write', '-c', 'approval_policy="never"', '--skip-git-repo-check', PROMPT]);
  assert.deepEqual(binaryArgs('opencode', PROMPT, 'm'), ['run', PROMPT]);
  assert.throws(() => argvFor('gemini', PROMPT, 'm'), /no such host/);
  for (const h of HOSTS) assert.equal(argvTemplate(h).filter((a) => a === '<neutral prompt>').length, 1, `${h}: the prompt is given once`);
});

test('no host gets a flag that bypasses its sandbox or the trust of hooks', () => {
  for (const h of HOSTS) assert.ok(!argvFor(h, PROMPT, 'm').some((a) => /dangerously|bypass/.test(a)), h);
  assert.ok(argvFor('codex', PROMPT, 'm').includes('workspace-write'), 'Codex\'s own sandbox is ON, writable in the working tree');
});

const roots = [];
after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});
test('the argv equals what the adapters give (checked with real folders)', async () => {
  const { mkdirSync } = await import('node:fs');
  for (const h of HOSTS) {
    const root = mkdtempSync(join(process.env.ABFB_TMP ?? tmpdir(), 'abfb-argv-'));
    roots.push(root);
    const box = { root, home: join(root, 'home'), project: join(root, 'project') };
    mkdirSync(box.home, { recursive: true });
    mkdirSync(box.project, { recursive: true });
    const setup = adapters[h].prepare({ box, relayUrl: 'http://127.0.0.1:1/v1', model: kit.model, pluginDir: join(KIT, 'plugin-tag'), opencodeVersion: kit.hosts.opencode.version, pluginVersion: kit.mnema.version });
    const fromAdapter = setup.run(PROMPT);
    const mine = binaryArgs(h, PROMPT, kit.model.id);
    if (h === 'codex') assert.deepEqual(fromAdapter.map((a) => (a === 'read-only' ? 'workspace-write' : a)), mine, 'only the sandbox differs');
    else assert.deepEqual(fromAdapter, mine, h);
  }
});

test('the start window: 35 minutes before 00:00 UTC, to the second', () => {
  assert.equal(msToMidnightUtc(new Date('2026-10-30T23:25:00Z')), 35 * 60 * 1000);
  assert.equal(startWindow(new Date('2026-10-30T23:25:00Z')).ok, true);
  assert.equal(startWindow(new Date('2026-10-30T23:25:01Z')).ok, false);
  assert.equal(startWindow(new Date('2026-10-30T00:00:00Z')).ok, true);
  assert.equal(msToMidnightUtc(new Date('2026-12-31T23:59:59Z')), 1000, 'across a year');
  assert.match(startWindow(new Date('2026-10-30T23:50:00Z')).reason, /10 minutes to 00:00 UTC/);
});

test('the budget is the units divided by what one request costs, rounded down', () => {
  assert.equal(relayBudget({ units: 50, costPerRequest: 1 }), 50);
  assert.equal(relayBudget({ units: 50, costPerRequest: 2 }), 25);
  assert.equal(relayBudget({ units: 6, costPerRequest: 2 }), 3);
  assert.equal(relayBudget({ units: 5, costPerRequest: 2 }), 2);
  assert.equal(relayBudget({ units: 1, costPerRequest: 2 }), 0);
  assert.throws(() => relayBudget({ units: 6, costPerRequest: 0 }), /cost per request/);
  assert.throws(() => relayBudget({ units: -1, costPerRequest: 1 }), /units/);
});

test('the maintainer\'s rule for Codex: a cost of 2 means "does not fit the free quota"', () => {
  assert.equal(fitsTheFreeQuota(1), true);
  assert.equal(fitsTheFreeQuota(2), false);
  assert.equal(DOES_NOT_FIT, 'does not fit the free quota');
});

test('a 429 is the day\'s limit when it says so, and an isolated per-minute 429 is not', () => {
  assert.equal(isDailyLimit('Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day'), true);
  assert.equal(isDailyLimit('{"error":{"message":"Rate limit exceeded: too many requests per minute"}}'), false);
  assert.equal(isDailyLimit(undefined), false);
});

test('every way a session can end has a reading: read, did not finish, or discarded', () => {
  assert.deepEqual(Object.keys(ENDINGS).sort(), ['budget', 'cut', 'daily_limit', 'exited', 'invalid', 'midnight', 'timeout']);
  assert.equal(ENDINGS.exited.read, true);
  for (const [k, v] of Object.entries(ENDINGS)) if (k !== 'exited') assert.equal(v.read, false, k);
  assert.deepEqual(['cut', 'invalid', 'midnight'].map((k) => ENDINGS[k].label), ['discarded', 'discarded', 'discarded']);
  assert.deepEqual(['timeout', 'budget', 'daily_limit'].map((k) => ENDINGS[k].label), ['did_not_finish', 'did_not_finish', 'did_not_finish']);
});

// ---- Codex without web search (30 October, observation 01a18ab5-a181 on ADR-119) ------------------------------------------------------------
test('Codex\'s web search setting decides where its measured cost and edit check are read, and what a run is called', () => {
  assert.deepEqual(codexResultDirs('disabled'), { cost: 'codex-cost-no-web-search', edit: 'codex-edit-check-no-web-search' });
  assert.deepEqual(codexResultDirs('default'), { cost: 'codex-cost', edit: 'codex-edit-check' });
  assert.throws(() => codexResultDirs('live'), /no such web search setting/);
  assert.equal(defaultLabel('codex', 'edit-check', 'disabled'), 'codex-edit-check-no-web-search');
  assert.equal(defaultLabel('codex', 'edit-check', 'default'), 'codex-edit-check');
  assert.equal(defaultLabel('codex', 'measured', 'disabled'), 'codex-measured');
  assert.equal(defaultLabel('qwen', 'edit-check', 'disabled'), 'qwen-edit-check', 'the other hosts are called as before');
});

test('the config.toml of Codex carries web_search = "disabled" exactly when the setting says so, as a top-level key and nothing else changes', async () => {
  const { mkdirSync } = await import('node:fs');
  const root = mkdtempSync(join(process.env.ABFB_TMP ?? tmpdir(), 'abfb-websearch-'));
  roots.push(root);
  const box = { root, home: join(root, 'home'), project: join(root, 'project') };
  mkdirSync(box.home, { recursive: true });
  mkdirSync(box.project, { recursive: true });
  adapters.codex.prepare({ box, relayUrl: 'http://127.0.0.1:1/v1', model: kit.model, pluginDir: join(KIT, 'plugin-tag'), opencodeVersion: kit.hosts.opencode.version, pluginVersion: kit.mnema.version });
  const toml = readFileSync(join(root, 'codex', 'config.toml'), 'utf8').split('\n');
  const lines = toml.filter((l) => l.startsWith('web_search'));
  assert.deepEqual(lines, CODEX_WEB_SEARCH === 'disabled' ? ['web_search = "disabled"'] : []);
  if (CODEX_WEB_SEARCH === 'disabled') assert.ok(toml.indexOf('web_search = "disabled"') < toml.findIndex((l) => l.startsWith('[')), 'a TOML key after the first table would belong to that table');
  const rest = toml.filter((l) => !l.startsWith('web_search'));
  assert.deepEqual(rest.filter((l) => l !== ''), ['model = "nvidia/nemotron-3-ultra-550b-a55b:free"', 'model_provider = "openrouter"', 'check_for_update_on_startup = false', '[model_providers.openrouter]', 'name = "openrouter"', 'base_url = "http://127.0.0.1:1/v1"', 'wire_api = "responses"', 'env_key = "STAND_IN_KEY"', '[analytics]', 'enabled = false', '[otel]', 'exporter = "none"']);
});

test('the bodies the real Codex sent in its dry run with web search disabled offer no web_search tool and the same tools, instructions and settings as the run that offered it', () => {
  const results = join(KIT, 'results');
  const bodiesOf = (run) => readWireGz(join(results, run)).filter((r) => r.forwarded === true && r.path === '/responses').map((r) => r.request);
  const withTool = bodiesOf('codex-hooks-trusted');
  const without = bodiesOf('codex-no-web-search-bodies');
  assert.ok(without.length >= 3);
  assert.ok(withTool.every((b) => b.tools.some((t) => t.type === 'web_search')), 'the first run offered the tool');
  for (const b of without) {
    assert.ok(!b.tools.some((t) => String(t.type).startsWith('web_search')), 'no web_search tool in any body of the configured Codex');
    assert.deepEqual(b.tools, withTool[0].tools.filter((t) => t.type !== 'web_search'), 'every other tool, byte for byte');
    for (const k of ['model', 'stream', 'instructions', 'tool_choice', 'parallel_tool_calls', 'reasoning', 'store', 'include']) assert.deepEqual(b[k], withTool[0][k], k);
  }
});
