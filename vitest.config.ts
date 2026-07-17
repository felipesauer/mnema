import path from 'node:path';
import { defineConfig } from 'vitest/config';

const coreSrc = path.resolve(__dirname, 'packages/core/src');
const productSrc = path.resolve(__dirname, 'packages/mnema/src');

// `@` is each package's own-source alias; `@mnema/core` resolves to core
// SOURCE so tests never depend on a prior build of the sibling package.
export default defineConfig({
  test: {
    projects: [
      {
        resolve: {
          alias: {
            '@mnema/core': coreSrc,
            '@': coreSrc,
          },
        },
        test: {
          name: 'core',
          include: ['packages/core/tests/**/*.test.ts'],
          environment: 'node',
          setupFiles: ['tests/setup/isolate-home.ts'],
        },
      },
      {
        resolve: {
          alias: {
            '@mnema/core': coreSrc,
            '@': productSrc,
          },
        },
        test: {
          name: 'mnema',
          include: ['packages/mnema/tests/**/*.test.ts', 'packages/mnema/tests/**/*.test.tsx'],
          environment: 'node',
          setupFiles: ['tests/setup/isolate-home.ts'],
        },
      },
      {
        test: {
          name: 'repo',
          include: ['tests/repo/**/*.test.ts'],
          environment: 'node',
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: 'coverage',
      // Only the production code under packages/*/src counts toward
      // coverage. Migrations are SQL, bench files spawn the CLI, and the
      // SPA is a separate Vite unit. CLI command modules are covered by
      // the e2e suite which spawns the compiled binary as a subprocess —
      // v8 coverage can't trace that, so those modules read as 0% in the
      // report even though they're functionally exercised. Exclude them
      // so the reported number reflects the logic that has real
      // in-process tests.
      include: ['packages/*/src/**/*.ts'],
      exclude: [
        'packages/*/src/**/*.d.ts',
        'packages/mnema/src/index.ts',
        'packages/mnema/src/cli/index.ts',
        'packages/mnema/src/cli/cli-context.ts',
        'packages/mnema/src/cli/project-root.ts',
        'packages/mnema/src/cli/prompt-helpers.ts',
        'packages/mnema/src/cli/templates/**',
        'packages/mnema/src/cli/commands/**',
        'packages/mnema/src/cli/formatters/**',
        'packages/mnema/src/mcp/mcp-server.ts',
        'packages/mnema/src/mcp/mcp-session-context.ts',
        'packages/mnema/src/dashboard/**',
        'packages/core/src/storage/sqlite/migrations/**',
        'packages/core/src/utils/logger.ts',
        'packages/core/src/utils/perf-trace.ts',
      ],
      // Threshold gate. Aggregate across both packages; recalibrating
      // per-package floors is an explicit follow-up of the split, not a
      // gate of it.
      thresholds: {
        statements: 75,
        branches: 65,
        functions: 85,
        lines: 78,
      },
    },
  },
});
