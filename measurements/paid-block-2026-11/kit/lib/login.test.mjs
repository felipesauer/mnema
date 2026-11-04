import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { makeFakeLogin } from '../session/fake-login.mjs';
import { copyBack, copyIn, identityOf, secretsOf, withLock } from './login.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'abp-login-'));

test('only the credentials and the account object cross into a session: no history, projects or backups', () => {
  const login = makeFakeLogin(join(tmp(), 'login'));
  const cfg = join(tmp(), 'cfg');
  copyIn(login.dir, cfg);
  assert.deepEqual(readdirSync(cfg).sort(), ['.claude.json', '.credentials.json']);
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(cfg, '.claude.json'), 'utf8'))), ['oauthAccount']);
  assert.equal(statSync(join(cfg, '.credentials.json')).mode & 0o777, 0o600);
  assert.ok(!readFileSync(join(cfg, '.claude.json'), 'utf8').includes('must not cross'));
  assert.deepEqual(identityOf(cfg), identityOf(login.dir));
});

test('a plugin install\'s own .claude.json keeps its keys when the account object is added', () => {
  const login = makeFakeLogin(join(tmp(), 'login'));
  const cfg = tmp();
  writeFileSync(join(cfg, '.claude.json'), JSON.stringify({ installMethod: 'x' }));
  copyIn(login.dir, cfg);
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(cfg, '.claude.json'), 'utf8'))).sort(), ['installMethod', 'oauthAccount']);
});

test('a refreshed credential goes back to the login folder (0600, by rename) and the session copy is deleted; an unchanged one is not written back', () => {
  const login = makeFakeLogin(join(tmp(), 'login'));
  const cfg = join(tmp(), 'cfg');
  const wentIn = copyIn(login.dir, cfg);
  const before = readFileSync(join(login.dir, '.credentials.json'), 'utf8');
  let r = copyBack(cfg, login.dir, { wentIn });
  assert.deepEqual([r.refreshed, r.copied_back, r.same_account], [false, false, true]);
  assert.ok(!existsSync(join(cfg, '.credentials.json')));
  assert.equal(readFileSync(join(login.dir, '.credentials.json'), 'utf8'), before);
  copyIn(login.dir, cfg);
  const rotated = JSON.parse(before);
  rotated.claudeAiOauth.refreshToken = 'sk-ant-ort01-[FAKE]' + 'c'.repeat(30);
  writeFileSync(join(cfg, '.credentials.json'), JSON.stringify(rotated));
  r = copyBack(cfg, login.dir, { wentIn });
  assert.deepEqual([r.refreshed, r.copied_back, r.same_account], [true, true, true]);
  assert.ok(secretsOf(login.dir)[1].includes('ROTATED'));
  assert.equal(statSync(join(login.dir, '.credentials.json')).mode & 0o777, 0o600);
  assert.ok(!existsSync(join(login.dir, '.credentials.json.new')));
});

test('credentials refreshed by a session whose config names ANOTHER account are not written back to the master', () => {
  const login = makeFakeLogin(join(tmp(), 'login'));
  const cfg = join(tmp(), 'cfg');
  const wentIn = copyIn(login.dir, cfg);
  const other = makeFakeLogin(join(tmp(), 'other'), { accountUuid: 'cccccccc-1111-4222-8333-444444444444' });
  writeFileSync(join(cfg, '.claude.json'), readFileSync(join(other.dir, '.claude.json')));
  writeFileSync(join(cfg, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'sk-ant-oat01-[FAKE]' + 'z'.repeat(30), refreshToken: 'q'.repeat(30), subscriptionType: 'pro' } }));
  const before = readFileSync(join(login.dir, '.credentials.json'), 'utf8');
  const r = copyBack(cfg, login.dir, { wentIn });
  assert.deepEqual([r.refreshed, r.copied_back, r.same_account], [true, false, false]);
  assert.equal(readFileSync(join(login.dir, '.credentials.json'), 'utf8'), before);
});

test('sessions run one at a time: a live lock refuses a second, a stale one is taken over, and the lock goes away', async () => {
  const file = join(tmp(), 'session.lock');
  await withLock(async () => {
    await assert.rejects(withLock(async () => 1, { file }), /one at a time/);
  }, { file });
  assert.ok(!existsSync(file));
  writeFileSync(file, '999999999');
  assert.equal(await withLock(async () => 'ran', { file }), 'ran');
  await assert.rejects(withLock(async () => { throw new Error('boom'); }, { file }), /boom/);
  assert.ok(!existsSync(file));
});
