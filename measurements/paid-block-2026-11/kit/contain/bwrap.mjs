// The containment of a headless session (a port of sandbox.py of the 27 October kits). Sessions run with every permission granted
// (`--dangerously-skip-permissions`), so the walls are the kernel's: bubblewrap with a new user, pid, ipc, uts, cgroup and NETWORK namespace and an
// empty tmpfs for a root.
//   read only   /usr, a short list of /etc, what `ro` lists at the same path (the Claude Code folder, the mnema prefix, the plugin marketplace)
//   read-write  the clone of the run, a HOME of its own (mounted at /home/[SANDBOX]), the MNEMA_HOME and the CLAUDE_CONFIG_DIR of the run, the
//               npm cache and the pnpm store of the kit, a /tmp that dies with the session
//   invisible   everything else: the real home, ~/.claude, ~/.claude.json, ~/.mnema, ~/.ssh, the other clones, /var, /mnt, /opt
//   network     none of its own: a bridge inside (netbridge.py) forwards 127.0.0.1:3128 to a unix socket that the runner serves (the allow-list
//               proxy, or in a dry run a fake model endpoint). Nothing else is reachable.
// The environment is built from nothing: nothing of the caller's reaches it and it holds no credential at all: the login's credential is a file
// of the session's own config folder (lib/login.mjs).
import { existsSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BRIDGE_PORT = 3128;
export const SANDBOX_HOME = '/home/[SANDBOX]';
export const BRIDGE_FILE = join(dirname(fileURLToPath(import.meta.url)), 'netbridge.py');
const ETC = ['ssl', 'ca-certificates', 'alternatives', 'passwd', 'group', 'nsswitch.conf', 'ld.so.cache', 'localtime', 'hosts', 'resolv.conf', 'mime.types', 'protocols', 'services'];

/**
 * @param {{path: string, mnemaHome: string, configDir: string, npmCache: string, pnpmStore?: string, baseUrl?: string}} spec
 * `baseUrl` is only for the dry run (a fake endpoint over the bridge): ANTHROPIC_BASE_URL is set only then.
 */
export function sessionEnv(spec) {
  const url = `http://127.0.0.1:${BRIDGE_PORT}`;
  const env = {
    HOME: SANDBOX_HOME,
    PATH: spec.path,
    TMPDIR: '/tmp',
    LANG: 'C.UTF-8',
    TERM: 'dumb',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    MNEMA_HOME: spec.mnemaHome,
    CLAUDE_CONFIG_DIR: spec.configDir,
    DISABLE_AUTOUPDATER: '1',
    npm_config_cache: spec.npmCache,
    npm_config_update_notifier: 'false',
    npm_config_fund: 'false',
    HTTPS_PROXY: url,
    HTTP_PROXY: url,
    https_proxy: url,
    http_proxy: url,
    npm_config_https_proxy: url,
    npm_config_proxy: url,
    NODE_USE_ENV_PROXY: '1',
  };
  if (spec.pnpmStore) env.npm_config_store_dir = spec.pnpmStore;
  if (spec.baseUrl) {
    env.ANTHROPIC_BASE_URL = url;
    env.NO_PROXY = '127.0.0.1';
    env.no_proxy = '127.0.0.1';
    for (const k of ['HTTPS_PROXY', 'HTTP_PROXY', 'https_proxy', 'http_proxy', 'npm_config_https_proxy', 'npm_config_proxy', 'NODE_USE_ENV_PROXY']) delete env[k];
  }
  return env;
}

/** Arm A has no mnema command: a machine's own is a link into a package under .../@mnema, and that folder is hidden behind an empty tmpfs. */
export function maskMnemaArgv(exists = existsSync, real = realpathSync) {
  const out = [];
  for (const p of ['/usr/bin/mnema', '/usr/local/bin/mnema']) {
    if (!exists(p)) continue;
    const parts = real(p).split('/');
    const i = parts.indexOf('@mnema');
    if (i >= 0) out.push('--tmpfs', parts.slice(0, i + 1).join('/'));
  }
  return out;
}

/** spec: runDir, homeDir, mnemaHome, configDir, npmCache, pnpmStore, ro (paths mounted read only at the same path), path, sockDir, maskMnema, token, baseUrl. */
export function bwrapArgv(spec, command) {
  const a = ['bwrap', '--die-with-parent', '--new-session', '--unshare-user', '--unshare-pid', '--unshare-ipc', '--unshare-uts', '--unshare-cgroup-try', '--unshare-net'];
  a.push('--ro-bind', '/usr', '/usr', '--symlink', 'usr/bin', '/bin', '--symlink', 'usr/lib', '/lib', '--symlink', 'usr/lib64', '/lib64', '--symlink', 'usr/sbin', '/sbin');
  for (const name of ETC) if (existsSync(`/etc/${name}`)) a.push('--ro-bind', realpathSync(`/etc/${name}`), `/etc/${name}`);
  a.push('--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp');
  if (spec.maskMnema !== false) a.push(...maskMnemaArgv());
  for (const p of spec.ro ?? []) a.push('--ro-bind', p, p);
  for (const p of [spec.runDir, spec.mnemaHome, spec.configDir, spec.npmCache, spec.pnpmStore].filter(Boolean)) a.push('--bind', p, p);
  a.push('--bind', spec.homeDir, SANDBOX_HOME);
  a.push('--bind', spec.sockDir, spec.sockDir, '--ro-bind', BRIDGE_FILE, '/netbridge.py');
  a.push('--remount-ro', '/', '--chdir', spec.runDir, '--clearenv');
  for (const [k, v] of Object.entries(sessionEnv(spec))) a.push('--setenv', k, v);
  a.push('--', '/usr/bin/python3', '-I', '/netbridge.py', join(spec.sockDir, 'proxy.sock'), String(BRIDGE_PORT), '--', ...command);
  return a;
}

/** `systemd-run --user --scope` with a memory cap, swap off and a CPU quota, in front of bubblewrap. */
export const scopeArgv = (name, { mem = '4G', cpu = '200%' } = {}) => ['systemd-run', '--user', '--scope', '--quiet', `--unit=${name}`, '-p', `MemoryMax=${mem}`, '-p', 'MemorySwapMax=0', '-p', `CPUQuota=${cpu}`, '--'];
