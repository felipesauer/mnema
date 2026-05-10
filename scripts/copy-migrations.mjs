import { copyFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Copies the SQL migration files from `src/storage/sqlite/migrations`
 * to the matching path under `dist/`. The TypeScript compiler does not
 * carry non-`.ts` files over, so without this step the published
 * tarball would ship without the schema and `mnema init` would fail
 * the moment it tried to open the database.
 *
 * Important: the destination is wiped of any `.sql` left over from a
 * previous build before copying. Without this, a migration deleted
 * from `src/` would persist in `dist/` and ride along into the next
 * `pnpm pack`, contaminating the published tarball with stale (or
 * test) migrations.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const srcDir = resolve(repoRoot, 'src/storage/sqlite/migrations');
const distDir = resolve(repoRoot, 'dist/storage/sqlite/migrations');

mkdirSync(distDir, { recursive: true });

// Sweep stale .sql files from previous builds. Only `.sql` is touched
// so any non-migration debris (unlikely but plausible if someone runs
// experiments) is left alone.
let removed = 0;
if (existsSync(distDir)) {
  for (const entry of readdirSync(distDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.sql')) continue;
    unlinkSync(resolve(distDir, entry.name));
    removed += 1;
  }
}

let copied = 0;
for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.sql')) continue;
  copyFileSync(resolve(srcDir, entry.name), resolve(distDir, entry.name));
  copied += 1;
}

process.stdout.write(
  `copy-migrations: ${copied} file(s) → dist/storage/sqlite/migrations/${removed > 0 ? ` (cleared ${removed} stale)` : ''}\n`,
);
