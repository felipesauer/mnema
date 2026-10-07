// usage: node run.mjs download            (needs network; prints the executable)
//        node run.mjs run <out-dir>       (meant for a loopback-only namespace, under xvfb)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { downloadAndUnzipVSCode, runTests } from '@vscode/test-electron';

const here = dirname(fileURLToPath(import.meta.url));
const cachePath = resolve(process.env.VSCODE_CACHE ?? join(here, '.vscode-test'));
const version = process.env.VSCODE_VERSION ?? 'stable';
const mode = process.argv[2];

const executable = process.env.VSCODE_EXECUTABLE || await downloadAndUnzipVSCode({ version, cachePath });
if (mode === 'download') {
  console.log(`executable: ${executable}`);
  process.exit(0);
}

const out = resolve(process.argv[3]);
const ws = join(out, 'workspace');
const userData = join(out, 'user-data');
mkdirSync(join(ws, '.github', 'hooks'), { recursive: true });
mkdirSync(join(userData, 'User'), { recursive: true });
writeFileSync(
  join(ws, '.github', 'hooks', 'probe.json'),
  JSON.stringify({
    hooks: {
      PreToolUse: [{ type: 'command', command: `bash ${join(here, '..', 'hook.sh')}` }],
    },
  }),
);
writeFileSync(
  join(userData, 'User', 'settings.json'),
  JSON.stringify({
    'chat.useHooks': true,
    'chat.agent.enabled': true,
    'security.workspace.trust.enabled': false,
    'telemetry.telemetryLevel': 'off',
    'update.mode': 'none',
    'extensions.autoUpdate': false,
    'extensions.autoCheckUpdates': false,
  }),
);
process.env.PROBE_OUT = out;
process.env.PROBE_DIR = out;
process.env.PROBE_WS = ws;
try {
  await runTests({
    vscodeExecutablePath: executable,
    extensionDevelopmentPath: here,
    extensionTestsPath: join(here, 'runner.js'),
    launchArgs: [ws, '--user-data-dir', userData, '--extensions-dir', join(out, 'ext'), '--disable-workspace-trust', '--disable-gpu'],
  });
} catch (e) {
  console.log(`runTests: ${e?.message ?? e}`);
}
