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
      // are static text — none reflect logic worth measuring. CLI
      // command modules are covered by `tests/e2e/cli.test.ts` which
      // spawns the compiled binary as a subprocess — v8 coverage
      // can't trace that, so those modules read as 0% in the report
      // even though they're functionally exercised. Exclude them so
      // the reported number reflects the logic that has real
      // in-process tests.
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        'src/index.ts',
        'src/cli/index.ts',
        'src/cli/cli-context.ts',
        'src/cli/project-root.ts',
        'src/cli/prompt-helpers.ts',
        'src/cli/templates/**',
        'src/cli/commands/**',
        'src/cli/formatters/**',
        'src/mcp/mcp-server.ts',
        'src/mcp/mcp-session-context.ts',
        'src/storage/sqlite/migrations/**',
        'src/utils/logger.ts',
        'src/utils/perf-trace.ts',
      ],
      // Threshold gate (R13 — Sprint 2). Numbers reflect the
      // in-process suite covering services + repositories +
      // domain logic. If they drop below the floor the test run
      // fails, surfacing regressions before they ship.
      //
      // Baseline measured 2026-06-09 after the Sprint 2 work:
      // statements 78.22, branches 67.34, functions 87.79,
      // lines 80.47. Thresholds sit ~3pp below baseline so a
      // single slip doesn't flip CI but a regression of a whole
      // service does.
      thresholds: {
        statements: 75,
        branches: 65,
        functions: 85,
        lines: 78,
      },
    },
  },
});
