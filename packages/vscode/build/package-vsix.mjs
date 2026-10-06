/**
 * Packs the extension into a `.vsix` next to its `package.json`: `pnpm --filter @mnema/vscode package`.
 *
 * The extension is one file. `bundle.mjs` folds the sources, and the two pure functions it asks of
 * the workspace packages, into `extension.cjs`; nothing is installed beside it, so there is no
 * `node_modules` to carry and no native addon to rebuild for the editor's Electron. `vsce` packs a
 * scratch folder holding that file and a manifest copy, and the copy differs from the repository's
 * in what `vsce` needs and the workspace does not: the name (`vsce` refuses a scoped one, and the
 * workspace name is `@mnema/vscode`) and no development fields. The repository's own manifest is
 * not touched. Nothing here publishes: the file is written to disk and that is where it stops.
 */

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from './bundle.mjs';

const pkgDir = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = join(pkgDir, '..', '..');
const manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
const out = join(pkgDir, `mnema-${manifest.version}.vsix`);

const scratch = mkdtempSync(join(tmpdir(), 'mnema-vsix-'));
try {
  await bundle(join(scratch, 'extension.cjs'));
  const { name, devDependencies, scripts, type, ...packed } = manifest;
  writeFileSync(
    join(scratch, 'package.json'),
    `${JSON.stringify({ name: 'mnema', ...packed, files: ['extension.cjs', 'LICENSE', 'NOTICE', 'README.md'] }, null, 2)}\n`,
  );
  copyFileSync(join(repoRoot, 'LICENSE'), join(scratch, 'LICENSE'));
  copyFileSync(join(pkgDir, 'NOTICE'), join(scratch, 'NOTICE'));
  copyFileSync(join(pkgDir, 'README.md'), join(scratch, 'README.md'));
  const done = spawnSync(
    join(pkgDir, 'node_modules', '.bin', 'vsce'),
    ['package', '--no-dependencies', '--out', out],
    { cwd: scratch, stdio: 'inherit' },
  );
  if (done.status !== 0) throw new Error(`vsce exited with ${done.status ?? done.signal}`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
console.log(`${out} (${statSync(out).size} bytes)`);
