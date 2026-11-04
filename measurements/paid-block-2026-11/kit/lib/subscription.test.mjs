import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { sessionEnv } from '../contain/bwrap.mjs';
import { assertSubscriptionEnv, authStatusOf, FORBIDDEN_ENV, settingsProblems, subscriptionProof } from './subscription.mjs';
import { copyIn } from './login.mjs';
import { makeFakeLogin } from '../session/fake-login.mjs';
import { CLAUDE_BIN } from '../session/session.mjs';

const base = { path: '/usr/bin', mnemaHome: '/m', configDir: '/c', npmCache: '/n' };

test('the environment of a live session holds no credential; each API credential, the old setup-token variable, each cloud switch and a base URL is refused', () => {
  assertSubscriptionEnv(sessionEnv(base), { mode: 'live' });
  for (const k of FORBIDDEN_ENV) assert.throws(() => assertSubscriptionEnv({ ...sessionEnv(base), [k]: 'x' }, { mode: 'live' }), new RegExp(k));
  assertSubscriptionEnv(sessionEnv({ ...base, baseUrl: 'fake' }), { mode: 'dry' });
  assert.throws(() => assertSubscriptionEnv(sessionEnv({ ...base, baseUrl: 'fake' }), { mode: 'live' }), /ANTHROPIC_BASE_URL/);
});

test('a settings file that sets an apiKeyHelper or an ANTHROPIC_ variable, in the config folder or in the clone, is a problem', () => {
  const d = mkdtempSync(join(tmpdir(), 'abp-set-'));
  mkdirSync(join(d, 'clone', '.claude'), { recursive: true });
  mkdirSync(join(d, 'cfg'));
  writeFileSync(join(d, 'cfg', 'settings.json'), JSON.stringify({ enabledPlugins: {} }));
  assert.deepEqual(settingsProblems([join(d, 'cfg'), join(d, 'clone')]), []);
  writeFileSync(join(d, 'clone', '.claude', 'settings.local.json'), JSON.stringify({ apiKeyHelper: 'x', env: { ANTHROPIC_API_KEY: 'y' } }));
  assert.equal(settingsProblems([join(d, 'cfg'), join(d, 'clone')]).length, 2);
});

test('the subscription is proved from the stream: a subscription rate-limit event and an apiKeySource that is not a key', () => {
  const init = { type: 'system', subtype: 'init', apiKeySource: 'none' };
  const rl = { type: 'rate_limit_event', rate_limit_info: { status: 'allowed', rateLimitType: 'five_hour' } };
  assert.equal(subscriptionProof([init, rl]).ok, true);
  assert.equal(subscriptionProof([init]).ok, false);
  assert.equal(subscriptionProof([{ ...init, apiKeySource: 'ANTHROPIC_API_KEY' }, rl]).ok, false);
  assert.equal(subscriptionProof([rl]).ok, false);
});

test('`claude auth status` on a session config (offline, in the box) says claude.ai, pro and the enrolled organization for the fake login; another organization or plan is refused', () => {
  const login = makeFakeLogin(join(mkdtempSync(join(tmpdir(), 'abp-as-')), 'login'));
  const cfg = mkdtempSync(join(tmpdir(), 'abp-cfg-'));
  copyIn(login.dir, cfg);
  const r = authStatusOf({ claudeBin: CLAUDE_BIN, configDir: cfg, expectedOrgSha256: login.expected.org_sha256 });
  assert.deepEqual([r.ok, r.authMethod, r.plan], [true, 'claude.ai', 'pro']);
  assert.equal(authStatusOf({ claudeBin: CLAUDE_BIN, configDir: cfg, expectedOrgSha256: 'f'.repeat(64) }).ok, false);
  const max = makeFakeLogin(join(mkdtempSync(join(tmpdir(), 'abp-as-')), 'login'), { plan: 'max' });
  const cfg2 = mkdtempSync(join(tmpdir(), 'abp-cfg-'));
  copyIn(max.dir, cfg2);
  assert.equal(authStatusOf({ claudeBin: CLAUDE_BIN, configDir: cfg2, expectedOrgSha256: max.expected.org_sha256 }).ok, false);
});
