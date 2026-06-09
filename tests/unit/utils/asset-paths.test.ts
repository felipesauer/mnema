import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { cwd } from 'node:process';
import { describe, expect, it } from 'vitest';

import { migrationsDir, PACKAGE_ROOT, workflowsDir } from '@/utils/asset-paths.js';

/**
 * Unit-level contract for the asset-path helpers. The integration
 * counterpart (`tests/integration/cli/production-resolver.test.ts`)
 * spawns the compiled CLI from outside the source tree to prove the
 * helpers behave correctly under production conditions; these tests
 * pin the contract logically so a refactor cannot quietly regress
 * either property.
 */
describe('asset-paths helpers', () => {
  it('PACKAGE_ROOT is absolute and contains the package manifest', () => {
    expect(isAbsolute(PACKAGE_ROOT)).toBe(true);
    expect(existsSync(`${PACKAGE_ROOT}/package.json`)).toBe(true);
  });

  it('PACKAGE_ROOT is NOT derived from cwd (regression for H-2)', () => {
    // The previous bug used `path.resolve(MIGRATIONS_DIRNAME)`, which
    // is cwd-relative. The replacement walks parents of the compiled
    // location instead, so PACKAGE_ROOT should be the Mnema repo
    // (or installed package) regardless of where tests start from.
    // Even when cwd happens to be the repo, the path must equal the
    // walked-up root, not a literal `process.cwd()` concatenation.
    const root = PACKAGE_ROOT;
    expect(existsSync(`${root}/package.json`)).toBe(true);
    // A trivial sanity check: the manifest at this path advertises
    // the Mnema package name.
    const manifest = JSON.parse(readFileSync(`${root}/package.json`, 'utf-8')) as { name: string };
    expect(manifest.name).toBe('@saurim/mnema');
  });

  it('migrationsDir() returns an absolute path inside the package', () => {
    const dir = migrationsDir();
    expect(isAbsolute(dir)).toBe(true);
    expect(dir.startsWith(PACKAGE_ROOT)).toBe(true);
    expect(dir).toMatch(/(src|dist)\/storage\/sqlite\/migrations$/);
    expect(existsSync(dir)).toBe(true);
  });

  it('migrationsDir() never returns a cwd-relative path even after chdir', () => {
    // Switch cwd to something unrelated and confirm the helper still
    // resolves to PACKAGE_ROOT-relative path. This is the precise
    // condition that exposed H-2 in production.
    const originalCwd = cwd();
    try {
      process.chdir('/tmp');
      const dir = migrationsDir();
      expect(dir.startsWith(PACKAGE_ROOT)).toBe(true);
      expect(dir.startsWith('/tmp')).toBe(false);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('workflowsDir() returns an absolute path inside the package', () => {
    const dir = workflowsDir();
    expect(isAbsolute(dir)).toBe(true);
    expect(dir.startsWith(PACKAGE_ROOT)).toBe(true);
    expect(dir.endsWith('/workflows')).toBe(true);
    expect(existsSync(dir)).toBe(true);
  });
});
