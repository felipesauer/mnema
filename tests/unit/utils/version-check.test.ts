import { describe, expect, it } from 'vitest';

import { VERSION } from '@/utils/version.js';
import { checkVersion } from '@/utils/version-check.js';

describe('checkVersion', () => {
  it('returns ok=true when current version satisfies the range', () => {
    const result = checkVersion(`^${VERSION}`);
    expect(result.ok).toBe(true);
    expect(result.message).toBeUndefined();
  });

  it('returns ok=false with message when major is incompatible', () => {
    const result = checkVersion('^99.0.0');
    expect(result.ok).toBe(false);
    expect(result.message).toContain('Project requires mnema ^99.0.0');
    expect(result.message).toContain(VERSION);
  });

  it('returns ok=false when patch range excludes current version', () => {
    const result = checkVersion('0.0.1');
    expect(result.ok).toBe(false);
    expect(result.message).toContain('0.0.1');
  });

  it('accepts a stable range when the current build is a same-line alpha', () => {
    // Defensive: covers the alpha → stable transition. While VERSION
    // carries an `-alpha.N` suffix, `^0.1.0` should still match thanks
    // to includePrerelease — otherwise every alpha user would see a
    // version-mismatch error against projects pinned to a stable range.
    if (!VERSION.includes('-alpha')) return;
    const baseline = VERSION.replace(/-alpha.*$/, '');
    const result = checkVersion(`^${baseline}`);
    expect(result.ok).toBe(true);
  });
});
