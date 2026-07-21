import { describe, expect, it } from 'vitest';

import { generateUuid } from '@/domain/id-generator.js';

describe('generateUuid', () => {
  it('returns a UUID v7 string', () => {
    const uuid = generateUuid();
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('returns a different value on each call', () => {
    const a = generateUuid();
    const b = generateUuid();
    expect(a).not.toBe(b);
  });
});
