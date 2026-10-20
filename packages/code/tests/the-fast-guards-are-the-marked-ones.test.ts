// @reads-the-tree
/**
 * THE FAST GUARDS ARE THE MARKED ONES, AND THE MARK CANNOT ROT.
 *
 * WHERE THIS COMES FROM. In one week the CI went red six times on a case that walks the whole
 * tree (a file with no test that names it, a page that drifted from what the binary prints, a
 * workflow nobody listed, a git call that writes). Each was green for the person who pushed,
 * because they ran the cases of the files they touched, and the whole suite is too slow to run
 * after every commit. `pnpm test:guards` runs only the cases that walk the tree, in a fraction
 * of the time, and finds them by one line a test carries about itself: `// @reads-the-tree`.
 *
 * WHAT KEEPS THE MARK TRUE, in both directions. A file that asks git for the tree or globs the
 * repository and does not carry the mark is accused, so a new guard cannot be born outside the
 * fast run. A file that carries the mark and reads no file at all is accused too, so the mark
 * cannot outlive the walk. What it cannot see is a case that walks the tree by a means this
 * file does not look for; the signals are `ls-files`, `globSync`, and the six guards that went
 * red are named below as a floor, so the day the signals miss one the floor says which.
 *
 * WHAT IT DOES NOT COVER, said out loud. Whether a marked case is the one that went red for
 * a given change: the fast run is a subset of the suite, and the whole suite stays the gate.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  isMarked,
  MARK,
  markedGuards,
  testFiles,
} from '../../../.github/the-fast-guards/marked.mjs';

/** The workspace root: this file is `packages/code/tests/...`. */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** What a case does when it reads the tree: asks git for it, or globs it. */
const WALKS_THE_TREE = /['"]ls-files['"]|globSync\(/;

/** What a marked case must still do: read something. */
const READS_A_FILE = /ls-files|globSync|readdirSync|readFileSync|existsSync|import\.meta\.url/;

/** The guards that went red in CI in one week, kept as the floor of what the mark covers. */
const WENT_RED = [
  'packages/code/tests/every-file-has-a-test-that-names-it.test.ts',
  'packages/code/tests/the-command-handed-over-runs-as-handed.test.ts',
  'packages/code/tests/the-convergence-page-is-what-the-binary-prints.test.ts',
  'packages/code/tests/every-git-that-writes-runs-without-maintenance.test.ts',
  'packages/code/tests/the-rulers-are-read-by-the-rules.test.ts',
];

const FILES = testFiles(ROOT);
const MARKED = markedGuards(ROOT);
const source = (file: string): string => readFileSync(join(ROOT, file), 'utf-8');

describe('the cases that read the whole tree carry the mark', () => {
  it('finds the test files at all', () => {
    expect(FILES.length).toBeGreaterThan(300);
    expect(FILES).toContain('packages/code/tests/the-fast-guards-are-the-marked-ones.test.ts');
  });

  it('accuses a file that walks the tree and is not marked', () => {
    const unmarked = FILES.filter(
      (file) => WALKS_THE_TREE.test(source(file)) && !MARKED.includes(file),
    );
    expect(unmarked, `add \`${MARK}\` as the first line of: ${unmarked.join(', ')}`).toEqual([]);
  });

  it('accuses a marked file that reads no file', () => {
    const idle = MARKED.filter((file) => !READS_A_FILE.test(source(file)));
    expect(idle, `drop \`${MARK}\` from: ${idle.join(', ')}`).toEqual([]);
  });

  it('marks the guards that went red in CI', () => {
    for (const file of WENT_RED) expect(MARKED, file).toContain(file);
  });

  it('is not a run of everything', () => {
    // The point of the fast run is that it is a part: if the mark spread to most of the suite,
    // the script would be the suite with extra steps.
    expect(MARKED.length).toBeGreaterThan(WENT_RED.length);
    expect(MARKED.length).toBeLessThan(FILES.length / 3);
  });
});

describe('the mark is read from the top of a file and nowhere else', () => {
  it('sees the line within the first lines, and only as a whole line', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fast-guards-'));
    try {
      writeFileSync(join(dir, 'on.ts'), `${MARK}\n/** a header */\n`);
      writeFileSync(join(dir, 'in-prose.ts'), `/** the line ${MARK} is how a file opts in */\n`);
      writeFileSync(join(dir, 'late.ts'), `${'x'.repeat(500)}\n${MARK}\n`);
      expect(isMarked(dir, 'on.ts')).toBe(true);
      expect(isMarked(dir, 'in-prose.ts')).toBe(false);
      expect(isMarked(dir, 'late.ts')).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the script and the job run the marked files', () => {
  it('names the config the marks are read by in package.json and in the workflow', () => {
    const manifest = JSON.parse(source('package.json')) as { scripts: Record<string, string> };
    expect(manifest.scripts['test:guards']).toBe(
      'vitest run --config vitest.guards.config.ts --maxWorkers=2',
    );
    expect(source('.github/workflows/ci.yml')).toContain(
      'pnpm exec vitest run --config vitest.guards.config.ts --maxWorkers=2',
    );
  });
});
