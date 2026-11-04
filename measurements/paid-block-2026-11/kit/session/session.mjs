// THE RUNNER OF ONE SESSION of one arm: preconditions, a throwaway HOME, CLAUDE_CONFIG_DIR, MNEMA_HOME and clone, the box, the stream, and the ledger line.
// The credential is the login folder's (lib/login.mjs): copied into the session's own config folder, copied back if refreshed, one session at a time.
// Live: the account is checked from the login's files (no API call), the windows must have room, and the network is the allow-list proxy.
// Dry: a fake endpoint answers over the bridge, nothing reaches any network, and the login is a fake one made for the test. Both leave the same files.
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkAccount, readExpected, sameAccountAfter } from '../account/account.mjs';
import { bwrapArgv, scopeArgv, sessionEnv } from '../contain/bwrap.mjs';
import { startProxy } from '../contain/proxy.mjs';
import { copyBack, copyIn, LOGIN_DIR, LOCK_FILE, secretsOf, withLock } from '../lib/login.mjs';
import { assertSubscriptionEnv, authStatusOf, settingsProblems, subscriptionProof } from '../lib/subscription.mjs';
import { appendLedger, readLedger, room, wasCut, windowSize, windowsFrom } from '../lib/quota.mjs';
import { makeRedactor } from '../lib/redact.mjs';
import { KIT, kitJson, scanFolder } from '../lib/token.mjs';
import { ARMS, TASKS } from '../plan/cells.mjs';
import { SIZE } from '../plan/pro.mjs';
import { startFake } from './fake-anthropic.mjs';
import { armProblems, claudeArgs, ENDINGS, MAX_REQUESTS, WALL_CLOCK_MS } from './protocol.mjs';

const kit = kitJson();
export const CLAUDE_BIN = join(KIT, kit.claude_code.bin);
export const MNEMA_BIN_DIR = join(KIT, 'mnema-pkg', 'node_modules', '.bin');
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: '/nonexistent', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }, stdio: ['ignore', 'pipe', 'pipe'] });
/**
 * The environment a spawned process gets: nothing but PATH, and, for `systemd-run` ALONE, the two variables it needs to reach the user's service manager
 * (XDG_RUNTIME_DIR, DBUS_SESSION_BUS_ADDRESS). The box behind it keeps --clearenv, so neither reaches the session.
 */
export function spawnEnvFor(argv, procEnv = process.env) {
  const env = { PATH: '/usr/bin:/bin' };
  if (argv[0] === 'systemd-run') for (const k of ['XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS']) if (procEnv[k]) env[k] = procEnv[k];
  return env;
}
const lines = (text) => text.split('\n').filter((l) => l.startsWith('{')).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });

/** Installs the plugin of the tag's commit into a config folder of the run (no network, no credential). */
export function installPlugin({ configDir, homeDir }) {
  const env = { HOME: homeDir, PATH: '/usr/bin:/bin', CLAUDE_CONFIG_DIR: configDir, DISABLE_AUTOUPDATER: '1' };
  const run = (...a) => execFileSync(CLAUDE_BIN, a, { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  run('plugin', 'marketplace', 'add', join(KIT, 'plugin-tag'));
  run('plugin', 'install', 'mnema@mnema', '--config', `mnema_path=${join(MNEMA_BIN_DIR, 'mnema')}`);
}

/**
 * @param {object} o
 * @param {{id: string, arm: string, task: string, rounds: number}} o.s
 * @param {string} o.runsDir outside any git checkout; o.base the base clone of the (repo, arm); o.prompts the prompt of each round
 * @param {'dry'|'live'} o.mode; o.ledger the ledger file; o.script (dry) the fake model's script; o.now () => Date
 */
export const runSession = (o) => withLock(() => runLocked(o), { file: o.lockFile ?? LOCK_FILE() });

async function runLocked({ s, runsDir, base, prompts, mode, ledger, script, now = () => new Date(), claudeBin = CLAUDE_BIN, size = SIZE, wallClockMs = WALL_CLOCK_MS, kind = 'counted', loginDir = LOGIN_DIR(), expected = readExpected() }) {
  const arm = ARMS[s.arm];
  const dir = join(runsDir, s.id.replace('/', '__'));
  if (existsSync(dir)) throw new Error(`${dir} exists: a session id is used once (a redo has its own folder)`);
  const [clone, home, mnemaHome, config, out] = ['clone', 'home', 'mnema-home', 'config', 'out'].map((n) => join(dir, n));
  // a unix socket path is limited to 107 bytes: the socket lives in a short folder of its own, removed at the end
  const sockDir = mkdtempSync('/tmp/abp-');
  const caches = join(runsDir, 'shared');
  const refuse = (ending, extra = {}) => ({ id: s.id, status: ending, ...extra });
  const windowsBefore = readLedger(ledger).reverse().find((l) => l.windows_after)?.windows_after ?? null;
  const acct = checkAccount({ loginDir, expected });
  if (!acct.ok) return refuse('account', { reason: acct.reason });
  if (mode === 'live') {
    if (kind !== 'smoke' && !readLedger(ledger).some((l) => l.kind === 'smoke' && l.subscription_proof === true)) return refuse('billing', { reason: 'no smoke session has proved the subscription' });
    const r = kind === 'smoke' ? { ok: true } : room({ ledger: readLedger(ledger), now: now(), highUsd: TASKS[s.task].usd[2], size });
    if (!r.ok) return refuse('room', { reason: r.why, wait_until: r.waitUntil ?? null });
  }
  for (const d of [dir, home, mnemaHome, config, out, caches, join(caches, 'npm'), join(caches, 'pnpm')]) mkdirSync(d, { recursive: true });
  git(runsDir, 'clone', '-q', '--no-hardlinks', base, clone);
  git(clone, 'remote', 'remove', 'origin');
  git(clone, 'config', 'user.name', 'kit');
  git(clone, 'config', 'user.email', '[EMAIL]');
  git(clone, 'config', 'commit.gpgsign', 'false');
  if (arm.plugin) installPlugin({ configDir: config, homeDir: home });
  const wentIn = copyIn(loginDir, config);
  const secrets = secretsOf(loginDir);
  const status = authStatusOf({ claudeBin, configDir: config, expectedOrgSha256: expected.org_sha256 });
  if (!status.ok) {
    copyBack(config, loginDir, { wentIn });
    rmSync(dir, { recursive: true, force: true });
    rmSync(sockDir, { recursive: true, force: true });
    return refuse('billing', { reason: `claude reports auth method ${status.authMethod} and plan ${status.plan} for the session's config: not the enrolled Pro login (offline check)` });
  }
  const bad = settingsProblems([config, clone]);
  if (bad.length) return (copyBack(config, loginDir, { wentIn }), rmSync(dir, { recursive: true, force: true }), rmSync(sockDir, { recursive: true, force: true }), refuse('billing', { reason: `settings that would not bill the subscription: ${bad.join('; ')}` }));
  const sock = join(sockDir, 'proxy.sock');
  const fake = mode === 'dry' ? await startFake({ sock, script }) : null;
  const proxy = mode === 'live' ? await startProxy({ sock, log: join(out, 'proxy.log'), allow: undefined }) : null;
  const spec = { runDir: clone, homeDir: home, mnemaHome, configDir: config, npmCache: join(caches, 'npm'), pnpmStore: join(caches, 'pnpm'), sockDir, maskMnema: !arm.cli,
    ro: [join(claudeBin, '..'), ...(arm.plugin ? [join(KIT, 'plugin-tag')] : []), ...(arm.cli || arm.plugin ? [join(KIT, 'mnema-pkg')] : [])],
    path: `${arm.cli ? `${MNEMA_BIN_DIR}:` : ''}/usr/bin:/bin`, baseUrl: mode === 'dry' ? 'fake' : undefined };
  assertSubscriptionEnv(sessionEnv(spec), { mode });
  const sessionId = randomUUID();
  const started = now();
  let ending = 'exited';
  const events = [];
  const ids = new Set();
  for (let round = 1; round <= (s.rounds ?? 1) && ending === 'exited'; round++) {
    const argv = [...(mode === 'live' ? scopeArgv(`abp-${process.pid}-${Date.now()}`) : []), ...bwrapArgv(spec, [claudeBin, ...claudeArgs({ prompt: prompts[round - 1], sessionId, resume: round === 2 })])];
    const streamFile = join(out, `round${round}.jsonl`);
    await new Promise((resolve) => {
      const child = spawn(argv[0], argv.slice(1), { stdio: ['ignore', 'pipe', 'pipe'], env: spawnEnvFor(argv) });
      let buf = '';
      const timer = setTimeout(() => { ending = 'timeout'; child.kill('SIGKILL'); }, wallClockMs);
      child.stdout.on('data', (d) => {
        appendFileSync(streamFile, d);
        buf += d;
        const parts = buf.split('\n');
        buf = parts.pop();
        for (const l of lines(parts.join('\n'))) {
          events.push(l);
          if (l.type === 'assistant' && l.message?.id) ids.add(l.message.id);
        }
        if (ids.size > MAX_REQUESTS && ending === 'exited') { ending = 'budget'; child.kill('SIGKILL'); }
      });
      child.stderr.on('data', (d) => appendFileSync(join(out, `round${round}.err`), d));
      child.on('close', () => { clearTimeout(timer); resolve(); });
    });
  }
  await (fake ?? proxy)?.close();
  rmSync(sockDir, { recursive: true, force: true });
  if (events.length === 0) {
    // nothing ran (the wrapper failed before Claude Code started): no stream, no request. The credential goes back as it came, the folder goes away, the id can run again.
    const why = existsSync(join(out, 'round1.err')) ? readFileSync(join(out, 'round1.err'), 'utf8').split('\n')[0].slice(0, 200) : 'no output';
    copyBack(config, loginDir, { wentIn });
    rmSync(dir, { recursive: true, force: true });
    appendLedger(ledger, { id: s.id, kind, mode, status: 'not_started', reason: why, started_at: started.toISOString(), usd_eq: 0, requests: 0 });
    return refuse('not_started', { reason: why });
  }
  const init = events.find((e) => e.type === 'system' && e.subtype === 'init') ?? {};
  const problems = armProblems(arm, init);
  const cut = wasCut(events);
  if (ending === 'exited' && cut.cut) ending = 'cut';
  if (ending === 'exited' && problems.length) ending = 'arm';
  const proof = subscriptionProof(events);
  if (ending === 'exited' && mode === 'live' && !proof.ok) ending = 'billing';
  const result = events.filter((e) => e.type === 'result');
  const windowsAfter = windowsFrom(events);
  const usd = +result.reduce((a, r) => a + (r.total_cost_usd ?? 0), 0).toFixed(4);
  const back = copyBack(config, loginDir, { wentIn });
  if (ending === 'exited' && !back.same_account) ending = 'account_changed';
  const leak = scanFolder(dir, [...secrets, ...secretsOf(loginDir)]);
  const meta = { id: s.id, kind, arm: s.arm, task: s.task, mode, claude_code: init.claude_code_version ?? null, model: init.model ?? null, api_key_source: init.apiKeySource ?? null,
    started_at: started.toISOString(), ended_at: now().toISOString(), status: ENDINGS[ending].label === 'finished' ? 'finished' : ending, ending, requests: ids.size, usd_eq: usd,
    windows_before: windowsBefore, windows_after: windowsAfter, cut: cut.cut ? cut.reason : null, subscription_proof: proof.ok, subscription_proof_reason: proof.reason, arm_problems: problems, credential_in_run_folder: leak.hits > 0, account_check: acct.reason, same_account_after: back.same_account, credentials_refreshed: back.refreshed, credentials_copied_back: back.copied_back, session_id: sessionId };
  writeFileSync(join(out, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
  if (mode === 'live') appendLedger(ledger, meta);
  else appendLedger(ledger, { ...meta, mode: 'dry' });
  return { ...meta, dir, fake_seen: fake?.seen };
}
export { makeRedactor, windowSize };
