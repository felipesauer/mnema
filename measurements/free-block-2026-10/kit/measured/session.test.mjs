// Tests of the runner of a session, in DRY mode: the real runner, a stand-in host (test-support/stub-host.mjs) and the fake OpenRouter
// (fake-upstream.mjs) on the loopback. No model, no key, no network beyond 127.0.0.1, nothing synthetic on the CPU. These need the kit's npm
// install of mnema (the repository is generated with it) and git; the arm check runs the packages' tests (node and php).
//
// The HOME of this process is an EMPTY folder: a dry run that tried to open the real key file would fail on it, and the test of the
// ledger compares the real one before and after.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { readSession } from '../analysis/labels.mjs';
import { editedAsAsked, judgeEdit, PROMPT as EDIT_PROMPT } from '../editcheck/edit-check.mjs';
import { readWireGz, kit, LEDGER } from '../lib/run-common.mjs';
import { MNEMA_CLI } from '../seed/make-repo.mjs';
import { NEUTRAL_PROMPT_FILE } from '../seed/make-parity-repo.mjs';
import { startFakeUpstream, shellEditScript } from './fake-upstream.mjs';
import { SESSION_MAX_REQUESTS } from './protocol.mjs';
import { assertApi, dayFacts, dryApi, editCheckOf, ledgerUnits, liveApi, runSession, verifyServed, versionOf } from './session.mjs';
import { JS_EDIT, PHP_EDIT, README_EDIT } from './test-support/commands.mjs';

const TMP = process.env.ABFB_TMP ?? tmpdir();
mkdirSync(TMP, { recursive: true });
const EMPTY_HOME = mkdtempSync(join(TMP, 'abfb-empty-home-'));
process.env.HOME = EMPTY_HOME;

const FAKE_KEY = 'sk-or-v1-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const STUB = join(import.meta.dirname, 'test-support', 'stub-host.mjs');
const NEUTRAL = readFileSync(NEUTRAL_PROMPT_FILE, 'utf8').trim();
const baseline = { model: kit.model.id, provider: 'Nvidia' };
const haveMnema = existsSync(MNEMA_CLI);
const opts = { skip: !haveMnema, timeout: 180_000 };
const roots = [EMPTY_HOME];
const upstreams = [];
after(async () => {
  for (const u of upstreams) await u.close().catch(() => {});
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

async function dry(fake = {}) {
  const root = mkdtempSync(join(TMP, 'abfb-session-'));
  roots.push(root);
  const keyFile = join(root, 'dry.key');
  writeFileSync(keyFile, `${FAKE_KEY}\n`, { mode: 0o600 });
  const up = await startFakeUpstream({ model: kit.model.id, provider: 'Nvidia', ...fake });
  upstreams.push(up);
  return { root, up, api: dryApi({ base: up.base, keyFile, ledgerFile: join(root, 'ledger.jsonl') }), resultsDir: join(root, 'results'), runsDir: join(root, 'runs') };
}
const stub = (mode = 'loop') => ({ relay }) => ({ binary: process.execPath, args: [STUB, relay.url, NEUTRAL], env: { STUB_MODE: mode, STUB_MODEL: kit.model.id }, installs: [] });
const never = () => {
  throw new Error('the host must not be launched');
};
const measured = (d, extra = {}) =>
  runSession({ kind: 'measured', host: 'qwen', label: 'm', resultsDir: d.resultsDir, runsDir: d.runsDir, prompt: NEUTRAL, judge: readSession, api: d.api, baseline, capability: 'passed', editCheck: 'passed', verify: () => ({ ok: true, exit: 0, mismatches: [] }), launch: stub(), pollMs: 5, settleMaxMs: 400, ...extra });
const editCheck = (d, extra = {}) =>
  runSession({ kind: 'edit-check', host: 'qwen', label: 'e', resultsDir: d.resultsDir, runsDir: d.runsDir, prompt: EDIT_PROMPT, judge: judgeEdit, api: d.api, baseline, capability: 'passed', launch: stub(), pollMs: 5, settleMaxMs: 400, ...extra });

// ---- what the runner will and will not talk to -------------------------------------------------------------------------
test('a dry run reaches only the loopback, never the real key file or the real ledger; a live run only the kit\'s own', () => {
  assert.doesNotThrow(() => assertApi(liveApi()));
  assert.doesNotThrow(() => assertApi(dryApi({ base: 'http://127.0.0.1:9/api/v1', keyFile: '/x/dry.key', ledgerFile: '/x/ledger.jsonl' })));
  assert.throws(() => assertApi(dryApi({ base: 'https://openrouter.ai/api/v1', keyFile: '/x/dry.key', ledgerFile: '/x/l' })), /loopback/);
  assert.throws(() => assertApi(dryApi({ base: 'http://127.0.0.1:9/api/v1', keyFile: kit.key_file, ledgerFile: '/x/l' })), /real key file/);
  assert.throws(() => assertApi(dryApi({ base: 'http://127.0.0.1:9/api/v1', keyFile: '/x/dry.key', ledgerFile: LEDGER })), /real ledger/);
  assert.throws(() => assertApi({ ...liveApi(), base: 'http://127.0.0.1:9/api/v1' }), /kit's own/);
  assert.throws(() => assertApi({ mode: 'whatever' }), /unknown mode/);
});

// ---- the refusals: nothing starts, nothing is spent ---------------------------------------------------------------------
test('a counted session does not start on a day that is too short, on a free-tier mismatch, near midnight, or without the capability', async () => {
  const d1 = await dry({ startUsed: 27 });
  const a = await measured(d1, { launch: never });
  assert.equal(a.started, false);
  assert.equal(a.label, 'daily_remaining_below_threshold_at_start');
  assert.match(a.reasons[0], /remaining is 23 of 50/);
  assert.match(a.reasons[0], /at least 24 left \(its cap of 24 requests at 1 each\)/);
  assert.equal(d1.up.seen.length, 0);

  const d2 = await dry({ freeTier: false });
  assert.equal((await measured(d2, { launch: never })).label, 'account_not_expected');

  const d3 = await dry();
  const late = await measured(d3, { launch: never, now: () => new Date('2026-10-30T23:40:00Z') });
  assert.equal(late.label, 'outside_the_start_window');
  assert.match(late.reasons[0], /20 minutes to 00:00 UTC/);
  assert.equal((await measured(d3, { launch: never, now: () => new Date('2026-10-30T23:26:00Z') })).label, 'outside_the_start_window');

  assert.equal((await measured(d3, { launch: never, capability: 'failed: no call of search' })).label, 'capability_not_passed');
  const noEdit = await measured(d3, { launch: never, editCheck: 'incapable of editing' });
  assert.equal(noEdit.label, 'incapable_of_editing');
  assert.match(noEdit.reasons[0], /gets no counted session/);
  assert.equal((await measured(d3, { launch: never, verify: () => ({ ok: false, exit: 1, mismatches: ['x'] }) })).label, 'arm_not_what_it_says');
  const advisory = await measured(d3, { launch: never, verify: () => ({ ok: false, exit: 1, mismatches: ['x'] }), verifyIsAdvisory: true, capability: 'passed', costPerRequest: 2 });
  assert.equal(advisory.label, 'does_not_fit_the_free_quota', 'an advisory verdict does not refuse; the next check does');
  const dear = await measured(d3, { launch: never, costPerRequest: 2 });
  assert.equal(dear.label, 'does_not_fit_the_free_quota');
  assert.equal(d3.up.seen.length, 0, 'no request reached the model');
});

test('a run in a folder inside a git checkout does not start', { skip: !haveMnema }, async () => {
  const d = await dry();
  const checkout = join(d.root, 'a-checkout');
  mkdirSync(checkout);
  execFileSync('git', ['init', '-q'], { cwd: checkout });
  const r = await measured(d, { launch: never, runsDir: join(checkout, 'runs') });
  assert.equal(r.label, 'arm_not_what_it_says');
  assert.match(r.reasons[0], /inside a git checkout/);
});

test('a counted session starts with 49, 25 or 24 of the day free, and the relay is given the cap, not the day', opts, async () => {
  for (const startUsed of [1, 25, 26]) {
    const d = await dry({ startUsed, script: shellEditScript([JS_EDIT, PHP_EDIT], 'Both packages now accept the prefix.') });
    const r = await measured(d, { launch: ({ relay }) => ({ ...stub('dump-env')({ relay }) }) });
    assert.equal(r.started, true, `${50 - startUsed} free`);
    assert.equal(r.meta.budget_requests, 24);
    assert.equal(JSON.parse(readFileSync(join(r.dir, 'start.json'), 'utf8')).units, 24);
  }
});

test('a counted session with 23 free refuses, and the ledger counts as much as the account', async () => {
  for (const startUsed of [27, 49]) {
    const r = await measured(await dry({ startUsed }), { launch: never });
    assert.equal(r.started, false, `${50 - startUsed} free`);
    assert.equal(r.label, 'daily_remaining_below_threshold_at_start');
  }
  const d = await dry();
  writeFileSync(d.api.ledgerFile, `${JSON.stringify({ t: new Date().toISOString(), seq: 1, path: '/chat/completions', units: 27 })}\n`);
  const r = await measured(d, { launch: never });
  assert.equal(r.started, false, 'the account says 0 used, the ledger 27 units: 23 left');
  assert.match(r.reasons[0], /remaining is 23 of 50/);
  assert.equal(d.up.seen.length, 0);
});

// ---- a counted session -----------------------------------------------------------------------------------------------------
test('a session that obeys: the host exits, the repository holds both edits, the labels say obeyed, the quota is read before and after', opts, async () => {
  const realLedgerBefore = existsSync(LEDGER) ? statSync(LEDGER).mtimeMs : null;
  const d = await dry({ script: shellEditScript([JS_EDIT, PHP_EDIT], 'Both packages now accept the prefix.') });
  const r = await measured(d, { launch: ({ relay }) => ({ ...stub('dump-env')({ relay }) }) });
  assert.equal(r.started, true);
  assert.equal(r.outcome.ended, 'exited');
  assert.equal(r.meta.forwarded, 3);
  assert.equal(r.result.status, 'finished');
  assert.equal(r.result.obeyed.value, 'yes');
  assert.equal(r.result.outcome, 'obeyed');
  assert.equal(r.result.read_by, 'CODE');
  assert.equal(r.meta.quota_before.used, 0);
  assert.equal(r.meta.quota_after.account_used_when_settled, 3);
  assert.equal(r.meta.account_units_spent, 3);
  assert.equal(r.meta.cost_per_request_measured, 1);
  assert.equal(r.meta.budget_requests, SESSION_MAX_REQUESTS);
  assert.equal(JSON.parse(readFileSync(join(r.dir, 'start.json'), 'utf8')).units, SESSION_MAX_REQUESTS);
  assert.deepEqual(r.meta.baseline, baseline);
  assert.equal(r.meta.invalid, null);
  assert.equal(readFileSync(d.api.ledgerFile, 'utf8').split('\n').filter(Boolean).length, 3, 'the dry ledger got one line per request');
  assert.equal(existsSync(LEDGER) ? statSync(LEDGER).mtimeMs : null, realLedgerBefore, 'the real ledger was not touched');
  // The host got a made-up key and nothing that looks like the real one; nothing the run left holds the key.
  const out = readFileSync(join(r.dir, 'host-output.txt'), 'utf8');
  assert.match(out, /env names: /);
  assert.ok(!out.includes('KEY-SHAPED VALUE'), out);
  assert.ok(!/OPENROUTER|OPENAI_API_KEY/.test(out.split('\n')[0]), 'the host environment carries no key variable');
  assert.equal(r.keyScanHits, 0);
  assert.ok(!readFileSync(join(r.dir, 'outcome.json'), 'utf8').includes(FAKE_KEY));
  // The wire is the transcript; the provider block was injected by the relay and the fake saw the real (fake) key only there.
  const wire = readWireGz(r.dir).filter((x) => x.forwarded);
  assert.deepEqual(wire[0].injected.provider, { order: ['nvidia'], allow_fallbacks: false });
  assert.ok(d.up.seen.every((s) => s.auth === `Bearer ${FAKE_KEY}`));
  // The start record says what ran.
  const start = JSON.parse(readFileSync(join(r.dir, 'start.json'), 'utf8'));
  assert.equal(start.prompt_sha256.length, 64);
  assert.equal(start.mode, 'dry');
  assert.equal(start.arm.rules_js && start.arm.rules_php, true);
  assert.equal(start.arm.js_accepts_export, false);
  assert.ok(!r.box.project.startsWith(join(import.meta.dirname, '..')), 'the working directory is outside the kit');
});

test('a session that did the JS side only is silent or reported_or_asked, by what the final message says', opts, async () => {
  const silent = await measured(await dry({ script: shellEditScript([JS_EDIT], 'Done. Tests added.') }));
  assert.equal(silent.result.obeyed.value, 'no');
  assert.equal(silent.result.outcome, 'silent');
  assert.equal(silent.result.two_numbers.violation.value, true);
  const reported = await measured(await dry({ script: shellEditScript([JS_EDIT], 'The JS side is done; the PHP counterpart still needs the same change.') }));
  assert.equal(reported.result.outcome, 'reported_or_asked');
});

test('a 429 cuts the session: the host is killed, the session is discarded whole and read by nobody', opts, async () => {
  const d = await dry({ script: (n, body) => (n === 2 ? { status: 429, body: { error: { message: 'Rate limit exceeded: too many requests per minute' } } } : shellEditScript([JS_EDIT], 'x')(n, body)) });
  const r = await measured(d);
  assert.equal(r.outcome.ended, 'cut');
  assert.equal(r.result.status, 'discarded');
  assert.equal(r.result.read, false);
  assert.equal(r.result.obeyed, undefined);
  assert.equal(r.meta.cuts.length, 1);
});

test('a 429 that names the DAY\'s limit is "did not finish within the daily quota", not a discard', opts, async () => {
  const d = await dry({ script: (n, body) => (n === 2 ? { status: 429, body: { error: { message: 'Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day' } } } : shellEditScript([JS_EDIT], 'x')(n, body)) });
  const r = await measured(d);
  assert.equal(r.outcome.ended, 'daily_limit');
  assert.equal(r.result.status, 'did_not_finish');
  assert.match(r.result.note, /never "silent"/);
});

test('a provider other than the baseline invalidates the session: the host is stopped and nothing is read', opts, async () => {
  const d = await dry({ script: (n, body) => (n === 2 ? { text: 'x', provider: 'SomeoneElse' } : shellEditScript([JS_EDIT], 'x')(n, body)) });
  const r = await measured(d);
  assert.equal(r.outcome.ended, 'invalid');
  assert.match(r.meta.invalid.reason, /SomeoneElse/);
  assert.equal(r.result.status, 'discarded');
});

test('a host that never ends is stopped at the wall-clock limit: "did not finish", with the requests read', opts, async () => {
  const d = await dry({ script: shellEditScript([JS_EDIT], 'x') });
  const r = await measured(d, { launch: stub('hang'), wallClockMs: 1500 });
  assert.equal(r.outcome.ended, 'timeout');
  assert.ok(r.outcome.wall_ms >= 1400 && r.outcome.wall_ms < 6000, `${r.outcome.wall_ms} ms`);
  assert.equal(r.result.status, 'did_not_finish');
  assert.match(r.result.why, /30 minutes/);
});

test('the relay\'s budget ends a session that keeps asking: "did not finish within the session\'s cap", counted in the account\'s own units', opts, async () => {
  // Codex-like cost: 2 of the day per request; the session needs 48 of the day and its budget is the cap, 24 requests; the counter lags.
  const d = await dry({ limit: 50, cost: 2, lagMs: 30, stepMs: 50, script: (n, body) => shellEditScript(Array(60).fill('true'), 'x')(n, body) });
  const r = await measured(d, { launch: stub('always-call'), costPerRequest: 2, allowDoesNotFit: true, pollMs: 20, settleMaxMs: 3000 });
  assert.equal(r.started, true);
  assert.equal(r.meta.budget_requests, SESSION_MAX_REQUESTS);
  assert.equal(r.meta.forwarded, SESSION_MAX_REQUESTS);
  assert.equal(r.outcome.ended, 'budget');
  assert.equal(r.result.status, 'did_not_finish');
  assert.equal(r.meta.account_units_spent, 48, 'the settled counter (it moves a unit at a time), not the first step');
  assert.equal(r.meta.cost_per_request_measured, 2);
  assert.equal(r.meta.quota_after.settled, true);
});

// ---- the edit check --------------------------------------------------------------------------------------------------------
test('the edit check: a host that changes the one line as asked, and nothing else, "edits"', opts, async () => {
  const d = await dry({ script: shellEditScript([README_EDIT], 'Done.') });
  const r = await editCheck(d);
  assert.equal(r.started, true);
  assert.equal(r.result.label, 'edits');
  assert.equal(r.result.verdict, true);
  assert.deepEqual(r.result.changed_files, ['README.md']);
  assert.equal(r.meta.budget_requests, 6, 'at most 6 of the day\'s requests');
  assert.equal(r.meta.forwarded, 2);
  assert.ok(existsSync(join(r.dir, 'editcheck.json')));
});

test('the edit check tells apart: a host that did not edit, edited something else, or edited more than asked', opts, async () => {
  const none = await editCheck(await dry({ script: () => ({ text: 'I cannot write files here.' }) }));
  assert.equal(none.result.label, 'incapable of editing');
  assert.equal(none.result.verdict, false);
  const other = await editCheck(await dry({ script: shellEditScript([JS_EDIT], 'Done.') }));
  assert.equal(other.result.label, 'edited a file other than the one asked');
  const more = await editCheck(await dry({ script: shellEditScript([README_EDIT, JS_EDIT], 'Done.') }));
  assert.equal(more.result.label, 'edits, but also changed other files');
  assert.deepEqual(more.result.other_files_changed, ['packages/js/src/accessors/formats/env-accessor.ts']);
  assert.equal(more.result.verdict, false);
});

test('the edit check stops the day at 40: it spends what is left under the stop, a host at its cost, and starts nothing past it', opts, async () => {
  const near = await dry({ startUsed: 38, script: shellEditScript([README_EDIT], 'Done.') });
  const r = await editCheck(near);
  assert.equal(r.meta.budget_requests, 2, '38 used: 2 left under the stop of 40');
  assert.equal(r.result.label, 'edits');
  const costly = await dry({ startUsed: 36, cost: 2, lagMs: 30, script: shellEditScript([README_EDIT], 'Done.') });
  assert.equal((await editCheck(costly, { costPerRequest: 2 })).meta.budget_requests, 2, '4 units left, 2 each');
  const codexLike = await dry({ cost: 2, lagMs: 30, stepMs: 40, script: shellEditScript([README_EDIT], 'Done.') });
  const c = await editCheck(codexLike, { costPerRequest: 2, pollMs: 25, settleMaxMs: 3000 }); // the reads must stand still for longer than one step (40 ms)
  assert.equal(c.meta.budget_requests, 6, 'still 6 requests: the cap is in requests, the day\'s units are 12 for a host at 2 each');
  assert.equal(c.meta.account_units_spent, 4);
  const full = await dry({ startUsed: 40 });
  const refused = await editCheck(full, { launch: never });
  assert.equal(refused.label, 'the_day_has_no_room');
  assert.equal(full.up.seen.length, 0);
});

test('the edit check does not start in the minutes before 00:00 UTC either', async () => {
  const d = await dry();
  assert.equal((await editCheck(d, { launch: never, now: () => new Date('2026-10-30T23:50:00Z') })).label, 'outside_the_start_window');
});

// ---- the day, as the ledger counts it ---------------------------------------------------------------------------------------
test('the ledger counts each request at the cost it was sent at; a line from before has no cost and is a Responses request at 2 (Codex) or a chat one at 1', async () => {
  const d = await dry();
  const now = new Date('2026-10-30T12:00:00.000Z');
  const line = (t, path, units) => JSON.stringify({ t, seq: 1, path, ...(units === undefined ? {} : { units }) });
  writeFileSync(d.api.ledgerFile, [
    line('2026-10-29T23:59:59.000Z', '/responses'), // yesterday: not today's
    line('2026-10-30T02:00:00.000Z', '/responses'), // before: Codex, 2
    line('2026-10-30T02:01:00.000Z', '/chat/completions'), // before: another host, 1
    line('2026-10-30T11:00:00.000Z', '/responses', 1), // Codex without web search, if it cost 1
    line('2026-10-30T11:01:00.000Z', '/chat/completions', 1),
    line('2026-10-30T11:02:00.000Z', '/responses', 2),
  ].join('\n') + '\n');
  assert.equal(ledgerUnits(d.api.ledgerFile, now), 2 + 1 + 1 + 1 + 2);
  assert.equal(ledgerUnits(join(d.root, 'nothing.jsonl'), now), 0);
});

test('the day is the larger of the account\'s counter and the ledger\'s units; the 30 October ledger (18 requests, 25 units) no longer reads as 36', async () => {
  const d = await dry({ startUsed: 25 });
  const now = new Date('2026-10-30T03:00:00.000Z');
  const rows = [['/responses', 3], ['/chat/completions', 4], ['/chat/completions', 4], ['/chat/completions', 3], ['/responses', 4]];
  writeFileSync(d.api.ledgerFile, rows.flatMap(([path, n]) => Array.from({ length: n }, () => JSON.stringify({ t: '2026-10-30T02:30:00.000Z', seq: 1, path }))).join('\n') + '\n');
  const facts = await dayFacts({ api: d.api, now });
  assert.equal(facts.ledgerRequests, 18);
  assert.equal(facts.ledgerUnits, 25);
  assert.equal(facts.apiUsed, 25);
  assert.equal(facts.used, 25, 'the old reading was requests x the cost of the host about to run: 18 x 2 = 36');
  const behind = await dry({ startUsed: 10 });
  writeFileSync(behind.api.ledgerFile, `${JSON.stringify({ t: '2026-10-30T02:30:00.000Z', seq: 1, path: '/responses', units: 2 })}\n`.repeat(8));
  assert.equal((await dayFacts({ api: behind.api, now })).used, 16, 'the counter lags behind what the ledger knows was sent: the ledger wins');
});

// ---- the edit criterion itself, on facts made by hand ----------------------------------------------------------------------
const readme = (over = {}) => ({ path: 'README.md', status: 'M', added: ['# Synthetic Accessors'], removed: ['# synthetic-accessors'], sha256_end: 'h', ...over });
test('the edit criterion is exact: one line replaced, and no other file', () => {
  assert.equal(editedAsAsked({ changed: [readme()] }).changed_as_asked, true);
  assert.equal(editedAsAsked({ changed: [readme({ added: ['# Synthetic accessors'] })] }).changed_as_asked, false, 'the wrong text');
  assert.equal(editedAsAsked({ changed: [readme({ added: ['# Synthetic Accessors', 'more'] })] }).changed_as_asked, false, 'a line more');
  assert.equal(editedAsAsked({ changed: [readme({ status: 'D' })] }).changed_as_asked, false);
  assert.equal(editedAsAsked({ changed: [] }).readme_changed, false);
  assert.equal(editedAsAsked({ changed: [readme(), { path: 'x.txt', status: 'A', added: [], removed: [] }] }).nothing_else, false);
});

test('the edit check result is read from the kit\'s results: only "edits" lets a counted session start', () => {
  const root = mkdtempSync(join(TMP, 'abfb-editresult-'));
  roots.push(root);
  assert.match(editCheckOf('qwen', root), /no edit check result for qwen/);
  mkdirSync(join(root, 'qwen-edit-check'), { recursive: true });
  writeFileSync(join(root, 'qwen-edit-check', 'editcheck.json'), JSON.stringify({ label: 'edits' }));
  assert.equal(editCheckOf('qwen', root), 'passed');
  writeFileSync(join(root, 'qwen-edit-check', 'editcheck.json'), JSON.stringify({ label: 'incapable of editing' }));
  assert.equal(editCheckOf('qwen', root), 'incapable of editing');
  writeFileSync(join(root, 'qwen-edit-check', 'editcheck.json'), JSON.stringify({ label: 'edits, but also changed other files' }));
  assert.notEqual(editCheckOf('qwen', root), 'passed');
});

test('the version of a host is the line that carries it, not a warning or a nudge to update', () => {
  assert.equal(versionOf('codex-cli 0.161.0\nWARNING: proceeding, even though we could not create PATH aliases 0.0.1'), 'codex-cli 0.161.0');
  assert.equal(versionOf("GitHub Copilot CLI 1.0.104.\nRun 'copilot update' to check for updates.\n"), 'GitHub Copilot CLI 1.0.104.');
  assert.equal(versionOf('WARNING: x 1.2.3\n\n0.26.1\n'), '0.26.1');
  assert.equal(versionOf(''), '');
});

test('the provider is looked up AFTER the session too: a record that only appears later and names another provider invalidates it', opts, async () => {
  // The stream names no provider (as a Responses stream never does) and the service has no record for the first 1.5 s: the relay\'s own lookup
  // (4 tries, 2 s after the answer) can miss it; the lookup after the session finds it and says who served it.
  const d = await dry({ hideProvider: true, generationDelayMs: 1500, script: (n, body) => (n === 2 ? { text: 'x', provider: 'SomeoneElse' } : shellEditScript([JS_EDIT], 'x')(n, body)) });
  const r = await measured(d, { generationTries: 6, generationWaitMs: 500 });
  assert.deepEqual(r.meta.served_verification.mismatched.map((m) => m.provider), ['SomeoneElse']);
  assert.equal(r.outcome.ended, 'invalid');
  assert.equal(r.result.status, 'discarded');
  assert.match(r.meta.invalid.reason, /SomeoneElse/);
  assert.ok(existsSync(join(r.dir, 'served-verified.json')));
});

test('a provider that is the baseline\'s in every record leaves the session valid and the verification says how many were checked', opts, async () => {
  const d = await dry({ hideProvider: true, generationDelayMs: 600, script: shellEditScript([JS_EDIT], 'Done.') });
  const r = await measured(d, { generationTries: 6, generationWaitMs: 400 });
  assert.equal(r.outcome.ended, 'exited');
  assert.deepEqual({ checked: r.meta.served_verification.checked, ok: r.meta.served_verification.ok, mismatched: r.meta.served_verification.mismatched.length, unverified: r.meta.served_verification.unverified.length }, { checked: 2, ok: 2, mismatched: 0, unverified: 0 });
  const start = JSON.parse(readFileSync(join(r.dir, 'start.json'), 'utf8'));
  assert.match(start.kit_commit, /^[0-9a-f]{40}$/);
  assert.equal(typeof start.kit_code_clean, 'boolean');
});

test('verifyServed counts matches, mismatches and records that never appeared', async () => {
  const rec = (seq, id) => ({ seq, forwarded: true, upstream_status: 200, upstream_headers: id === null ? {} : { 'x-generation-id': id }, response: { text: '' } });
  const answers = { 'gen-a': { status: 200, provider_name: 'Nvidia' }, 'gen-b': { status: 200, provider_name: 'Other' }, 'gen-c': { status: 404 } };
  const v = await verifyServed({ records: [rec(1, 'gen-a'), rec(2, 'gen-b'), rec(3, 'gen-c'), rec(4, null), { seq: 5, forwarded: false }, { seq: 6, forwarded: true, upstream_status: 429 }], api: { base: 'x', keyFile: 'y' }, baseline: { model: 'm', provider: 'Nvidia' }, tries: 1, waitMs: 1, lookup: async ({ id }) => answers[id] });
  assert.deepEqual({ checked: v.checked, ok: v.ok, mismatched: v.mismatched, unverified: v.unverified }, { checked: 4, ok: 1, mismatched: [{ seq: 2, provider: 'Other' }], unverified: [3, 4] });
});
