// THE CREDENTIAL OF THE BLOCK IS THE LOGIN (the maintainer, 3 November 2026): a Claude Code login of the personal Pro subscription kept in a config folder
// of the kit (secrets/login, made by `claude auth login` with CLAUDE_CONFIG_DIR pointing at it). The setup-token path is dropped: that token is
// inference-only, names no account, and this kit never reads secrets/claude-oauth.token.
//
// What crosses into a session, and back:
//   in    ONLY .credentials.json (copied whole) and a minimal .claude.json holding the `oauthAccount` object and nothing else. Never settings, plugins, history,
//         projects, caches or backups: the arms stay isolated and nothing of the login's own folder leaks into a session.
//   back  after the session, if it refreshed .credentials.json (its hash differs from what went in) AND the session's own config still names the same account,
//         the credentials are written back to the login folder (a temp file and a rename, mode 0600), so a rotated refresh token never strands the master.
//         Nothing else is copied back, and the session's copy is deleted.
//   one   sessions run strictly one at a time: a lock file in the kit (`withLock`), so no two copies of the credentials refresh at once.
// Identity is read from the FILES, never from the API: oauthAccount.accountUuid and organizationUuid, hashed together and apart; the plan is the
// `subscriptionType` of the credentials. Nothing here prints or returns an id, an address or a token: answers are booleans, reasons and hashes.
import { createHash } from 'node:crypto';
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { KIT, kitJson } from './token.mjs';

export const LOGIN_DIR = (kit = KIT) => join(kit, kitJson().login_dir);
export const LOCK_FILE = (kit = KIT) => join(kit, 'secrets', 'session.lock');
export const CRED = '.credentials.json';
export const GLOBAL = '.claude.json';
const sha = (s) => createHash('sha256').update(String(s).trim().toLowerCase()).digest('hex');
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));

/** { account_sha256, org_sha256, plan } of a config folder, or null when it holds no login. Hashes only; the ids and the address never leave this function. */
export function identityOf(dir) {
  try {
    const acct = readJson(join(dir, GLOBAL)).oauthAccount;
    const cred = readJson(join(dir, CRED)).claudeAiOauth;
    if (!acct?.accountUuid || !acct?.organizationUuid || !cred?.accessToken) return null;
    return { account_sha256: sha(acct.accountUuid), org_sha256: sha(acct.organizationUuid), plan: String(cred.subscriptionType ?? 'unknown') };
  } catch {
    return null;
  }
}

/** The two secret strings of a folder's credentials (for the redactor and the leak scan): [accessToken, refreshToken]. */
export function secretsOf(dir) {
  try {
    const c = readJson(join(dir, CRED)).claudeAiOauth;
    return [c.accessToken, c.refreshToken].filter(Boolean);
  } catch {
    return [];
  }
}

/** Copies the credential into a session's config folder and returns the hash of what went in. Only the two files; the folder must be empty of both. */
export function copyIn(loginDir, configDir) {
  const id = identityOf(loginDir);
  if (id === null) throw new Error('the login folder holds no usable login');
  mkdirSync(configDir, { recursive: true });
  const cred = readFileSync(join(loginDir, CRED));
  writeFileSync(join(configDir, CRED), cred, { mode: 0o600 });
  chmodSync(join(configDir, CRED), 0o600);
  const oauthAccount = readJson(join(loginDir, GLOBAL)).oauthAccount;
  // the session's own .claude.json (a plugin install may have made one) keeps its keys; only oauthAccount comes from the login
  let own = {};
  try {
    own = readJson(join(configDir, GLOBAL));
  } catch {}
  writeFileSync(join(configDir, GLOBAL), `${JSON.stringify({ ...own, oauthAccount })}\n`, { mode: 0o600 });
  return { credentials_sha256: sha256(cred) };
}

/**
 * After a session: the credentials go back to the login folder only if the session refreshed them and its config still names the same account.
 * The session's copy is deleted either way. Returns { refreshed, copied_back, same_account }.
 */
export function copyBack(configDir, loginDir, { wentIn }) {
  const file = join(configDir, CRED);
  const expected = identityOf(loginDir);
  const now = identityOf(configDir);
  const same = expected !== null && now !== null && now.account_sha256 === expected.account_sha256 && now.org_sha256 === expected.org_sha256;
  let refreshed = false;
  let copied = false;
  if (existsSync(file)) {
    const buf = readFileSync(file);
    refreshed = sha256(buf) !== wentIn.credentials_sha256;
    if (refreshed && same) {
      const tmp = join(loginDir, `${CRED}.new`);
      writeFileSync(tmp, buf, { mode: 0o600 });
      chmodSync(tmp, 0o600);
      renameSync(tmp, join(loginDir, CRED));
      copied = true;
    }
    rmSync(file, { force: true });
  }
  return { refreshed, copied_back: copied, same_account: same };
}

/** One session at a time: an exclusive lock file with the pid; a lock whose process is gone is taken over. */
export async function withLock(fn, { file = LOCK_FILE() } = {}) {
  mkdirSync(join(file, '..'), { recursive: true });
  let fd;
  try {
    fd = openSync(file, 'wx');
  } catch {
    let alive = false;
    try {
      process.kill(Number(readFileSync(file, 'utf8')), 0);
      alive = true;
    } catch {}
    if (alive) throw new Error('another session of the kit is running (the lock file names a live process): sessions run one at a time');
    unlinkSync(file);
    fd = openSync(file, 'wx');
  }
  writeFileSync(file, String(process.pid));
  closeSync(fd);
  try {
    return await fn();
  } finally {
    rmSync(file, { force: true });
  }
}
