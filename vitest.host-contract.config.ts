import { defineConfig } from 'vitest/config';

/**
 * THE HOST CONTRACT, run on its own. These cases start the real Claude Code binary in a network
 * namespace that holds only loopback, so they are not part of `pnpm test`: that runs on every
 * machine, and a case that needs a binary and a namespace must not be skipped there and read as
 * held. `.github/workflows/host-contract.yml` runs this file; so does `pnpm test:host-contract`.
 *
 * Same home of its own as the main suite, and the same rule for a case that waits: the ceiling is
 * declared at the `it`, never here.
 */
export default defineConfig({
  test: {
    include: ['packages/code/tests/host-contract/**/*.test.ts'],
    exclude: ['**/dist/**', '**/node_modules/**'],
    environment: 'node',
    setupFiles: ['./.github/a-home-of-its-own/setup.mjs'],
    // Each case starts a host and a stand-in; one at a time keeps a case's wait its own.
    fileParallelism: false,
  },
});
