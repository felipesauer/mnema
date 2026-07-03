import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { PACKAGE_ROOT } from '@/utils/asset-paths.js';
import { VERSION } from '@/utils/version.js';

/**
 * VERSION is read at load time from the package.json at PACKAGE_ROOT — the
 * identity-checked root (name === '@felipesauer/mnema'), not a fixed
 * '../../' hop that assumed a specific module depth and trusted whatever
 * manifest sat there. These lock VERSION to the real manifest and pin the
 * identity guarantee that makes the resolution robust.
 */
describe('VERSION', () => {
  it('matches the semver pattern', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('is a non-empty string', () => {
    expect(typeof VERSION).toBe('string');
    expect(VERSION.length).toBeGreaterThan(0);
  });

  it('equals the version in the package.json at PACKAGE_ROOT', () => {
    const manifest = JSON.parse(readFileSync(resolve(PACKAGE_ROOT, 'package.json'), 'utf-8')) as {
      name: string;
      version: string;
    };
    // The root VERSION reads from must be the identity-checked manifest…
    expect(manifest.name).toBe('@felipesauer/mnema');
    // …and VERSION must be exactly its version, not some sibling manifest's.
    expect(VERSION).toBe(manifest.version);
  });
});
