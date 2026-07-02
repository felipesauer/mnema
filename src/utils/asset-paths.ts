import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Walks parents of `here` looking for the package root, identified by
 * a `package.json` whose `name` field is `mnema`. Works
 * equally in source mode (`src/utils`) and compiled mode
 * (`dist/utils`), and stays correct when consumers delete or move
 * `workflows/` — the previous heuristic relied on `workflows/` as a
 * marker, which the dogfood-on-self setup could remove during
 * `mnema destroy` and break the next CLI invocation.
 *
 * @returns Absolute path to the package root
 */
function findPackageRoot(): string {
  let dir = here;
  while (true) {
    const manifest = resolve(dir, 'package.json');
    if (existsSync(manifest)) {
      try {
        const parsed = JSON.parse(readFileSync(manifest, 'utf-8')) as { name?: string };
        if (parsed.name === 'mnema') return dir;
      } catch {
        // Unreadable JSON — keep walking; the package.json belonged to
        // somewhere else in the tree.
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error('package root not found (no mnema package.json on the path)');
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
 * Absolute path to the project-local migrations directory.
 *
 * `mnema migration generate` writes here; the runner merges
 * project-local migrations on top of the bundled set so a custom
 * schema bump can ride alongside the package's shipped migrations
 * without modifying the global install.
 *
 * @param projectRoot - Absolute path to the project root
 * @returns Absolute path to `.mnema/migrations`
 */
export function projectMigrationsDir(projectRoot: string): string {
  return resolve(projectRoot, '.mnema/migrations');
}

/**
 * Returns the ordered list of migration directories the runner
 * should walk: bundled first (so its filenames always win on tie),
 * project-local second when it exists.
 *
 * @param projectRoot - Absolute path to the project root
 * @returns Array suitable for passing to `MigrationRunner.run`
 */
export function migrationDirs(projectRoot: string): readonly string[] {
  return [migrationsDir(), projectMigrationsDir(projectRoot)];
}

/**
 * Absolute path to the bundled `workflows/` directory.
 *
 * @returns Absolute path to the workflows directory
 */
export function workflowsDir(): string {
  return resolve(PACKAGE_ROOT, 'workflows');
}
