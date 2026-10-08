/**
 * Bundles the extension into the one CommonJS file the editor loads.
 *
 * The extension reads the record only through the `mnema` command line, so nothing of the
 * database may ride along: `@mnema/core`'s entry opens `node:sqlite`, a module of the Node the
 * runtime ships, and the editor runs extensions in Electron's Node, which is not the one the
 * `mnema` command runs on and may not have it. `bundle` returns the files whose code is
 * in the file, so a test can say which packages the file is made of.
 */

import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const pkgDir = fileURLToPath(new URL('..', import.meta.url));

// `vscode` is the editor's own module, handed in by the host; everything else is folded in.
const ENTRY = `
import * as vscode from 'vscode';
import { activate as start, deactivate } from './src/extension.ts';
export const activate = (context) => start(context, vscode);
export { deactivate };
`;

// The extension asks `@mnema/context` and `@mnema/core` for two pure functions. Their entries are
// barrels that also open the database, so the workspace packages are bundled as if free of side
// effects: only what those two functions reach is kept. That is a statement about this bundle,
// not about the packages, and the test over `bundle`'s result is what holds it.
const pureWorkspacePackages = {
  name: 'pure-workspace-packages',
  setup(build) {
    build.onResolve({ filter: /.*/ }, async (args) => {
      if (args.pluginData === 'inner') return undefined;
      const found = await build.resolve(args.path, {
        kind: args.kind,
        resolveDir: args.resolveDir,
        pluginData: 'inner',
      });
      if (found.errors.length > 0 || !/\/packages\/(chain|core|context)\/dist\//.test(found.path)) {
        return found.errors.length > 0 ? undefined : found;
      }
      return { path: found.path, sideEffects: false };
    });
  },
};

export async function bundle(outfile) {
  const result = await build({
    stdin: { contents: ENTRY, resolveDir: pkgDir, sourcefile: 'entry.ts', loader: 'ts' },
    absWorkingDir: pkgDir,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['vscode'],
    outfile,
    plugins: [pureWorkspacePackages],
    metafile: true,
    logLevel: 'warning',
    // The modules that carry `import.meta` are read and dropped; they are not in the file.
    logOverride: { 'empty-import-meta': 'silent' },
  });
  // The inputs esbuild read include the ones it then dropped; the output says which stayed.
  const [output] = Object.values(result.metafile.outputs);
  return Object.entries(output.inputs)
    .filter(([, { bytesInOutput }]) => bytesInOutput > 0)
    .map(([file]) => file);
}
