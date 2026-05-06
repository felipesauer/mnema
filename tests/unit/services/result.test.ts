import { describe, expect, it } from 'vitest';

import { Err, Ok } from '@/services/result.js';

describe('Result', () => {
  it('Ok wraps the value with ok=true', () => {
    const r = Ok(42);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toBe(42);
    }
  });

  it('Err wraps the error with ok=false', () => {
    const r = Err({ kind: 'BOOM' as const });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toEqual({ kind: 'BOOM' });
    }
  });

  it('discriminator narrows the type', () => {
    const r = Math.random() > 2 ? Ok('x') : Err('y');
    if (r.ok) {
      expect(typeof r.value).toBe('string');
    } else {
      expect(typeof r.error).toBe('string');
    }
  });
});
