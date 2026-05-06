import { describe, expect, it } from 'vitest';

import { VERSION } from '@/utils/version.js';

describe('VERSION', () => {
  it('matches the semver pattern', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('is a non-empty string', () => {
    expect(typeof VERSION).toBe('string');
    expect(VERSION.length).toBeGreaterThan(0);
  });
});
