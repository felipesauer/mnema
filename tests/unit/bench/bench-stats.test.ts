import { describe, expect, it } from 'vitest';

import { summarize } from '../../../bench/bench-stats.js';

/**
 * The bench used to judge a budget on a single cold spawn, so one noisy
 * sample failed `pnpm bench` (and blocked publish). summarize() discards
 * a warm-up and reports the median, which absorbs a lone outlier while a
 * genuine regression (every sample slow) still fails.
 */
describe('summarize', () => {
  it('discards the warm-up (first sample) when more than one is present', () => {
    // Warm-up 999 is dropped; median of [10,10,10] is 10.
    const s = summarize([999, 10, 10, 10]);
    expect(s.count).toBe(3);
    expect(s.median).toBe(10);
    expect(s.min).toBe(10);
  });

  it('a single high outlier does not move the median (budget survives noise)', () => {
    // After dropping the warm-up: [150, 150, 900, 150, 150]. A lone 900ms
    // spike (a noisy spawn) leaves the median at 150 — under a 200ms
    // budget — whereas the mean (~300) or a worst-sample check would fail.
    const budgetMs = 200;
    const s = summarize([160, 150, 150, 900, 150, 150]);
    expect(s.median).toBe(150);
    expect(s.median).toBeLessThanOrEqual(budgetMs);
    // Contrast: a mean-based verdict would exceed the budget on this set.
    const mean = [150, 150, 900, 150, 150].reduce((a, b) => a + b, 0) / 5;
    expect(mean).toBeGreaterThan(budgetMs);
  });

  it('a genuine regression (every sample over budget) still fails on the median', () => {
    const budgetMs = 200;
    const s = summarize([260, 250, 255, 270, 265, 250]);
    expect(s.median).toBeGreaterThan(budgetMs); // median ~257 → fails, correctly
  });

  it('all-fast samples pass', () => {
    const s = summarize([40, 30, 32, 31, 33, 30]);
    expect(s.median).toBeLessThanOrEqual(50);
  });

  it('handles a single sample (no warm-up to discard)', () => {
    const s = summarize([42]);
    expect(s).toEqual({ median: 42, min: 42, count: 1 });
  });

  it('averages the two middle values for an even count', () => {
    // Warm-up dropped → [10, 20, 30, 40]; median = (20+30)/2 = 25.
    const s = summarize([999, 10, 20, 30, 40]);
    expect(s.median).toBe(25);
  });

  it('throws on an empty sample set', () => {
    expect(() => summarize([])).toThrow();
  });
});
