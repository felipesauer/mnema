import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts'],
    exclude: ['**/dist/**', '**/node_modules/**'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: 'coverage',
      include: ['packages/**/src/**/*.ts'],
      exclude: ['packages/**/src/**/*.d.ts', 'packages/**/src/index.ts'],
      /**
       * THE STEP CALLED "Coverage gate" NOW HAS A GATE IN IT. It had none: no `thresholds` key,
       * so a second full run of the suite could only fail if a case failed, and the name said
       * something this file did not do.
       *
       * These are today's figures — 94.48 statements, 87.35 branches, 96.22 functions, 95.59
       * lines, identical across two passes — floored to the integer. Floored, so they can only
       * be raised, and so a rebuild of the report cannot redden them by a rounding digit. THE
       * COST OF FLOORING IS SAID OUT LOUD: up to a point of real coverage can be lost before
       * this notices. It catches the cliff, not the drift.
       *
       * Raising any one of these a single point above the figure beside it turns the run red,
       * which is the only evidence that the word "gate" is now earned.
       */
      thresholds: {
        statements: 94,
        branches: 87,
        functions: 96,
        lines: 95,
      },
    },
  },
});
