import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The proof engine must stay a pure, zero-dependency core: it is the surface
 * that carries tamper-evidence, so it cannot be contaminated by the domain,
 * the surfaces, or any third-party runtime code. These guards fail loudly the
 * moment that invariant is about to erode — a broken boundary here is a design
 * regression, not a passing test with a warning.
 */
describe('@mnema/chain boundaries', () => {
  const manifest = JSON.parse(
    readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf-8'),
  ) as { dependencies?: Record<string, string>; peerDependencies?: Record<string, string> };

  it('declares no runtime dependencies', () => {
    expect(manifest.dependencies ?? {}).toEqual({});
  });

  it('declares no peer dependencies', () => {
    expect(manifest.peerDependencies ?? {}).toEqual({});
  });
});
