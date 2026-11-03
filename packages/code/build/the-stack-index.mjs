/**
 * Puts the stack index inside the package, so an installed `mnema` can list it in any folder.
 *
 * `stack-index/index.json` at the root of the repository stays the one file people edit. This
 * writes, under `packages/code/dist/stack-index/`, a byte-for-byte copy of it and, for each entry
 * that names a `path`, the folder of that stack at the same relative path inside it, so the
 * reader resolves an entry's folder the way it does in a checkout. `dist/` is what the package
 * publishes, and `npm pack` takes this with it.
 *
 * It FAILS when the index is missing, is not a list of entries, or an entry's folder is not there:
 * a build that ships an index naming a folder it does not hold is not a build.
 * `packages/code/tests/the-built-in-index-is-the-repositorys.test.ts` holds the result.
 */

import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const out = join(root, 'packages', 'code', 'dist', 'stack-index');

const index = join(root, 'stack-index', 'index.json');
const { stacks } = JSON.parse(readFileSync(index, 'utf8'));
if (!Array.isArray(stacks)) throw new Error('stack-index/index.json has no "stacks" list');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(index, join(out, 'index.json'));
for (const entry of stacks) {
  if (typeof entry.path !== 'string') continue;
  cpSync(join(root, entry.path), join(out, entry.path), { recursive: true, errorOnExist: true });
}
