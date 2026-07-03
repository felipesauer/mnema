import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import semver from 'semver';
import { describe, expect, it } from 'vitest';

import { PACKAGE_ROOT } from '@/utils/asset-paths.js';

/**
 * Guards against the doc/config drift found in the diagnostic: the README
 * example config trailed the real package version, README and CONTRIBUTING
 * quoted different test counts, and TECH_DEBT claimed coverage was not
 * enforced though publish-check.sh gates on it.
 *
 * These are deliberately tolerant — they compare documents against each
 * other or against a computed source of truth (semver, gate presence),
 * never against a hard-coded literal that would re-drift on the next change.
 *
 * Note: `docs/` is intentionally git-ignored (local-only), so the
 * TECH_DEBT check is skipped when the file is absent — a fresh clone /
 * CI checkout will not have it. README, CONTRIBUTING, publish-check.sh
 * and package.json are all tracked, so the other checks always run.
 */
const path = (rel: string): string => resolve(PACKAGE_ROOT, rel);
const read = (rel: string): string => readFileSync(path(rel), 'utf-8');
const TECH_DEBT = 'docs/TECH_DEBT.md';

describe('doc/config consistency', () => {
  it("the README example config's mnema_version is not behind the package version", () => {
    const pkg = JSON.parse(read('package.json')) as { version: string };
    const readme = read('README.md');
    // Grab the mnema_version range shown in the first example config block.
    const match = readme.match(/"mnema_version":\s*"([^"]+)"/);
    expect(match, 'README should show a mnema_version example').not.toBeNull();
    const range = match?.[1] ?? '';

    // The current package version must satisfy the documented range — a
    // stale "^0.8" range would exclude a 0.10 package. Compares semver,
    // not string equality, so patch/prerelease bumps do not trip it.
    expect(
      semver.satisfies(pkg.version, range, { includePrerelease: true }),
      `package ${pkg.version} must satisfy the README's documented range ${range}`,
    ).toBe(true);
  });

  it('README and CONTRIBUTING quote the same test count', () => {
    const readmeCount = read('README.md').match(/\*\*(\d+) tests,/)?.[1];
    const contributingCount = read('CONTRIBUTING.md').match(/vitest run[^\n]*?(\d+) tests/)?.[1];
    expect(readmeCount, 'README should state a test count').toBeDefined();
    expect(contributingCount, 'CONTRIBUTING should state a test count').toBeDefined();
    // Matching numbers rather than a fixed literal: this fails only when the
    // two docs disagree, not every time a test is added.
    expect(readmeCount).toBe(contributingCount);
  });

  it.skipIf(!existsSync(path(TECH_DEBT)))(
    'TECH_DEBT reflects that coverage IS enforced, matching publish-check.sh',
    () => {
      const gate = read('scripts/publish-check.sh');
      const gateEnforcesCoverage = /test:coverage.*\|\|\s*fail/.test(gate);
      // Sanity: the gate really is present (the premise of the doc claim).
      expect(gateEnforcesCoverage).toBe(true);

      const techDebt = read(TECH_DEBT);
      // The old wording asserted the opposite; ensure it is gone…
      expect(techDebt).not.toMatch(/coverage[^\n]*is not enforced/i);
      // …and that the current text acknowledges the publish-time gate.
      expect(techDebt.toLowerCase()).toContain('enforced at publish');
    },
  );
});
