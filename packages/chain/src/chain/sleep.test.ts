/**
 * The synchronous sleep the writing path waits with — a busy tail, an installation id another
 * process is still writing. What both waits rest on is that it sleeps for the time asked and
 * then returns, with nothing able to wake it early.
 */

import { describe, expect, it } from 'vitest';

import { sleepSync } from './sleep.js';

describe('sleepSync', () => {
  it('sleeps at least the time asked, and returns', () => {
    const started = performance.now();
    expect(sleepSync(25)).toBeUndefined();
    // A millisecond of slack for the clock's own rounding; the wait is a timeout, so it never
    // ends early by design.
    expect(performance.now() - started).toBeGreaterThanOrEqual(24);
  });

  it('returns at once for no time at all', () => {
    const started = performance.now();
    expect(sleepSync(0)).toBeUndefined();
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});
