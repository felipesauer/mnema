import { describe, expect, it } from 'vitest';

import { PACKAGE_NAME, ProjectionCache, projectRuns, projectTasks } from './index.js';

describe('@mnema/core', () => {
  it('exposes its package identity', () => {
    expect(PACKAGE_NAME).toBe('@mnema/core');
  });

  it('exposes the projection surface', () => {
    expect(typeof ProjectionCache.open).toBe('function');
    expect(typeof projectTasks).toBe('function');
    expect(typeof projectRuns).toBe('function');
  });
});
