import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Copies the SQL migration files from `src/storage/sqlite/migrations`
 * to the matching path under `dist/`. The TypeScript compiler does not
 * carry non-`.ts` files over, so without this step the published
 * tarball would ship without the schema and `mnema init` would fail
 * the moment it tried to open the database.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const srcDir = resolve(repoRoot, 'src/storage/sqlite/migrations');
const distDir = resolve(repoRoot, 'dist/storage/sqlite/migrations');

mkdirSync(distDir, { recursive: true });

let copied = 0;
for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.sql')) continue;
  copyFileSync(resolve(srcDir, entry.name), resolve(distDir, entry.name));
  copied += 1;
}

process.stdout.write(`copy-migrations: ${copied} file(s) → dist/storage/sqlite/migrations/\n`);
