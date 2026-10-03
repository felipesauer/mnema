import { describe, expect, it } from 'vitest';
import { verb } from './upsert.js';

describe('the verb of a projection insert', () => {
  it('is a plain insert unless the caller says the table has rows to replace', () => {
    expect(verb(false)).toBe('INSERT');
    expect(verb(true)).toBe('INSERT OR REPLACE');
  });
});
