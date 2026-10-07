import { defineConfig } from 'vitest/config';

/**
 * THE HOST CONTRACT, run on its own, one host at a time. These cases start a real host — the Claude
 * Code binary, or VS Code under a virtual screen — in a network namespace that holds only loopback,
 * so they are not part of `pnpm test`: that runs on every machine, and a case that needs a binary and
 * a namespace must not be skipped there and read as held. `.github/workflows/host-contract.yml` runs
 * this file for each host; so does `pnpm test:host-contract`, which is the same run in a namespace of
 * your own.
 *
 * WHICH HOST is `MNEMA_HOST_CONTRACT_HOST`, `claude-code` or `vscode`, and the run stops without it:
 * a run that picked silently would be one that held half the contract and said it held all of it.
 * The Claude Code run also needs `MNEMA_HOST_CONTRACT_CLAUDE` (the binary) and
 * `MNEMA_HOST_CONTRACT_VERSION` (the version it must report); the VS Code run needs
 * `MNEMA_HOST_CONTRACT_VSCODE` (the editor) and `MNEMA_HOST_CONTRACT_VSCODE_VERSION`.
 *
 * Same home of its own as the main suite, and the same rule for a case that waits: the ceiling is
 * declared at the `it`, never here.
 */
const host = process.env['MNEMA_HOST_CONTRACT_HOST'];
if (host !== 'claude-code' && host !== 'vscode') {
  throw new Error('MNEMA_HOST_CONTRACT_HOST must be `claude-code` or `vscode`');
}

const EDITOR_CASES = 'packages/code/tests/host-contract/**/*.vscode.test.ts';

export default defineConfig({
  test: {
    include: host === 'vscode' ? [EDITOR_CASES] : ['packages/code/tests/host-contract/**/*.test.ts'],
    exclude: [
      '**/dist/**',
      '**/node_modules/**',
      ...(host === 'vscode' ? [] : [EDITOR_CASES]),
    ],
    environment: 'node',
    setupFiles: ['./.github/a-home-of-its-own/setup.mjs'],
    // Each case starts a host; one at a time keeps a case's wait its own.
    fileParallelism: false,
  },
});
