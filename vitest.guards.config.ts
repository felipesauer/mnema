import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
// @ts-expect-error plain ESM under .github/, read by the config and by the test that keeps it honest
import { markedGuards } from './.github/the-fast-guards/marked.mjs';

/**
 * THE CASES THAT READ THE WHOLE TREE, run on their own: `pnpm test:guards`. They are the test
 * files that carry `// @reads-the-tree` near their top, found here by that line and by no list.
 * The rest of the configuration is the main suite's, so a case runs the same here as there.
 */
const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  test: {
    include: markedGuards(root),
    exclude: ['**/dist/**', '**/node_modules/**'],
    environment: 'node',
    setupFiles: ['./.github/a-home-of-its-own/setup.mjs'],
  },
});
