/**
 * Installs the packed `.vsix` into a real VS Code and has the editor say whether the extension
 * started: `pnpm --filter @mnema/vscode install-check`, after `package`.
 *
 * It downloads VS Code once into `.vscode-test/` (free, and ignored by git), installs the file with
 * the editor's own `--install-extension` into a scratch extensions folder, and opens a scratch
 * workspace that holds a `.mnema` folder. `in-the-editor.cjs` runs inside that editor and checks that
 * the extension activated by its own activation event. A display is needed: on a machine without
 * one, run it under `xvfb-run -a`. Nothing here reads or writes the person's own editor profile.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  downloadAndUnzipVSCode,
  resolveCliArgsFromVSCodeExecutablePath,
  runTests,
} from '@vscode/test-electron';

const pkgDir = fileURLToPath(new URL('..', import.meta.url));
const vsix = readdirSync(pkgDir).find((file) => /^mnema-.*\.vsix$/.test(file));
if (!vsix) throw new Error('No .vsix here: run `pnpm --filter @mnema/vscode package` first.');

const scratch = mkdtempSync(join(tmpdir(), 'mnema-editor-'));
try {
  const extensions = join(scratch, 'extensions');
  const userData = join(scratch, 'user-data');
  const workspace = join(scratch, 'workspace');
  const stub = join(scratch, 'stub');
  mkdirSync(join(workspace, '.mnema'), { recursive: true });
  // `runTests` wants an extension under development; this one does nothing and is not the one tested.
  mkdirSync(stub);
  writeFileSync(
    join(stub, 'package.json'),
    JSON.stringify({ name: 'stub', publisher: 'stub', version: '0.0.0', engines: { vscode: '*' } }),
  );

  const executable = await downloadAndUnzipVSCode({
    version: process.env.MNEMA_VSCODE_VERSION ?? 'stable',
    cachePath: join(pkgDir, '.vscode-test'),
  });
  const [cli, ...cliArgs] = resolveCliArgsFromVSCodeExecutablePath(executable);
  const folders = ['--extensions-dir', extensions, '--user-data-dir', userData];
  const install = spawnSync(cli, [...cliArgs, ...folders, '--install-extension', join(pkgDir, vsix)], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (install.status !== 0) throw new Error(`code --install-extension exited with ${install.status}`);

  await runTests({
    vscodeExecutablePath: executable,
    extensionDevelopmentPath: stub,
    extensionTestsPath: join(pkgDir, 'build', 'in-the-editor.cjs'),
    launchArgs: [workspace, ...folders, '--disable-workspace-trust'],
  });
  console.log(`${vsix} installed and active in VS Code (${executable})`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
