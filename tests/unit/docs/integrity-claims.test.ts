import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { PACKAGE_ROOT } from '@/utils/asset-paths.js';

/**
 * Locks the product's integrity claim to what MNEMA-ADR-37 approved and
 * guards it against drift. The chain is **tamper-evident** (it detects
 * edits) — it is NOT "tamper-proof" (it does not prevent them), and until
 * the ADR-37 cryptographic layers (per-project HMAC + per-machine Ed25519
 * + optional anchor, EPIC-10) ship, a motivated local editor can still
 * recompute a consistent forged chain. So the docs must say
 * "tamper-evident" and must never claim an unqualified "tamper-proof".
 *
 * package.json, README, and scripts/publish-check.sh are all tracked, so
 * this runs everywhere (unlike the git-ignored docs/ checks).
 */
const read = (rel: string): string => readFileSync(resolve(PACKAGE_ROOT, rel), 'utf-8');

/** Matches "tamper-proof"/"tamperproof"/"tamper proof", case-insensitive. */
const TAMPER_PROOF = /tamper[\s-]?proof/i;

describe('integrity claims (ADR-37)', () => {
  it('package.json describes the log as tamper-evident, not tamper-proof', () => {
    const pkg = JSON.parse(read('package.json')) as { description: string };
    expect(pkg.description).toMatch(/tamper-evident/i);
    expect(pkg.description).not.toMatch(TAMPER_PROOF);
  });

  it('the README leads with the tamper-evident claim', () => {
    const readme = read('README.md');
    // The one-line tagline (first block-quote) is the load-bearing claim.
    expect(readme).toMatch(/tamper-evident, local-first audit trail/i);
  });

  it('no doc overclaims an unqualified "tamper-proof"', () => {
    // The whole README + the package description: the prevention word must
    // not appear. "tamper-evident" / "tamper is caught" / "tamper-detection"
    // are the honest forms and are unaffected by this check.
    const readme = read('README.md');
    const pkgDescription = (JSON.parse(read('package.json')) as { description: string })
      .description;
    expect(readme).not.toMatch(TAMPER_PROOF);
    expect(pkgDescription).not.toMatch(TAMPER_PROOF);
  });

  it('README and package.json make the same tamper-evident claim (no divergence)', () => {
    const readme = read('README.md');
    const pkgDescription = (JSON.parse(read('package.json')) as { description: string })
      .description;
    const bothEvident = /tamper-evident/i.test(readme) && /tamper-evident/i.test(pkgDescription);
    expect(bothEvident).toBe(true);
  });
});
