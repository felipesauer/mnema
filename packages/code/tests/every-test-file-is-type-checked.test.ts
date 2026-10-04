/**
 * EVERY TEST FILE IS TYPE-CHECKED. The product's `tsc -b` excludes the `.test.ts` files and
 * vitest strips types without reading them, so for a long time a test could be wrong about
 * a type and nothing said so: a type guard written in a test was vacuous, and a fixture in
 * the old shape of a verb passed the build and broke only in the suite.
 *
 * Each package therefore has a `tsconfig.test.json` that reaches its sources and its tests,
 * and `pnpm typecheck` runs it after the build. This file keeps that true: a test file (a
 * `*.test.ts` under `src/` or `tests/`, or any `.ts` under `tests/`, which is where the
 * shared support lives) that no package's test config reaches is accused BY NAME.
 *
 * WHAT "REACHES" MEANS is asked of the compiler (`tsc --listFilesOnly`), not of a glob
 * matcher written here: two readings of one include list is how a guard and the thing it
 * guards disagree.
 *
 * WHAT IT DOES NOT COVER: whether the tests are free of errors. That is what
 * `pnpm typecheck` answers, on every run. This only says no test file can stand outside
 * the question.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const PACKAGES = join(REPO, 'packages');
const TSC = join(REPO, 'node_modules', '.bin', 'tsc');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

function packageNames(): string[] {
  return readdirSync(PACKAGES, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

/** Every file in the package that is a test or the support a test stands on. */
function testFilesOf(pkg: string): string[] {
  const root = join(PACKAGES, pkg);
  const files: string[] = [];
  for (const sub of ['src', 'tests']) {
    try {
      files.push(...walk(join(root, sub)));
    } catch {
      // a package without that directory has nothing to reach there
    }
  }
  return files
    .filter((f) => f.endsWith('.ts'))
    .filter((f) => f.endsWith('.test.ts') || relative(root, f).startsWith('tests/'))
    .sort();
}

function listFiles(config: string): Set<string> {
  const out = execFileSync(TSC, ['--listFilesOnly', '-p', config], {
    cwd: REPO,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return new Set(out.split('\n').filter((l) => l !== ''));
}

function unreached(pkg: string, config: string): string[] {
  const reached = listFiles(config);
  return testFilesOf(pkg)
    .filter((f) => !reached.has(f))
    .map((f) => relative(REPO, f));
}

describe('every test file is type-checked', () => {
  it('has found test files to judge, in more than one package', () => {
    const withTests = packageNames().filter((p) => testFilesOf(p).length > 0);
    expect(withTests.length).toBeGreaterThan(1);
    expect(testFilesOf('code').length).toBeGreaterThan(100);
  });

  it.each(packageNames())('reaches every test file of %s through its test config', (pkg) => {
    expect(readdirSync(join(PACKAGES, pkg))).toContain('tsconfig.test.json');
    expect(unreached(pkg, join(PACKAGES, pkg, 'tsconfig.test.json'))).toEqual([]);
  });

  it('is run by `pnpm typecheck`, and CI runs `pnpm typecheck`', () => {
    const scripts = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).scripts;
    expect(scripts.typecheck).toContain('tsconfig.test.json');
    expect(readFileSync(join(REPO, '.github', 'workflows', 'ci.yml'), 'utf8')).toMatch(
      /run: pnpm typecheck\b/,
    );
  });

  it('accuses a test directory taken out of the include (the instrument is not blind)', () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'mnema-test-reach-'));
    try {
      const mutated = join(sandbox, 'tsconfig.json');
      const real = join(PACKAGES, 'code');
      writeFileSync(
        mutated,
        JSON.stringify({
          extends: join(real, 'tsconfig.test.json'),
          compilerOptions: { typeRoots: [join(REPO, 'node_modules', '@types')] },
          include: [join(real, 'src', '**', '*')],
        }),
      );
      const accused = unreached('code', mutated);
      expect(accused.length).toBeGreaterThan(100);
      expect(accused.every((f) => f.startsWith('packages/code/tests/'))).toBe(true);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
});
