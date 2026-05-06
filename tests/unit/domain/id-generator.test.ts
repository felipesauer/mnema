import { describe, expect, it } from 'vitest';

import { generateTaskKey, generateUuid, parseTaskKey } from '@/domain/id-generator.js';

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

describe('generateTaskKey', () => {
  it('formats the key as PROJECT-N', () => {
    expect(generateTaskKey('WEBAPP', 42)).toBe('WEBAPP-42');
  });
});

describe('parseTaskKey', () => {
  it('parses a valid key', () => {
    expect(parseTaskKey('WEBAPP-42')).toEqual({ projectKey: 'WEBAPP', sequence: 42 });
  });

  it('parses keys with digits in the project segment', () => {
    expect(parseTaskKey('A1B2-7')).toEqual({ projectKey: 'A1B2', sequence: 7 });
  });

  it('returns null for lowercase project segment', () => {
    expect(parseTaskKey('webapp-42')).toBeNull();
  });

  it('returns null when the sequence is missing', () => {
    expect(parseTaskKey('WEBAPP-')).toBeNull();
  });

  it('returns null for completely invalid input', () => {
    expect(parseTaskKey('not a key')).toBeNull();
  });
});
