/**
 * Packs the extension into a `.vsix` next to its `package.json`: `pnpm --filter @mnema/vscode package`.
 *
 * The extension reads `@mnema/core` and `@mnema/context` by their bare names, so the file has to
 * carry them. `pnpm deploy` copies the package with its workspace packages into a scratch folder,
 * and `vsce` packs that folder. Three things in the copy are not what `vsce` accepts, and they are
 * changed in the copy only (the repository's own manifests stay as they are):
 *   - the name: `vsce` refuses a scoped one, and the workspace name is `@mnema/vscode`;
 *   - `workspace:*` ranges, which `npm list` (what `vsce` asks for the dependency tree) reads as invalid;
 *   - the layout: `vsce` walks real directories, so the copy is made with a hoisted `node_modules`.
 * Nothing here publishes: the file is written to disk and that is where it stops.
 */

import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = join(pkgDir, '..', '..');
const manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
const out = join(pkgDir, `mnema-${manifest.version}.vsix`);

// Build output, type declarations and the sources of the native addon are not read when the
// extension runs; its prebuilt binaries (`prebuilds/`) are.
const IGNORED = [
  '**/*.map',
  '**/*.d.ts',
  '**/*.tsbuildinfo',
  '**/better-sqlite3/build/**',
  '**/better-sqlite3/deps/**',
  '**/better-sqlite3/src/**',
];

function run(command, args, cwd) {
  const done = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (done.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${done.status ?? done.signal}`);
  }
}

function rewrite(file, change) {
  const json = JSON.parse(readFileSync(file, 'utf8'));
  change(json);
  // `pnpm deploy` hard-links the workspace packages' files into the copy, and writing through a
  // link would rewrite the manifest in `packages/*` too. Unlink first, then write a file of its own.
  rmSync(file);
  writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
}

const resolveWorkspaceRanges = (json) => {
  for (const field of ['dependencies', 'optionalDependencies']) {
    for (const [name, range] of Object.entries(json[field] ?? {})) {
      if (range.startsWith('workspace:')) json[field][name] = json.version;
    }
  }
};

const scratch = mkdtempSync(join(tmpdir(), 'mnema-vsix-'));
try {
  const copy = join(scratch, 'extension');
  run(
    'pnpm',
    ['--filter', manifest.name, 'deploy', '--legacy', '--prod', '--config.node-linker=hoisted', copy],
    repoRoot,
  );
  rewrite(join(copy, 'package.json'), (json) => {
    json.name = 'mnema';
    delete json.files;
    resolveWorkspaceRanges(json);
  });
  for (const name of readdirSync(join(copy, 'node_modules', '@mnema'))) {
    rewrite(join(copy, 'node_modules', '@mnema', name, 'package.json'), resolveWorkspaceRanges);
  }
  copyFileSync(join(repoRoot, 'LICENSE'), join(copy, 'LICENSE'));
  writeFileSync(join(copy, '.vscodeignore'), `${IGNORED.join('\n')}\n`);
  run(join(pkgDir, 'node_modules', '.bin', 'vsce'), ['package', '--out', out], copy);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
console.log(`${out} (${statSync(out).size} bytes)`);
