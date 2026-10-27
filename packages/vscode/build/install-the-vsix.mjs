/**
 * Installs the packed `.vsix` into a real VS Code and has the editor say whether the extension
 * started: `pnpm --filter @mnema/vscode install-check`, after `package`.
 *
 * It downloads VS Code once into `.vscode-test/` (free, and ignored by git), installs the file with
 * the editor's own `--install-extension` into a scratch extensions folder, and opens the editor
 * four times, each on its own scratch workspace and its own scratch user data: a folder with no
 * `.mnema` (twice: left alone, and with the side bar container opened), a folder with a `.mnema` and
 * a `mnema.command` that does not exist, and a folder with a real record and one proposed decision,
 * read by the `mnema` built in this repository. `in-the-editor.cjs` runs inside each
 * and checks what the extension did there. A display is needed: on a machine without one, run it
 * under `xvfb-run -a`. Nothing here reads or writes the person's own editor profile, and the
 * `mnema` it starts runs with a scratch HOME.
 */

import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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
const mnemaCli = join(pkgDir, '..', 'code', 'dist', 'cli.js');

/** A `mnema` that logs what it is asked, runs the one built here, and never sees the real HOME. */
function wrapper(name, log, home) {
  const file = join(scratch, name);
  writeFileSync(
    file,
    `#!/bin/sh\necho "$*" >> '${log}'\nHOME='${home}' exec '${process.execPath}' '${mnemaCli}' "$@"\n`,
  );
  chmodSync(file, 0o755);
  return file;
}

try {
  const extensions = join(scratch, 'extensions');
  const stub = join(scratch, 'stub');
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
  const install = spawnSync(
    cli,
    [
      ...cliArgs,
      '--extensions-dir',
      extensions,
      '--user-data-dir',
      join(scratch, 'install-user-data'),
      '--install-extension',
      join(pkgDir, vsix),
    ],
    { stdio: 'inherit', shell: process.platform === 'win32' },
  );
  if (install.status !== 0) throw new Error(`code --install-extension exited with ${install.status}`);

  // The captures, when asked for, are taken by the caller around this script: it only says where.
  const scenarios = [
    { name: 'no-record', record: false, command: 'wrapper' },
    { name: 'no-record-container', record: false, command: 'wrapper' },
    { name: 'no-cli', record: true, command: join(scratch, 'there-is-no-mnema-here') },
    { name: 'record', record: true, command: 'wrapper' },
  ];
  for (const scenario of scenarios) {
    if (scenario.command === 'wrapper' && process.platform === 'win32') {
      console.log(`${scenario.name}: skipped, the stand-in command is a shell script`);
      continue;
    }
    const dir = join(scratch, scenario.name);
    const workspace = join(dir, 'workspace');
    const userData = join(dir, 'user-data');
    const home = join(dir, 'home');
    const log = join(dir, 'asked.log');
    mkdirSync(workspace, { recursive: true });
    mkdirSync(join(userData, 'User'), { recursive: true });
    mkdirSync(home);
    writeFileSync(log, '');
    const command =
      scenario.command === 'wrapper' ? wrapper(`mnema-${scenario.name}`, log, home) : scenario.command;
    if (scenario.record) {
      if (scenario.command === 'wrapper') {
        // A real record, written by the built `mnema` into the scratch workspace.
        const init = spawnSync(command, ['init'], { cwd: workspace, env: { PATH: process.env.PATH } });
        if (init.status !== 0) throw new Error(`mnema init failed: ${init.stderr}`);
        // One decision awaiting a judgment, for the side bar's badge to count.
        const proposed = spawnSync(
          command,
          ['decision', 'record', 'Use SQLite for the cache', 'small and local'],
          { cwd: workspace, env: { PATH: process.env.PATH } },
        );
        if (proposed.status !== 0) throw new Error(`mnema decision record failed: ${proposed.stderr}`);
        writeFileSync(log, '');
      } else {
        mkdirSync(join(workspace, '.mnema'));
      }
    }
    writeFileSync(join(userData, 'User', 'settings.json'), JSON.stringify({ 'mnema.command': command }));
    await runTests({
      vscodeExecutablePath: executable,
      extensionDevelopmentPath: stub,
      extensionTestsPath: join(pkgDir, 'build', 'in-the-editor.cjs'),
      extensionTestsEnv: { MNEMA_CHECK: scenario.name, MNEMA_CHECK_LOG: log },
      // `--disable-gpu`: under `xvfb` there is no GPU, and on some runner images the renderer hangs
      // trying to use one (the window is then reported unresponsive and the run exits with 1).
      launchArgs: [
        workspace,
        '--extensions-dir',
        extensions,
        '--user-data-dir',
        userData,
        '--disable-workspace-trust',
        '--disable-gpu',
      ],
    });
    console.log(`${scenario.name}: held`);
  }
  console.log(`${vsix} installed and checked in VS Code (${executable})`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
