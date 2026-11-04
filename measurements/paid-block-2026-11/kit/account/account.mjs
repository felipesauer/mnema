// The account check, before every session, WITHOUT any API call: the login folder's own files say whose login it is (lib/login.mjs identityOf: the hashes
// of oauthAccount.accountUuid and organizationUuid, and the plan from the credentials), and that is compared with what the maintainer enrolled from his own
// login (account/enroll.mjs). After the session the session's own config must still name the same account (lib/login.mjs copyBack), else the session is
// discarded. Answers are reason codes; no id, hash or address leaves.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { identityOf, LOGIN_DIR } from '../lib/login.mjs';
import { KIT, kitJson } from '../lib/token.mjs';

export const EXPECTED_FILE = (kit = KIT) => join(kit, kitJson().expected_account_file);

export function readExpected(file = EXPECTED_FILE()) {
  if (!existsSync(file)) return null;
  const j = JSON.parse(readFileSync(file, 'utf8'));
  if (!/^[0-9a-f]{64}$/.test(j.org_sha256 ?? '') || !/^[0-9a-f]{64}$/.test(j.account_sha256 ?? '')) return null;
  return { org_sha256: j.org_sha256, account_sha256: j.account_sha256, plan: j.plan ?? 'pro', forbidden_account_sha256: (j.forbidden_account_sha256 ?? []).filter((h) => /^[0-9a-f]{64}$/.test(h)) };
}

/** @returns {{ok: boolean, reason: 'match'|'no_expected'|'no_login'|'forbidden'|'mismatch'|'wrong_plan'}} */
export function checkAccount({ loginDir = LOGIN_DIR(), expected = readExpected() } = {}) {
  if (expected === null) return { ok: false, reason: 'no_expected' };
  const id = identityOf(loginDir);
  if (id === null) return { ok: false, reason: 'no_login' };
  if (expected.forbidden_account_sha256.includes(id.account_sha256)) return { ok: false, reason: 'forbidden' };
  if (id.account_sha256 !== expected.account_sha256 || id.org_sha256 !== expected.org_sha256) return { ok: false, reason: 'mismatch' };
  if (id.plan !== expected.plan) return { ok: false, reason: 'wrong_plan' };
  return { ok: true, reason: 'match' };
}

/** Whether a session's own config (after the run) still names the enrolled account. */
export const sameAccountAfter = (configDir, expected = readExpected()) => {
  const id = identityOf(configDir);
  return expected !== null && id !== null && id.account_sha256 === expected.account_sha256 && id.org_sha256 === expected.org_sha256;
};

/** Writes the expected identity (hashes and plan, nothing else) from a login folder, mode 0600. */
export function writeExpected(loginDir, { file = EXPECTED_FILE(), forbidden = [] } = {}) {
  const id = identityOf(loginDir);
  if (id === null) throw new Error('that folder holds no usable login');
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ org_sha256: id.org_sha256, account_sha256: id.account_sha256, plan: id.plan, forbidden_account_sha256: forbidden, made_by: 'account/enroll.mjs' }, null, 2)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  return { plan: id.plan };
}
