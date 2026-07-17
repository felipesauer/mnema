/**
 * Pure summary statistics for the CLI benchmark, extracted so it can be
 * unit-tested without importing `cli-bench.ts` (which runs on import).
 *
 * Cold-start timing is high-variance: a single spawn can spike well above
 * the steady-state cost on a shared/noisy machine. Judging a budget on
 * one sample turned that noise into a `pnpm bench` failure (and, under
 * `publish-check.sh`'s `|| fail`, a blocked publish). Taking several
 * samples, discarding a warm-up, and comparing the MEDIAN makes the
 * verdict robust to a lone outlier while still catching a real regression
 * (where every sample is over budget, so the median is too).
 */

/** Number of measured samples per budget (after the warm-up). */
export const DEFAULT_SAMPLES = 5;

/** Summary of a budget's timing samples, all in milliseconds. */
export interface BenchSummary {
  /** Median of the measured samples — the value compared to the budget. */
  readonly median: number;
  /** Fastest measured sample (reported for context). */
  readonly min: number;
  /** How many samples contributed (excludes the discarded warm-up). */
  readonly count: number;
}

/**
 * Summarizes raw timing samples. The first sample is treated as a warm-up
 * and discarded when more than one sample is present, since the very
 * first spawn pays one-time OS/filesystem cache costs the steady state
 * does not. The median of the remaining samples is the headline figure.
 *
 * @param samples - Raw per-run timings in ms, in run order (warm-up first)
 * @returns The median/min over the post-warm-up samples
 * @throws If `samples` is empty
 */
export function summarize(samples: readonly number[]): BenchSummary {
  if (samples.length === 0) {
    throw new Error('summarize requires at least one sample');
  }
  // Discard the warm-up only when there is something left to measure.
  const measured = samples.length > 1 ? samples.slice(1) : samples.slice();
  const sorted = [...measured].sort((a, b) => a - b);
  return {
    median: median(sorted),
    min: sorted[0] as number,
    count: sorted.length,
  };
}

/** Median of an already-ascending array (averages the two middle values for even n). */
function median(sortedAsc: readonly number[]): number {
  const n = sortedAsc.length;
  const mid = Math.floor(n / 2);
  if (n % 2 === 1) return sortedAsc[mid] as number;
  return ((sortedAsc[mid - 1] as number) + (sortedAsc[mid] as number)) / 2;
}
