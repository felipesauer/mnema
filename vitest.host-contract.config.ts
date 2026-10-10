import { defineConfig } from 'vitest/config';

/**
 * THE HOST CONTRACT, run on its own, one host at a time. These cases start a real host — the Claude
 * Code binary, VS Code under a virtual screen, the Codex binary, the Copilot CLI binary, the OpenCode binary or the Gemini CLI binary — in a network namespace that
 * holds only loopback, so they are not part of `pnpm test`: that runs on every machine, and a case
 * that needs a binary and a namespace must not be skipped there and read as held.
 * `.github/workflows/host-contract.yml` runs this file for each host; so does `pnpm
 * test:host-contract`, which is the same run in a namespace of your own.
 *
 * WHICH HOST is `MNEMA_HOST_CONTRACT_HOST`, `claude-code`, `vscode`, `codex`, `copilot`, `opencode` or `gemini`, and the run stops
 * without it: a run that picked silently would be one that held half the contract and said it held
 * all of it. The Claude Code run also needs `MNEMA_HOST_CONTRACT_CLAUDE` (the binary) and
 * `MNEMA_HOST_CONTRACT_VERSION` (the version it must report); the VS Code run needs
 * `MNEMA_HOST_CONTRACT_VSCODE` (the editor) and `MNEMA_HOST_CONTRACT_VSCODE_VERSION`; the Codex run
 * needs `MNEMA_HOST_CONTRACT_CODEX` (the binary) and `MNEMA_HOST_CONTRACT_CODEX_VERSION`; the Copilot run needs `MNEMA_HOST_CONTRACT_COPILOT` and `MNEMA_HOST_CONTRACT_COPILOT_VERSION`; the OpenCode run needs `MNEMA_HOST_CONTRACT_OPENCODE` and `MNEMA_HOST_CONTRACT_OPENCODE_VERSION`; the Gemini CLI run needs `MNEMA_HOST_CONTRACT_GEMINI` and `MNEMA_HOST_CONTRACT_GEMINI_VERSION`.
 *
 * Same home of its own as the main suite, and the same rule for a case that waits: the ceiling is
 * declared at the `it`, never here.
 */
const host = process.env['MNEMA_HOST_CONTRACT_HOST'];
if (
  host !== 'claude-code' &&
  host !== 'vscode' &&
  host !== 'codex' &&
  host !== 'copilot' &&
  host !== 'opencode' &&
  host !== 'gemini'
) {
  throw new Error(
    'MNEMA_HOST_CONTRACT_HOST must be `claude-code`, `vscode`, `codex`, `copilot`, `opencode` or `gemini`',
  );
}

/** The cases of each host that is not Claude Code, by the suffix of their file. */
const OTHER_HOSTS = {
  vscode: 'packages/code/tests/host-contract/**/*.vscode.test.ts',
  codex: 'packages/code/tests/host-contract/**/*.codex.test.ts',
  copilot: 'packages/code/tests/host-contract/**/*.copilot.test.ts',
  opencode: 'packages/code/tests/host-contract/**/*.opencode.test.ts',
  gemini: 'packages/code/tests/host-contract/**/*.gemini.test.ts',
} as const;

export default defineConfig({
  test: {
    include:
      host === 'claude-code'
        ? ['packages/code/tests/host-contract/**/*.test.ts']
        : [OTHER_HOSTS[host]],
    exclude: [
      '**/dist/**',
      '**/node_modules/**',
      ...(host === 'claude-code' ? Object.values(OTHER_HOSTS) : []),
    ],
    environment: 'node',
    setupFiles: ['./.github/a-home-of-its-own/setup.mjs'],
    // Each case starts a host; one at a time keeps a case's wait its own.
    fileParallelism: false,
  },
});
