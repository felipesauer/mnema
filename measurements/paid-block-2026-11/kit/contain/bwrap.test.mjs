import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BRIDGE_FILE, bwrapArgv, sessionEnv } from './bwrap.mjs';

const mk = () => {
  const d = mkdtempSync(join(tmpdir(), 'abp-bw-'));
  const spec = { runDir: join(d, 'clone'), homeDir: join(d, 'home'), mnemaHome: join(d, 'mh'), configDir: join(d, 'cfg'), npmCache: join(d, 'npm'), pnpmStore: join(d, 'pnpm'), sockDir: join(d, 'sock'), path: '/usr/bin:/bin', ro: [] };
  for (const k of ['runDir', 'homeDir', 'mnemaHome', 'configDir', 'npmCache', 'pnpmStore', 'sockDir']) mkdirSync(spec[k]);
  return { d, spec };
};

test('the session environment carries no credential at all: the login is a file of the config folder', () => {
  const { spec } = mk();
  const argv = bwrapArgv(spec, ['claude', '-p', 'prompt']);
  assert.ok(!argv.some((a) => /TOKEN|API_KEY|AUTH_TOKEN/.test(a)));
  assert.ok(argv.includes('--unshare-net') && argv.includes('--clearenv'));
  assert.deepEqual(argv.slice(-3), ['claude', '-p', 'prompt']);
});

test('nothing of the real home, ~/.claude or ~/.mnema is bound', () => {
  const { spec } = mk();
  const binds = bwrapArgv(spec, ['true']).filter((a) => a.startsWith('/') && !a.startsWith('/etc/') && a !== '/usr' && a !== '/netbridge.py' && a !== BRIDGE_FILE);
  const outside = binds.filter((p) => !p.startsWith(tmpdir()) && !['/proc', '/dev', '/tmp', '/', '/home/[SANDBOX]', '/usr/bin:/bin', '/usr/bin/python3'].includes(p) && !p.startsWith('/usr/') && !p.startsWith('/netbridge'));
  assert.deepEqual(outside.filter((p) => /\.claude|\.mnema|\.ssh|\.config|\/home\/[USER]/.test(p)), []);
});

test('the dry-run environment points at the bridge and has no proxy variables; the live one has the proxy and no base URL', () => {
  const { spec } = mk();
  const live = sessionEnv(spec);
  assert.equal(live.HTTPS_PROXY, 'http://127.0.0.1:3128');
  assert.equal(live.ANTHROPIC_BASE_URL, undefined);
  const dry = sessionEnv({ ...spec, baseUrl: 'x' });
  assert.equal(dry.ANTHROPIC_BASE_URL, 'http://127.0.0.1:3128');
  assert.equal(dry.HTTPS_PROXY, undefined);
});

test('inside the box the environment is only what was set, the real home is not there, and a write outside the bound folders fails (runs bubblewrap)', () => {
  const { d, spec } = mk();
  writeFileSync(join(spec.sockDir, 'proxy.sock.placeholder'), '');
  const inner = ['/usr/bin/sh', '-c', 'env | sort; echo ---; ls -A /home; echo ---; (echo x > /usr/x) 2>&1 | head -1; test -e /home/[USER] && echo REALHOME || echo no-real-home; echo ---; touch /tmp/ok && echo tmp-ok'];
  const argv = bwrapArgv(spec, inner);
  const out = execFileSync(argv[0], argv.slice(1), { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } });
  const [env, homes, ...restParts] = out.split('---\n');
  const rest = restParts.join('');
  const names = env.split('\n').filter(Boolean).map((l) => l.split('=')[0]);
  for (const bad of ['SSH_AUTH_SOCK', 'ANTHROPIC_API_KEY', 'USER', 'LOGNAME']) assert.ok(!names.includes(bad), bad);
  assert.ok(!names.includes('CLAUDE_CODE_OAUTH_TOKEN') && names.includes('MNEMA_HOME') && names.includes('CLAUDE_CONFIG_DIR'));
  assert.equal(homes.trim(), 'sandbox');
  assert.match(rest, /no-real-home/);
  assert.match(rest, /tmp-ok/);
  assert.ok(d.length > 0);
});
