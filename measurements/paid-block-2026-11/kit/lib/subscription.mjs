// THE BLOCK RUNS ON THE PRO SUBSCRIPTION, NEVER ON THE API (the maintainer, 3 November 2026), with the LOGIN of the personal account as its credential
// (lib/login.mjs). What the docs say (code.claude.com/docs/en/authentication, read 3 November 2026, "Authentication precedence"): ANTHROPIC_AUTH_TOKEN,
// ANTHROPIC_API_KEY, cloud-provider variables, apiKeyHelper and CLAUDE_CODE_OAUTH_TOKEN all rank ABOVE the subscription login, so any of them in a
// session's environment or settings would bill something else or another account. This module refuses them before a session starts and proves, from what
// Claude Code itself reports, that the session was on the subscription:
//   before: the environment holds none of them (and ANTHROPIC_BASE_URL only in a dry run); no settings file of the config folder or of the clone sets
//           one; `claude auth status --json` run on the session's own config folder, with NO network, says loggedIn, authMethod `claude.ai` (not oauth_token,
//           api_key, api_key_helper or third_party), no apiKeySource, the plan `pro`, and an orgId whose hash is the enrolled one; an earlier smoke session
//           proved the next point.
//   after:  the init event says apiKeySource is neither ANTHROPIC_API_KEY nor apiKeyHelper, and the stream holds a `rate_limit_event` of the
//           subscription's windows (rateLimitType five_hour or seven_day): an API-key session has no such event. A session without it is discarded.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export const FORBIDDEN_ENV = [
  'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_PROFILE', 'ANTHROPIC_FEDERATION_RULE_ID', 'ANTHROPIC_ORGANIZATION_ID', 'ANTHROPIC_IDENTITY_TOKEN_FILE',
  'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY', 'CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR', 'CLAUDE_CODE_OAUTH_REFRESH_TOKEN', 'AWS_BEARER_TOKEN_BEDROCK',
];
const FORBIDDEN_SETTING_KEYS = ['apiKeyHelper', 'awsAuthRefresh', 'awsCredentialExport', 'gcpAuthRefresh'];

/** Throws unless the environment is the subscription's alone. `dry` lets the fake endpoint's ANTHROPIC_BASE_URL through (no credential exists then). */
export function assertSubscriptionEnv(env, { mode }) {
  const bad = FORBIDDEN_ENV.filter((k) => env[k] !== undefined && !(mode === 'dry' && k === 'ANTHROPIC_BASE_URL'));
  if (bad.length) throw new Error(`the session environment carries what would not bill the subscription: ${bad.join(', ')}`);
}

/** Problems in the settings a session would read: the config folder's and the clone's (.claude/settings*.json, which can carry apiKeyHelper and env). */
export function settingsProblems(dirs) {
  const out = [];
  for (const dir of dirs) {
    const places = [dir, join(dir, '.claude')].filter(existsSync);
    for (const p of places) {
      for (const f of readdirSync(p).filter((n) => /^settings.*\.json$/.test(n))) {
        let j;
        try {
          j = JSON.parse(readFileSync(join(p, f), 'utf8'));
        } catch {
          out.push(`${f} is not JSON`);
          continue;
        }
        for (const k of FORBIDDEN_SETTING_KEYS) if (j[k] !== undefined) out.push(`${f} sets ${k}`);
        for (const k of Object.keys(j.env ?? {})) if (FORBIDDEN_ENV.includes(k) || /^ANTHROPIC_/.test(k)) out.push(`${f} sets env ${k}`);
        if (j.forceLoginMethod === 'console') out.push(`${f} forces the console login`);
      }
    }
  }
  return out;
}

/**
 * What Claude Code reports about the login in a session's config folder, run inside bubblewrap with NO network (so it cannot make a request, and a
 * refresh of the credentials cannot happen): the method, the plan, and whether the organization it names is the enrolled one (compared as a hash;
 * nothing else is returned).
 */
export function authStatusOf({ claudeBin, configDir, expectedOrgSha256 }) {
  const home = mkdtempSync(join(tmpdir(), 'abp-auth-'));
  try {
    const argv = ['--unshare-net', '--die-with-parent', '--ro-bind', '/usr', '/usr', '--symlink', 'usr/bin', '/bin', '--symlink', 'usr/lib', '/lib', '--symlink', 'usr/lib64', '/lib64', '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--ro-bind', dirname(claudeBin), dirname(claudeBin), '--bind', configDir, configDir, '--bind', home, '/h', '--clearenv', '--setenv', 'HOME', '/h', '--setenv', 'PATH', '/usr/bin', '--setenv', 'CLAUDE_CONFIG_DIR', configDir, '--setenv', 'DISABLE_AUTOUPDATER', '1', '--', claudeBin, 'auth', 'status', '--json'];
    const j = JSON.parse(execFileSync('bwrap', argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
    const org = j.orgId ? createHash('sha256').update(String(j.orgId).trim().toLowerCase()).digest('hex') : null;
    return { ok: j.loggedIn === true && j.authMethod === 'claude.ai' && !j.apiKeySource && j.subscriptionType === 'pro' && org !== null && org === expectedOrgSha256, authMethod: j.authMethod ?? null, plan: j.subscriptionType ?? null };
  } catch {
    return { ok: false, authMethod: null, plan: null };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

/** From a finished stream: the session was on the subscription. */
export function subscriptionProof(events) {
  const init = events.find((e) => e.type === 'system' && e.subtype === 'init');
  if (!init) return { ok: false, reason: 'no init event' };
  if (['ANTHROPIC_API_KEY', 'apiKeyHelper'].includes(init.apiKeySource)) return { ok: false, reason: `apiKeySource is ${init.apiKeySource}` };
  const windows = events.some((e) => e.type === 'rate_limit_event' && ['five_hour', 'seven_day'].includes(e.rate_limit_info?.rateLimitType));
  return windows ? { ok: true, reason: 'subscription rate-limit event seen' } : { ok: false, reason: 'no subscription rate-limit event in the stream' };
}
