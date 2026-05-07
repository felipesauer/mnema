import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: 'coverage',
      // Only the production code under src/ counts toward coverage.
      // Migrations are SQL, bench files spawn the CLI, and templates
      // are static text — none reflect logic worth measuring.
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        'src/index.ts',
        'src/cli/templates/**',
        'src/storage/sqlite/migrations/**',
      ],
    },
  },
});
