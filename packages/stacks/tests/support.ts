import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** The package root, whether the test runs from `src/` or from `dist/`. */
export const PACKAGE_ROOT = join(here, '..');
export const HELLO_STACK = join(PACKAGE_ROOT, 'fixtures', 'hello-stack');
export const DIGEST_SH = join(PACKAGE_ROOT, 'digest.sh');

const made: string[] = [];

/** A scratch copy of hello-stack, removed by {@link cleanScratch}. */
export function scratchStack(): string {
  const dir = mkdtempSync(join(tmpdir(), 'stacks-case-'));
  made.push(dir);
  cpSync(HELLO_STACK, dir, { recursive: true });
  return dir;
}

export function put(root: string, path: string, content: string | Uint8Array): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

export function cleanScratch(): void {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}
