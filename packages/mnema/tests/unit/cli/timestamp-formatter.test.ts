import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { formatRelative, formatTimestamp } from '@/cli/formatters/timestamp-formatter.js';

const NOW = Date.parse('2026-05-08T12:00:00.000Z');

describe('formatRelative', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "just now" for ages under one minute', () => {
    expect(formatRelative('2026-05-08T11:59:30.000Z')).toBe('just now');
  });

  it('returns minutes for ages under one hour', () => {
    expect(formatRelative('2026-05-08T11:25:00.000Z')).toBe('35m ago');
  });

  it('returns hours for ages under one day', () => {
    expect(formatRelative('2026-05-08T07:00:00.000Z')).toBe('5h ago');
  });

  it('returns days for ages of one day or more', () => {
    expect(formatRelative('2026-05-05T12:00:00.000Z')).toBe('3d ago');
  });

  it('falls back to the raw string for unparseable input', () => {
    expect(formatRelative('not-a-date')).toBe('not-a-date');
  });

  it('falls back to the raw string for future timestamps (clock skew)', () => {
    expect(formatRelative('2026-05-09T00:00:00.000Z')).toBe('2026-05-09T00:00:00.000Z');
  });
});

describe('formatTimestamp', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the ISO string verbatim in iso mode', () => {
    const iso = '2026-05-08T07:00:00.000Z';
    expect(formatTimestamp(iso, 'iso')).toBe(iso);
  });

  it('renders relative form in relative mode', () => {
    expect(formatTimestamp('2026-05-08T07:00:00.000Z', 'relative')).toBe('5h ago');
  });
});
