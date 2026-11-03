// Tests of the trust of Codex's plugin hooks by configuration. The pure parts need nothing; the integration part runs the PINNED
// Codex binary against a throwaway home (plugin install and the app-server's hook listing, which call no model and need no
// network and no key) and is skipped when the binary is not installed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkListing, EXPECTED_HOOK_KEYS, installedPluginDir, listHooks, trustPluginHooks, trustToml } from './codex-trust.mjs';

const KIT = fileURLToPath(new URL('..', import.meta.url));
const kit = JSON.parse(readFileSync(join(KIT, 'kit.json'), 'utf8'));
const DIR = '/home/x/codex/plugins/cache/mnema/mnema/0.1.4';
const hook = (key, over = {}) => ({
  key,
  eventName: 'sessionStart',
  handlerType: 'command',
  command: `node "${DIR}/hooks/h.mjs" --host codex`,
  sourcePath: `${DIR}/hooks/codex.json`,
  source: 'plugin',
  pluginId: 'mnema@mnema',
  isManaged: false,
  currentHash: `sha256:${'a'.repeat(64)}`,
  trustStatus: 'untrusted',
  enabled: true,
  ...over,
});
const listing = (over = {}) => ({ cwd: '/p', errors: [], warnings: [], hooks: EXPECTED_HOOK_KEYS.map((k) => hook(k)), ...over });

test('the listing of exactly the pinned plugin hooks is accepted, in the order of the keys', () => {
  const hooks = checkListing(listing({ hooks: [...EXPECTED_HOOK_KEYS].reverse().map((k) => hook(k)) }), { pluginDir: DIR });
  assert.deepEqual(hooks.map((h) => h.key), EXPECTED_HOOK_KEYS);
});

for (const [name, entry, why] of [
  ['an extra hook', listing({ hooks: [...EXPECTED_HOOK_KEYS.map((k) => hook(k)), hook('mnema@mnema:hooks/codex.json:stop:0:0')] }), /other than the pinned/],
  ['a missing hook', listing({ hooks: EXPECTED_HOOK_KEYS.slice(1).map((k) => hook(k)) }), /other than the pinned/],
  ['a hook of the user, not of the plugin', listing({ hooks: EXPECTED_HOOK_KEYS.map((k, i) => hook(k, i === 0 ? { source: 'user' } : {})) }), /not the pinned plugin/],
  ['a hook of another plugin', listing({ hooks: EXPECTED_HOOK_KEYS.map((k, i) => hook(k, i === 0 ? { pluginId: 'evil@mnema' } : {})) }), /not the pinned plugin/],
  ['a managed hook', listing({ hooks: EXPECTED_HOOK_KEYS.map((k, i) => hook(k, i === 0 ? { isManaged: true } : {})) }), /managed/],
  ['a hook that is not a command', listing({ hooks: EXPECTED_HOOK_KEYS.map((k, i) => hook(k, i === 0 ? { handlerType: 'prompt' } : {})) }), /expected command/],
  ['a file outside the plugin folder', listing({ hooks: EXPECTED_HOOK_KEYS.map((k, i) => hook(k, i === 0 ? { sourcePath: '/home/x/other/codex.json' } : {})) }), /not inside/],
  ['a command that runs something outside the plugin', listing({ hooks: EXPECTED_HOOK_KEYS.map((k, i) => hook(k, i === 0 ? { command: 'sh -c "curl evil"' } : {})) }), /does not run a file/],
  ['a hash that is not the host\'s shape', listing({ hooks: EXPECTED_HOOK_KEYS.map((k, i) => hook(k, i === 0 ? { currentHash: 'trust-me' } : {})) }), /currentHash/],
  ['an error the host reports', listing({ errors: [{ path: 'x', message: 'bad hooks file' }] }), /hook errors/],
]) {
  test(`the listing is refused with ${name}`, () => {
    assert.throws(() => checkListing(entry, { pluginDir: DIR }), why);
  });
}

test('the trust is one hooks.state table per hook, keyed as the host keys it, with the hash the host reported', () => {
  const hooks = EXPECTED_HOOK_KEYS.map((k, i) => hook(k, { currentHash: `sha256:${String(i).repeat(64)}` }));
  const toml = trustToml(hooks);
  for (const [i, k] of EXPECTED_HOOK_KEYS.entries()) assert.ok(toml.includes(`[hooks.state."${k}"]\ntrusted_hash = "sha256:${String(i).repeat(64)}"`), k);
  assert.equal(toml.match(/\[hooks\.state\./g).length, 4);
});

test('a host that does not call the hooks trusted after the write makes the trust fail, and the failure names them', async () => {
  const root = mkdtempSync(join(process.env.ABFB_TMP ?? tmpdir(), 'abfb-trust-fake-'));
  roots.push(root);
  const codexHome = join(root, 'codex');
  const pluginDir = installedPluginDir(codexHome, '0.1.4');
  const pinned = join(root, 'pinned');
  for (const d of [pluginDir, pinned]) {
    mkdirSync(join(d, 'hooks'), { recursive: true });
    writeFileSync(join(d, 'hooks', 'codex.json'), '{}');
  }
  writeFileSync(join(codexHome, 'config.toml'), '');
  const fake = (status) => async () => listing({ hooks: EXPECTED_HOOK_KEYS.map((k) => hook(k, { command: `node "${pluginDir}/hooks/h.mjs"`, sourcePath: `${pluginDir}/hooks/codex.json`, trustStatus: status })) });
  await assert.rejects(trustPluginHooks({ binary: 'x', env: { CODEX_HOME: codexHome }, cwd: '/p', pinnedPluginDir: pinned, pluginVersion: '0.1.4', list: fake('modified') }), /does not count as trusted/);
  const done = await trustPluginHooks({ binary: 'x', env: { CODEX_HOME: codexHome }, cwd: '/p', pinnedPluginDir: pinned, pluginVersion: '0.1.4', list: fake('trusted') });
  assert.equal(done.after.length, 4);
});

// ---- the real binary -----------------------------------------------------------------------------------------------
const binary = join(KIT, kit.hosts.codex.bin);
const pluginTag = join(KIT, 'plugin-tag');
const haveBinary = existsSync(binary) && existsSync(join(pluginTag, 'plugin', 'hooks', 'codex.json'));
const roots = [];
after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

function throwawayHome() {
  const root = mkdtempSync(join(process.env.ABFB_TMP ?? tmpdir(), 'abfb-trust-'));
  roots.push(root);
  const home = join(root, 'home');
  const project = join(root, 'project');
  const codexHome = join(root, 'codex');
  for (const d of [home, project, codexHome]) mkdirSync(d, { recursive: true });
  writeFileSync(join(codexHome, 'config.toml'), 'check_for_update_on_startup = false\n[analytics]\nenabled = false\n');
  const env = { HOME: home, PATH: `/usr/bin:/bin`, LANG: 'C.UTF-8', CODEX_HOME: codexHome, TERM: 'dumb' };
  for (const args of [
    ['plugin', 'marketplace', 'add', pluginTag],
    ['plugin', 'add', 'mnema@mnema'],
  ]) {
    const r = spawnSync(binary, args, { cwd: project, env, encoding: 'utf8' });
    assert.equal(r.status, 0, `${args.join(' ')}: ${r.stderr}${r.stdout}`);
  }
  return { env, project, codexHome };
}

test('the real host: untrusted at first, trusted by the configuration alone, modified by a hash that is not its own', { skip: !haveBinary, timeout: 120_000 }, async () => {
  const { env, project, codexHome } = throwawayHome();
  const first = await listHooks({ binary, env, cwd: project });
  assert.deepEqual(first.hooks.map((h) => h.key).sort(), [...EXPECTED_HOOK_KEYS].sort());
  assert.ok(first.hooks.every((h) => h.trustStatus === 'untrusted'), 'nothing is trusted before the configuration');

  // A hash that is not the host's own: the control that the configuration is what decides.
  appendFileSync(join(codexHome, 'config.toml'), `\n[hooks.state.${JSON.stringify(EXPECTED_HOOK_KEYS[0])}]\ntrusted_hash = "sha256:${'0'.repeat(64)}"\n`);
  const wrong = await listHooks({ binary, env, cwd: project });
  assert.equal(wrong.hooks.find((h) => h.key === EXPECTED_HOOK_KEYS[0]).trustStatus, 'modified');
  assert.ok(wrong.hooks.filter((h) => h.key !== EXPECTED_HOOK_KEYS[0]).every((h) => h.trustStatus === 'untrusted'));
});

test('the real host: trustPluginHooks makes every hook of the pinned plugin trusted, writing only into the home it was given', { skip: !haveBinary, timeout: 120_000 }, async () => {
  const { env, project, codexHome } = throwawayHome();
  const done = await trustPluginHooks({ binary, env, cwd: project, pinnedPluginDir: join(pluginTag, 'plugin'), pluginVersion: kit.mnema.version });
  assert.deepEqual(done.before.map((h) => h.trustStatus), ['untrusted', 'untrusted', 'untrusted', 'untrusted']);
  assert.deepEqual(done.after.map((h) => h.trustStatus), ['trusted', 'trusted', 'trusted', 'trusted']);
  const config = readFileSync(join(codexHome, 'config.toml'), 'utf8');
  assert.equal(config.match(/\[hooks\.state\./g).length, 4);
  assert.ok(!config.includes('dangerously'));
});

test('the real host: a plugin that is not the pinned tree is refused before anything is written', { skip: !haveBinary, timeout: 120_000 }, async () => {
  const { env, project, codexHome } = throwawayHome();
  appendFileSync(join(installedPluginDir(codexHome, kit.mnema.version), 'hooks', 'session-start.mjs'), '\n// changed after the install\n');
  const before = readFileSync(join(codexHome, 'config.toml'), 'utf8');
  await assert.rejects(trustPluginHooks({ binary, env, cwd: project, pinnedPluginDir: join(pluginTag, 'plugin'), pluginVersion: kit.mnema.version }), /not the pinned tree/);
  assert.equal(readFileSync(join(codexHome, 'config.toml'), 'utf8'), before);
});
