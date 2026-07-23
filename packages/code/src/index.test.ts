import { describe, expect, it } from 'vitest';

import { CORE_DEPENDENCY, PACKAGE_NAME } from './index.js';

describe('@mnema/code', () => {
  it('exposes its package identity', () => {
    expect(PACKAGE_NAME).toBe('@mnema/code');
  });

  it('resolves @mnema/core across the workspace edge', () => {
    expect(CORE_DEPENDENCY).toBe('@mnema/core');
  });
});
