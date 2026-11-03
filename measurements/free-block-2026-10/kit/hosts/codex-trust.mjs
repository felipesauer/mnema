// HOW CODEX 0.161.0 TRUSTS A PLUGIN'S HOOKS BY CONFIGURATION, without `--dangerously-bypass-hook-trust` and without
// `--dangerously-bypass-approvals-and-sandbox` (the maintainer's ruling of 29 October on ADR-119, observation 01a1897f-99c4).
//
// What the host does (read off the binary and proved with its own app-server, no model request): a plugin's hook is not run
// until it is TRUSTED. `hooks/list` of the app-server gives each hook a `key`
// (`<plugin>@<marketplace>:<hooks file>:<event>:<group>:<index>`), a `currentHash` (the host's own hash of the hook as it
// stands: its command text, which carries the path of the plugin in the session's CODEX_HOME, so it differs per home) and a
// `trustStatus`: `untrusted` (nothing persisted), `trusted` (the persisted hash is the current one), `modified` (a persisted
// hash that is not the current one: the hook changed since it was reviewed). A person gives the trust in the host's `/hooks`
// screen, and the host persists it in the user's `config.toml` as
//
//   [hooks.state."<key>"]
//   trusted_hash = "<currentHash>"
//
// That file is the throwaway CODEX_HOME's own, so writing it is the same act, in the session's home and nowhere else.
// The kit does not take the hash on faith: before it writes anything it requires that (1) the plugin the host installed in
// that home is byte-identical to the pinned plugin tree of the kit, (2) the host lists exactly the hooks that tree declares
// (the keys are fixed below), all of source `plugin`, plugin id `mnema@mnema`, type `command`, none managed, each file of
// them inside that plugin's folder, and (3) afterwards the host itself reports each of them `trusted`.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** The hooks of the pinned plugin's Codex file (`plugin/hooks/codex.json`), by the host's key. Changing the plugin changes this. */
export const EXPECTED_HOOK_KEYS = [
  'mnema@mnema:hooks/codex.json:pre_tool_use:0:0',
  'mnema@mnema:hooks/codex.json:post_tool_use:0:0',
  'mnema@mnema:hooks/codex.json:session_start:0:0',
  'mnema@mnema:hooks/codex.json:session_start:0:1',
];
export const PLUGIN_ID = 'mnema@mnema';

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

function filesOf(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? filesOf(join(dir, e.name)) : [join(dir, e.name)]))
    .sort();
}

/** The sha256 of every file of a folder, by relative path. */
export function treeOf(dir) {
  return Object.fromEntries(filesOf(dir).map((f) => [relative(dir, f).split(sep).join('/'), sha(readFileSync(f))]));
}

/** Where the host puts the installed plugin: `<CODEX_HOME>/plugins/cache/<marketplace>/<plugin>/<version>`. */
export function installedPluginDir(codexHome, version) {
  return join(codexHome, 'plugins', 'cache', 'mnema', 'mnema', version);
}

/**
 * Asks the host's app-server which hooks it sees from `cwd`, and how it counts their trust. No model is called: this is the
 * host's own listing, over its stdio.
 */
export async function listHooks({ binary, env, cwd, timeoutMs = 30_000 }) {
  const child = spawn(binary, ['app-server', '--listen', 'stdio://'], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map();
  let buffer = '';
  let stderr = '';
  let n = 0;
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
      const line = buffer.slice(0, i);
      buffer = buffer.slice(i + 1);
      if (line.trim() === '') continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (message.id !== undefined && pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
      }
    }
  });
  child.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk.toString('utf8')).slice(-2000);
  });
  const call = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++n;
      const timer = setTimeout(() => reject(new Error(`app-server did not answer ${method} in ${timeoutMs} ms; stderr: ${stderr.slice(-300)}`)), timeoutMs);
      pending.set(id, (message) => {
        clearTimeout(timer);
        if (message.error !== undefined) reject(new Error(`app-server ${method}: ${JSON.stringify(message.error)}`));
        else resolve(message.result);
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  try {
    await call('initialize', { clientInfo: { name: 'ab-free-block-kit', title: null, version: '0' }, capabilities: null });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'initialized' })}\n`);
    const result = await call('hooks/list', { cwds: [cwd] });
    const entry = (result.data ?? []).find((e) => e.cwd === cwd) ?? (result.data ?? [])[0];
    if (entry === undefined) throw new Error('hooks/list returned no entry for the working directory');
    return entry;
  } finally {
    child.kill('SIGKILL');
  }
}

/**
 * Refuses, with its reason, a listing that is not exactly the pinned plugin's hooks as the host installed them. Returns the
 * hooks (keyed, in the order of EXPECTED_HOOK_KEYS) when it is.
 */
export function checkListing(entry, { pluginDir, expectedKeys = EXPECTED_HOOK_KEYS, pluginId = PLUGIN_ID }) {
  if ((entry.errors ?? []).length > 0) throw new Error(`the host reports hook errors: ${JSON.stringify(entry.errors)}`);
  const hooks = entry.hooks ?? [];
  const keys = hooks.map((h) => h.key).sort();
  const want = [...expectedKeys].sort();
  if (JSON.stringify(keys) !== JSON.stringify(want)) {
    throw new Error(`the host lists hooks other than the pinned plugin's: got ${JSON.stringify(keys)}, expected ${JSON.stringify(want)}`);
  }
  for (const h of hooks) {
    if (h.source !== 'plugin' || h.pluginId !== pluginId) throw new Error(`${h.key}: source ${h.source}, plugin ${h.pluginId}; not the pinned plugin's`);
    if (h.handlerType !== 'command') throw new Error(`${h.key}: handler ${h.handlerType}, expected command`);
    if (h.isManaged === true) throw new Error(`${h.key}: a managed hook is not ours to trust`);
    if (typeof h.currentHash !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(h.currentHash)) throw new Error(`${h.key}: no usable currentHash`);
    const inside = (p) => typeof p === 'string' && (p === pluginDir || p.startsWith(`${pluginDir}${sep}`));
    if (!inside(h.sourcePath)) throw new Error(`${h.key}: its file ${h.sourcePath} is not inside ${pluginDir}`);
    if (!String(h.command).includes(`${pluginDir}${sep}hooks${sep}`)) throw new Error(`${h.key}: its command does not run a file of ${pluginDir}/hooks`);
  }
  return expectedKeys.map((k) => hooks.find((h) => h.key === k));
}

/** The text appended to the home's config.toml: one `hooks.state` table per hook, with the hash the host reported. */
export function trustToml(hooks) {
  return `\n${hooks.map((h) => `[hooks.state.${JSON.stringify(h.key)}]\ntrusted_hash = ${JSON.stringify(h.currentHash)}\n`).join('\n')}`;
}

/**
 * Trusts the pinned plugin's hooks in the home of `env` (its CODEX_HOME): lists them, checks the listing and that the installed
 * plugin is the pinned tree, writes the trust into the home's config.toml, and has the host say each is `trusted`. Returns what
 * it did, for the log of the run (no secret in it). Throws, and leaves the config untouched, when a check fails.
 */
export async function trustPluginHooks({ binary, env, cwd, pinnedPluginDir, pluginVersion, list = listHooks }) {
  const codexHome = env.CODEX_HOME;
  const pluginDir = installedPluginDir(codexHome, pluginVersion);
  const installed = treeOf(pluginDir);
  const pinned = treeOf(pinnedPluginDir);
  if (JSON.stringify(installed) !== JSON.stringify(pinned)) {
    const differing = [...new Set([...Object.keys(installed), ...Object.keys(pinned)])].filter((f) => installed[f] !== pinned[f]);
    throw new Error(`the plugin the host installed is not the pinned tree (differs: ${differing.slice(0, 5).join(', ')})`);
  }
  const before = await list({ binary, env, cwd });
  const hooks = checkListing(before, { pluginDir });
  appendFileSync(join(codexHome, 'config.toml'), trustToml(hooks));
  const after = checkListing(await list({ binary, env, cwd }), { pluginDir });
  const notTrusted = after.filter((h) => h.trustStatus !== 'trusted');
  if (notTrusted.length > 0) throw new Error(`the host does not count as trusted: ${notTrusted.map((h) => `${h.key} (${h.trustStatus})`).join(', ')}`);
  return {
    pluginFiles: Object.keys(installed).length,
    before: hooks.map((h) => ({ key: h.key, trustStatus: h.trustStatus })),
    after: after.map((h) => ({ key: h.key, trustStatus: h.trustStatus, event: h.eventName, matcher: h.matcher })),
  };
}
