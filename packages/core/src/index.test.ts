import { describe, expect, it } from 'vitest';

import { CHAIN_DEPENDENCY, PACKAGE_NAME } from './index.js';

describe('@mnema/core', () => {
  it('exposes its package identity', () => {
    expect(PACKAGE_NAME).toBe('@mnema/core');
  });

  it('resolves @mnema/chain across the workspace edge', () => {
    expect(CHAIN_DEPENDENCY).toBe('@mnema/chain');
  });
});
