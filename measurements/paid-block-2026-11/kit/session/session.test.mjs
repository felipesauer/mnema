import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { secretsOf } from '../lib/login.mjs';
import { makeParityRepo } from '../seed/make-parity-repo.mjs';
import { defaultScript } from './fake-anthropic.mjs';
import { makeFakeLogin } from './fake-login.mjs';
import { runSession, spawnEnvFor } from './session.mjs';

const T = process.env.ABP_TMP ?? tmpdir();
const prep = (arm) => {
  const d = mkdtempSync(join(T, 'abp-sess-'));
  const r = makeParityRepo(join(d, 'base'), join(d, 'bh'), arm);
  const login = makeFakeLogin(join(d, 'login'));
  return { d, base: r.project, ...login };
};
const go = ({ d, base, dir, expected }, arm, script, extra = {}) =>
  runSession({ s: { id: `${arm}/parity-neutral-r01`, arm, task: 'parity-neutral', rounds: 1 }, runsDir: join(d, 'runs'), base, prompts: ['Do it.'], mode: 'dry', ledger: join(d, 'ledger.jsonl'), script, wallClockMs: 200000, loginDir: dir, expected, lockFile: join(d, 'session.lock'), ...extra });
const events = (r) => readFileSync(join(r.dir, 'out', 'round1.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

test('a dry session of arm B runs the pinned Claude Code in the box on the fake login: plugin connected, only the credential crossed in, the edit made, nothing leaves', { timeout: 240000 }, async () => {
  const p = prep('B');
  const r = await go(p, 'B', defaultScript({ command: 'ls -A "$CLAUDE_CONFIG_DIR" > seen-config.txt; echo touched > touched.txt' }));
  assert.equal(r.ending, 'exited', JSON.stringify({ ...r, fake_seen: undefined }));
  assert.equal(r.model, 'claude-sonnet-5-5');
  assert.deepEqual(r.arm_problems, []);
  assert.equal(r.account_check, 'match');
  assert.equal(r.same_account_after, true);
  assert.equal(r.credential_in_run_folder, false);
  assert.equal(readFileSync(join(r.dir, 'clone', 'touched.txt'), 'utf8').trim(), 'touched');
  const seen = readFileSync(join(r.dir, 'clone', 'seen-config.txt'), 'utf8').split('\n');
  assert.ok(seen.includes('.credentials.json') && seen.includes('.claude.json'));
  const own = readFileSync(join(r.dir, 'config', '.claude.json'), 'utf8');
  assert.ok(!own.includes('must not cross') && !own.includes('history'), 'nothing of the login\'s own .claude.json but the account object crossed');
  assert.ok(!existsSync(join(r.dir, 'config', '.credentials.json')), 'the session copy of the credential is deleted after the run');
  const init = events(r).find((e) => e.subtype === 'init');
  assert.ok(init.mcp_servers.some((m) => /mnema/.test(m.name) && m.status === 'connected'), JSON.stringify(init.mcp_servers));
  assert.ok(r.fake_seen.filter((q) => q.url.startsWith('/v1/messages')).length >= 2);
});

test('a credential the session refreshed goes back to the login folder and the master is not stranded', { timeout: 240000 }, async () => {
  const p = prep('A');
  const before = secretsOf(p.dir)[1];
  const r = await go(p, 'A', defaultScript({ command: 'sed -i "s/FAKEREFRESH/ROTATEDREFRESH/" "$CLAUDE_CONFIG_DIR/.credentials.json"' }));
  assert.equal(r.ending, 'exited', JSON.stringify({ ...r, fake_seen: undefined }));
  assert.deepEqual([r.credentials_refreshed, r.credentials_copied_back], [true, true]);
  assert.notEqual(secretsOf(p.dir)[1], before);
  assert.ok(secretsOf(p.dir)[1].includes('ROTATEDREFRESH'));
  assert.equal(r.credential_in_run_folder, false, 'no credential string is left in the run folder');
});

test('a session whose config names another account afterwards is discarded and its credentials are not written back', { timeout: 240000 }, async () => {
  const p = prep('A');
  const r = await go(p, 'A', defaultScript({ command: 'sed -i "s/aaaaaaaa-1111/cccccccc-1111/" "$CLAUDE_CONFIG_DIR/.claude.json"; sed -i "s/FAKEREFRESH/INTRUDER/" "$CLAUDE_CONFIG_DIR/.credentials.json"' }));
  assert.equal(r.ending, 'account_changed', JSON.stringify({ ...r, fake_seen: undefined }));
  assert.equal(r.status, 'account_changed');
  assert.ok(!secretsOf(p.dir)[1].includes('INTRUDER'));
});

test('arm A has no mnema tools, no plugin and no mnema command; its CLAUDE.md carries the rule; arm C no plugin tools', { timeout: 240000 }, async () => {
  const p = prep('A');
  const r = await go(p, 'A', defaultScript({ command: 'which mnema; echo rc=$? > which.txt' }));
  assert.equal(r.ending, 'exited', JSON.stringify({ ...r, fake_seen: undefined }));
  assert.ok(r.fake_seen.every((q) => q.tools.every((n) => !/mnema/.test(n))));
  assert.match(readFileSync(join(r.dir, 'clone', 'which.txt'), 'utf8'), /rc=1/);
  const main = r.fake_seen.find((q) => q.url.startsWith('/v1/messages') && q.tools.length)?.body;
  assert.ok(JSON.stringify(main).includes('A behavior change in one package is made in the other'));
  const c = await go(prep('C'), 'C', defaultScript());
  assert.equal(c.ending, 'exited');
  assert.ok(c.fake_seen.every((q) => q.tools.every((n) => !/mnema/.test(n))));
});

test('a login that is not the enrolled account refuses before anything starts, and two sessions at once refuse the second', { timeout: 240000 }, async () => {
  const p = prep('A');
  const bad = await go({ ...p, expected: { ...p.expected, account_sha256: 'f'.repeat(64) } }, 'A', defaultScript());
  assert.deepEqual([bad.status, bad.reason], ['account', 'mismatch']);
  const { withLock } = await import('../lib/login.mjs');
  await withLock(async () => {
    await assert.rejects(go(p, 'A', defaultScript()), /one at a time/);
  }, { file: join(p.d, 'session.lock') });
});

test('the two variables that reach the user service manager go to systemd-run alone, never to the box or to a plain spawn, and the session still has neither', { timeout: 240000 }, async () => {
  const proc = { XDG_RUNTIME_DIR: '/run/user/1', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1/bus', SECRET: 'x' };
  assert.deepEqual(spawnEnvFor(['systemd-run', '--user'], proc), { PATH: '/usr/bin:/bin', XDG_RUNTIME_DIR: '/run/user/1', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1/bus' });
  assert.deepEqual(spawnEnvFor(['bwrap', '--clearenv'], proc), { PATH: '/usr/bin:/bin' });
  const saved = { x: process.env.XDG_RUNTIME_DIR, d: process.env.DBUS_SESSION_BUS_ADDRESS };
  process.env.XDG_RUNTIME_DIR = '/run/user/1';
  process.env.DBUS_SESSION_BUS_ADDRESS = 'unix:path=/run/user/1/bus';
  try {
    const p = prep('A');
    const r = await go(p, 'A', defaultScript({ command: 'env > inside-env.txt' }));
    assert.equal(r.ending, 'exited', JSON.stringify({ ...r, fake_seen: undefined }));
    const inside = readFileSync(join(r.dir, 'clone', 'inside-env.txt'), 'utf8');
    assert.ok(!/XDG_RUNTIME_DIR|DBUS_SESSION_BUS_ADDRESS/.test(inside), 'the session environment has neither variable');
  } finally {
    if (saved.x === undefined) delete process.env.XDG_RUNTIME_DIR; else process.env.XDG_RUNTIME_DIR = saved.x;
    if (saved.d === undefined) delete process.env.DBUS_SESSION_BUS_ADDRESS; else process.env.DBUS_SESSION_BUS_ADDRESS = saved.d;
  }
});

test('a refused attempt removes its own run folder so the id can run again; when the wrapper fails before Claude Code starts the ledger says not_started and nothing is read', { timeout: 240000 }, async () => {
  const p = prep('A');
  const refused = await go(p, 'A', defaultScript(), { claudeBin: '/nonexistent/claude' });
  assert.equal(refused.status, 'billing');
  assert.ok(!existsSync(join(p.d, 'runs', 'A__parity-neutral-r01')));
  const { writeFileSync, chmodSync, mkdirSync } = await import('node:fs');
  mkdirSync(join(p.d, 'fakebin'));
  const script = join(p.d, 'fakebin', 'claude');
  writeFileSync(script, `#!/bin/sh\nif [ "$1" = auth ]; then echo '{"loggedIn":true,"authMethod":"claude.ai","subscriptionType":"pro","orgId":"bbbbbbbb-1111-4222-8333-444444444444"}'; exit 0; fi\necho "wrapper failure" >&2\nexit 3\n`);
  chmodSync(script, 0o755);
  const bad = await go(p, 'A', defaultScript(), { claudeBin: script });
  assert.equal(bad.status, 'not_started');
  assert.match(bad.reason, /wrapper failure/);
  assert.ok(!existsSync(join(p.d, 'runs', 'A__parity-neutral-r01')));
  assert.ok(readFileSync(join(p.d, 'ledger.jsonl'), 'utf8').includes('"status":"not_started"'));
  const again = await go(p, 'A', defaultScript());
  assert.equal(again.ending, 'exited', JSON.stringify({ ...again, fake_seen: undefined }));
});
