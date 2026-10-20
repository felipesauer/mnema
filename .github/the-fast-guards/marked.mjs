/**
 * THE TEST FILES THAT READ THE WHOLE TREE, found by what they say about themselves.
 *
 * A case that walks the repository (every file of a kind, every page, every workflow) is not
 * caught by running the cases of the files you touched: it goes red on a file you did not open.
 * Such a file carries one line near its top, `// @reads-the-tree`, and `pnpm test:guards` runs
 * those files and nothing else. The mark lives in the test, so there is no second list to rot;
 * `the-fast-guards-are-the-marked-ones` is red for a file that reads the tree and is not marked,
 * and for a marked file that reads nothing of it.
 */
import { execFileSync } from 'node:child_process';
import { closeSync, openSync, readSync } from 'node:fs';
import { join } from 'node:path';

/** The line, whole, as it is written in a test file. */
export const MARK = '// @reads-the-tree';

/** How far into a file the mark may sit: the first lines, before any import. */
const HEAD_BYTES = 400;

/**
 * Every test file the main suite runs, relative to `root`, sorted.
 * @param {string} root
 * @returns {string[]}
 */
export function testFiles(root) {
  // `--others`: a guard written a minute ago and not yet added is still one the next run must see.
  const args = ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--'];
  return execFileSync('git', [...args, 'packages/*.test.ts'], {
    cwd: root,
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\0')
    .filter((file) => file !== '' && !file.startsWith('packages/code/tests/host-contract/'))
    .sort();
}

/**
 * Whether the file carries the mark within its first bytes.
 * @param {string} root
 * @param {string} file
 * @returns {boolean}
 */
export function isMarked(root, file) {
  const descriptor = openSync(join(root, file), 'r');
  try {
    const buffer = Buffer.alloc(HEAD_BYTES);
    const read = readSync(descriptor, buffer, 0, HEAD_BYTES, 0);
    return buffer.toString('utf-8', 0, read).split('\n').includes(MARK);
  } finally {
    closeSync(descriptor);
  }
}

/**
 * The marked test files, relative to `root`, sorted.
 * @param {string} root
 * @returns {string[]}
 */
export function markedGuards(root) {
  return testFiles(root).filter((file) => isMarked(root, file));
}
