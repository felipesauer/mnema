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
    // Also rejected with a time part (Date folds "2026-02-30T10:00" to Mar 2).
    expect(isIso8601('2026-13-01T12:00:00')).toBe(false);
    expect(isIso8601('2026-02-30T10:00:00')).toBe(false);
    // …and in the ZONED form too — a fold must not slip past the offset branch.
    expect(isIso8601('2026-02-30T00:00:00Z')).toBe(false);
    expect(isIso8601('2026-04-31T00:00:00Z')).toBe(false);
    expect(isIso8601('2026-02-29T00:00:00Z')).toBe(false); // 2026 is not a leap year
    expect(isIso8601('2026-13-01T12:00:00+02:00')).toBe(false);
  });

  it('accepts a real leap day in the zoned form', () => {
    // The zoned calendar check must be leap-aware, not blanket-reject Feb 29.
    expect(isIso8601('2028-02-29T00:00:00Z')).toBe(true);
    expect(isIso8601('2026-07-13T23:00:00+02:00')).toBe(true);
  });

  it('accepts a timezone-less evening datetime regardless of local timezone', () => {
    // Regression: the UTC date-prefix round-trip wrongly rejected a valid
    // local datetime whose UTC instant rolls to the next day (e.g. 23:00 in a
    // behind-UTC zone). It is parsed as LOCAL time and must stay valid.
    const prevTz = process.env.TZ;
    for (const tz of ['America/Sao_Paulo', 'UTC', 'Asia/Tokyo']) {
      process.env.TZ = tz;
      expect(isIso8601('2026-07-13T23:00:00'), tz).toBe(true);
      expect(isIso8601('2026-07-13T01:00:00'), tz).toBe(true);
    }
    if (prevTz === undefined) delete process.env.TZ;
    else process.env.TZ = prevTz;
  });
});
