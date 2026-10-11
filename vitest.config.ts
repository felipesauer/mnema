import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts'],
    // The host contract starts the real host in a network namespace of its own, with a config of its own.
    exclude: ['**/dist/**', '**/node_modules/**', 'packages/code/tests/host-contract/**'],
    environment: 'node',
    // EVERY TEST PROCESS RUNS IN A HOME OF ITS OWN, and no process it starts may resolve the
    // machine's: the key root lives under `HOME`, so a case that sees the real one signs with the
    // real key. What the file does, and what it cannot reach, is in its header.
    setupFiles: ['./.github/a-home-of-its-own/setup.mjs'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: 'coverage',
      include: ['packages/**/src/**/*.ts'],
      exclude: ['packages/**/src/**/*.d.ts', 'packages/**/src/index.ts'],
      /**
       * THE FLOORS BELOW ARE THE FIGURES MEASURED, MINUS A DECLARED 0.5 POINT. Three full runs
       * of the suite on the runner (node 24, the same commit) gave 94.23 statements, 87.33
       * branches (87.34 in one), 96.54 functions and 95.71 lines, the three identical to the
       * hundredth: with the suite green the figures are deterministic, so what the slack buys
       * is a change that removes tests or adds untested code, not noise. 0.5 is the starting
       * point the figures did not argue against. The branch floor now sits under the 86.99 that
       * a documentation-only change once produced, so that change no longer reddens the run.
       * THE COST OF THE SLACK IS SAID OUT LOUD: half a point of real coverage can go before this
       * notices. It catches the cliff, not the drift.
       *
       * Raising any one of these above the figure beside it turns the run red, which is the
       * only evidence that the word "gate" is now earned.
       */
      thresholds: {
        statements: 93.7,
        branches: 86.8,
        functions: 96.0,
        lines: 95.2,
      },
    },
  },
});
