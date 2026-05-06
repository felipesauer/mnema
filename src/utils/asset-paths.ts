import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Walks parents of `here` looking for the package root (where the
 * `workflows/` directory lives). Works equally for source mode
 * (`src/utils`) and compiled mode (`dist/utils`).
 *
 * @returns Absolute path to the package root
 */
function findPackageRoot(): string {
  let dir = here;
  while (true) {
    if (existsSync(resolve(dir, 'workflows'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error('package root not found (workflows/ missing)');
    }
    dir = parent;
  }
}

/**
 * Absolute path of the package root, computed once on module load.
 */
export const PACKAGE_ROOT: string = findPackageRoot();

/**
 * Absolute path to the directory containing migration `.sql` files.
 *
 * Tries `src/storage/sqlite/migrations` first (dev/test) and falls back
 * to `dist/storage/sqlite/migrations` for production builds.
 *
 * @returns Absolute path to the migrations directory
 */
export function migrationsDir(): string {
  const fromSrc = resolve(PACKAGE_ROOT, 'src/storage/sqlite/migrations');
  if (existsSync(fromSrc)) return fromSrc;
  return resolve(PACKAGE_ROOT, 'dist/storage/sqlite/migrations');
}

/**
 * Absolute path to the bundled `workflows/` directory.
 *
 * @returns Absolute path to the workflows directory
 */
export function workflowsDir(): string {
  return resolve(PACKAGE_ROOT, 'workflows');
}
