// Records, as hashes and the plan name and nothing more, which account the block runs on, from the maintainer's own login folder (secrets/login).
//   node account/enroll.mjs from-login           reads the folder's files (no API call, no claude run); prints "enrolled" and the plan name
//   node account/enroll.mjs forbid <sha256...>   adds the ACCOUNT hashes of accounts the block must never run on
//   node account/enroll.mjs check                the check a session makes before it starts (files only)
import { readFileSync, writeFileSync } from 'node:fs';
import { checkAccount, EXPECTED_FILE, readExpected, writeExpected } from './account.mjs';
import { LOGIN_DIR } from '../lib/login.mjs';

const [cmd, ...args] = process.argv.slice(2);
if (cmd === 'from-login') {
  const prior = readExpected();
  const r = writeExpected(LOGIN_DIR(), { forbidden: prior?.forbidden_account_sha256 ?? [] });
  console.log(`enrolled (plan: ${r.plan})`);
} else if (cmd === 'forbid') {
  if (readExpected() === null) throw new Error('enroll first');
  const file = EXPECTED_FILE();
  const j = JSON.parse(readFileSync(file, 'utf8'));
  j.forbidden_account_sha256 = [...new Set([...(j.forbidden_account_sha256 ?? []), ...args])];
  writeFileSync(file, `${JSON.stringify(j, null, 2)}\n`, { mode: 0o600 });
  console.log(`forbidden: ${j.forbidden_account_sha256.length}`);
} else if (cmd === 'check') {
  const r = checkAccount();
  console.log(JSON.stringify(r));
  process.exit(r.ok ? 0 : 1);
} else {
  console.error('usage: node account/enroll.mjs from-login | forbid <sha256...> | check');
  process.exit(2);
}
