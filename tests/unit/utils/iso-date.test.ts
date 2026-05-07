import { describe, expect, it } from 'vitest';

import { isIso8601 } from '@/utils/iso-date.js';

describe('isIso8601', () => {
  it('accepts date-only YYYY-MM-DD', () => {
    expect(isIso8601('2026-05-07')).toBe(true);
  });

  it('accepts ISO instants with and without seconds/milliseconds', () => {
    expect(isIso8601('2026-05-07T13:45')).toBe(true);
    expect(isIso8601('2026-05-07T13:45:00')).toBe(true);
    expect(isIso8601('2026-05-07T13:45:00.123')).toBe(true);
  });

  it('accepts UTC and offset suffixes', () => {
    expect(isIso8601('2026-05-07T13:45:00Z')).toBe(true);
    expect(isIso8601('2026-05-07T13:45:00+02:00')).toBe(true);
    expect(isIso8601('2026-05-07T13:45:00-03:30')).toBe(true);
  });

  it('rejects empty / non-string values', () => {
    expect(isIso8601('')).toBe(false);
  });

  it('rejects loosely formatted dates that JS Date would still parse', () => {
    expect(isIso8601('Mon, 7 May 2026')).toBe(false);
    expect(isIso8601('2026/05/07')).toBe(false);
    expect(isIso8601('05-07-2026')).toBe(false);
  });

  it('rejects out-of-range months/days that JS Date silently rolls over', () => {
    expect(isIso8601('2026-13-01')).toBe(false);
    expect(isIso8601('2026-02-30')).toBe(false);
  });
});
