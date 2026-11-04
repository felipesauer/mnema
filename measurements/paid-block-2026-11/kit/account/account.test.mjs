import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { makeFakeLogin } from '../session/fake-login.mjs';
import { checkAccount, readExpected, sameAccountAfter, writeExpected } from './account.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'abp-acc-'));

test('the expected identity is hashes and a plan name in a 0600 file: no id, no address, no token', () => {
  const login = makeFakeLogin(join(tmp(), 'login'));
  const file = join(tmp(), 'expected.json');
  writeExpected(login.dir, { file });
  const text = readFileSync(file, 'utf8');
  assert.ok(!/aaaaaaaa|bbbbbbbb|@|sk-ant/.test(text), text);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(readExpected(file).plan, 'pro');
});

test('the check reads the login folder\'s files, makes no request, and says match, mismatch, forbidden, wrong plan, no login or nothing enrolled', () => {
  const login = makeFakeLogin(join(tmp(), 'login'));
  assert.deepEqual(checkAccount({ loginDir: login.dir, expected: login.expected }), { ok: true, reason: 'match' });
  const other = makeFakeLogin(join(tmp(), 'other'), { accountUuid: 'cccccccc-1111-4222-8333-444444444444' });
  assert.equal(checkAccount({ loginDir: other.dir, expected: login.expected }).reason, 'mismatch');
  assert.equal(checkAccount({ loginDir: other.dir, expected: { ...login.expected, forbidden_account_sha256: [other.expected.account_sha256] } }).reason, 'forbidden');
  const max = makeFakeLogin(join(tmp(), 'max'), { plan: 'max' });
  assert.equal(checkAccount({ loginDir: max.dir, expected: login.expected }).reason, 'wrong_plan');
  assert.equal(checkAccount({ loginDir: tmp(), expected: login.expected }).reason, 'no_login');
  assert.equal(checkAccount({ loginDir: login.dir, expected: null }).reason, 'no_expected');
});

test('a session config that names another account afterwards is caught', () => {
  const login = makeFakeLogin(join(tmp(), 'login'));
  const other = makeFakeLogin(join(tmp(), 'other'), { organizationUuid: 'dddddddd-1111-4222-8333-444444444444' });
  assert.equal(sameAccountAfter(login.dir, login.expected), true);
  assert.equal(sameAccountAfter(other.dir, login.expected), false);
});
