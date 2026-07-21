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
    },
  },
});
