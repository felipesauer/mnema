import { describe, expect, it } from 'vitest';

import { PACKAGE_NAME } from './index.js';

describe('@mnema/chain', () => {
  it('exposes its package identity', () => {
    expect(PACKAGE_NAME).toBe('@mnema/chain');
  });
});
