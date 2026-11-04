// A FAKE login folder for tests and dry runs: the two files Claude Code keeps, with made-up ids and tokens, a Pro plan and an expiry far in the future (so
// nothing tries to refresh). It is not a credential of anything.
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { identityOf } from '../lib/login.mjs';

export function makeFakeLogin(dir, { accountUuid = 'aaaaaaaa-1111-4222-8333-444444444444', organizationUuid = 'bbbbbbbb-1111-4222-8333-444444444444', plan = 'pro' } = {}) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'sk-ant-oat01-[FAKE]' + 'a'.repeat(30), refreshToken: 'sk-ant-ort01-[FAKE]' + 'b'.repeat(30), expiresAt: 4102444800000, scopes: ['user:inference', 'user:profile'], subscriptionType: plan, rateLimitTier: 'default' } }), { mode: 0o600 });
  chmodSync(join(dir, '.credentials.json'), 0o600);
  writeFileSync(join(dir, '.claude.json'), JSON.stringify({ oauthAccount: { accountUuid, organizationUuid, emailAddress: '[EMAIL]', organizationName: 'Fake' }, history: ['must not cross'], projects: { '/x': {} } }), { mode: 0o600 });
  mkdirSync(join(dir, 'backups'), { recursive: true });
  writeFileSync(join(dir, 'backups', 'must-not-cross.json'), '{}');
  const id = identityOf(dir);
  return { dir, expected: { org_sha256: id.org_sha256, account_sha256: id.account_sha256, plan, forbidden_account_sha256: [] } };
}
