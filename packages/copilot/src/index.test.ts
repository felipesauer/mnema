import { describe, expect, it } from 'vitest';

import { PACKAGE_NAME } from './index.js';

describe('@mnema/copilot', () => {
  it('exposes its package identity', () => {
    expect(PACKAGE_NAME).toBe('@mnema/copilot');
  });
});
